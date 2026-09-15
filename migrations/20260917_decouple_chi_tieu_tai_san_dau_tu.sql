-- Full architecture split per explicit request: Chi tiêu (monthly income/
-- expense report), Tài sản (manual-only account balances), and Đầu tư (its
-- own ledger) become three independent systems. The only automatic link
-- left anywhere is Đầu tư's total current value flowing into Tài sản's
-- "Đang đầu tư" line. Nothing here drops a table or deletes a row — every
-- change is additive (new tables) or widens an existing constraint.

-- ---------------------------------------------------------------------
-- 1. Tài sản: account balance becomes opening_balance + manual adjustments
--    only. Chi tiêu transactions never touch it again.
-- ---------------------------------------------------------------------
create table taichinh_gd.account_adjustments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  account_id uuid not null references taichinh_gd.accounts(id) on delete cascade,
  direction text not null check (direction in ('increase','decrease')),
  amount numeric not null check (amount > 0),
  currency text not null check (currency in ('JPY','VND')),
  adjustment_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table taichinh_gd.account_adjustments enable row level security;

-- ---------------------------------------------------------------------
-- 2. Thẻ & trả góp: its own ledger, never touches category_id / Chi biến
--    động, never touches an account balance.
-- ---------------------------------------------------------------------
create table taichinh_gd.card_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  card_account_id uuid not null references taichinh_gd.accounts(id) on delete cascade,
  entry_mode text not null check (entry_mode in ('detail','lump')),
  expense_date date not null,
  description text,
  amount numeric not null check (amount > 0),
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table taichinh_gd.card_expenses enable row level security;

-- credit_card_installments already exists from earlier work and already has
-- every field the new spec asks for (principal_amount, fee_total,
-- total_installments, paid_installments_before, first_payment_month...).
-- The only change: purchase_transaction_id/category_id stop being required
-- in practice — a new installment no longer creates a transactions row at
-- all, so it can never leak into Chi biến động. purchase_transaction_id was
-- already nullable; category_id was NOT NULL (verified against production,
-- correcting an earlier assumption) and must be widened since installments
-- no longer belong to a category.
alter table taichinh_gd.credit_card_installments alter column category_id drop not null;

-- ---------------------------------------------------------------------
-- 3. Đầu tư: its own ledger with explicit vốn/giá trị/lãi-lỗ fields,
--    replacing the old "investment account + transfer/investment_gain
--    transactions" model. Only this module's total feeds Tài sản.
-- ---------------------------------------------------------------------
create table taichinh_gd.investments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  name text not null,
  asset_type text,
  currency text not null check (currency in ('JPY','VND')),
  initial_capital numeric not null default 0 check (initial_capital >= 0),
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table taichinh_gd.investments enable row level security;

create table taichinh_gd.investment_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  investment_id uuid not null references taichinh_gd.investments(id) on delete cascade,
  event_type text not null check (event_type in ('contribution','withdrawal','valuation')),
  amount numeric not null check (amount >= 0),
  event_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table taichinh_gd.investment_events enable row level security;

-- ---------------------------------------------------------------------
-- 4. validate_transaction_integrity: account_id is no longer mandatory for
--    a Chi tiêu income/expense row (accounts are a Tài sản-only concept
--    now) — everything else about the row is still validated exactly as
--    before. transfer/goal_save/goal_withdraw keep requiring both accounts
--    (goals are an existing, untouched feature that still works that way).
-- ---------------------------------------------------------------------
create or replace function taichinh_gd.validate_transaction_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, taichinh_gd
as $$
declare
  v_account_currency text;
  v_transfer_currency text;
  v_category_direction text;
begin
  if new.account_id is not null then
    select currency into v_account_currency
    from taichinh_gd.accounts
    where id = new.account_id and household_id = new.household_id and is_active = true;
    if v_account_currency is null then raise exception 'invalid_account'; end if;
    if v_account_currency <> new.currency then raise exception 'account_currency_mismatch'; end if;
  end if;

  if new.transaction_type in ('transfer','goal_save','goal_withdraw') then
    if new.account_id is null then raise exception 'transaction_account_required'; end if;
    if new.transfer_account_id is null then raise exception 'transfer_account_required'; end if;
    if new.transfer_account_id = new.account_id then raise exception 'accounts_must_differ'; end if;
    select currency into v_transfer_currency
    from taichinh_gd.accounts
    where id = new.transfer_account_id and household_id = new.household_id and is_active = true;
    if v_transfer_currency is null then raise exception 'invalid_transfer_account'; end if;
    if v_transfer_currency <> new.currency then raise exception 'transfer_currency_mismatch'; end if;
  elsif new.transfer_account_id is not null then
    raise exception 'unexpected_transfer_account';
  end if;

  if new.transaction_type in ('income','expense') then
    if new.category_id is null then raise exception 'transaction_category_required'; end if;
    select direction into v_category_direction
    from taichinh_gd.categories
    where id = new.category_id and household_id = new.household_id and is_active = true;
    if v_category_direction is null then raise exception 'invalid_category'; end if;
    if v_category_direction <> new.transaction_type then raise exception 'category_direction_mismatch'; end if;
  elsif new.category_id is not null then
    raise exception 'unexpected_category';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. New RPC: account adjustments (Tài sản manual +/-).
-- ---------------------------------------------------------------------
create or replace function public.taichinh_gd_account_adjustment_api(p_key text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd, taichinh_gd_private, extensions
set "TimeZone" = 'Asia/Tokyo'
as $$
declare
  h uuid;
  v_id uuid;
  v_account uuid;
  v_direction text;
  v_amount numeric;
  v_currency text;
  v_date date;
begin
  if p_key is null or length(p_key) < 32 then raise exception 'invalid_access_key' using errcode='42501'; end if;
  select household_id into h from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  p_action := lower(coalesce(p_action,''));

  if p_action = 'list' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.adjustment_date desc, x.created_at desc) from (
      select a.id, a.account_id, acc.name as account_name, a.direction, a.amount, a.currency, a.adjustment_date, a.note, a.created_at
      from taichinh_gd.account_adjustments a
      join taichinh_gd.accounts acc on acc.id = a.account_id
      where a.household_id = h and a.deleted_at is null
    ) x), '[]'::jsonb));

  elsif p_action = 'save' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_account := nullif(p_payload->>'account_id','')::uuid;
    if v_account is null or not exists(select 1 from taichinh_gd.accounts where id=v_account and household_id=h) then
      raise exception 'invalid_account';
    end if;
    v_direction := nullif(p_payload->>'direction','');
    if v_direction not in ('increase','decrease') then raise exception 'invalid_direction'; end if;
    v_amount := nullif(p_payload->>'amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_account));
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    v_date := coalesce(nullif(p_payload->>'adjustment_date','')::date, current_date);

    if v_id is null then
      insert into taichinh_gd.account_adjustments(household_id,account_id,direction,amount,currency,adjustment_date,note)
      values (h,v_account,v_direction,v_amount,v_currency,v_date,nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.account_adjustments
      set account_id=v_account, direction=v_direction, amount=v_amount, currency=v_currency, adjustment_date=v_date, note=nullif(btrim(p_payload->>'note'),'')
      where id=v_id and household_id=h and deleted_at is null;
      if not found then raise exception 'adjustment_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.account_adjustments set deleted_at=now() where id=v_id and household_id=h and deleted_at is null;
    return jsonb_build_object('ok', found);

  else
    raise exception 'unknown_action';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. New RPC: card ledger (chi tiêu thẻ + trả góp), fully independent of
--    categories/Chi biến động/account balances.
-- ---------------------------------------------------------------------
create or replace function public.taichinh_gd_card_ledger_api(p_key text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd, taichinh_gd_private, extensions
set "TimeZone" = 'Asia/Tokyo'
as $$
declare
  h uuid;
  v_id uuid;
  v_card uuid;
  v_mode text;
  v_amount numeric;
  v_date date;
  v_name text;
  v_total_installments int;
  v_paid_before int;
  v_first_month date;
begin
  if p_key is null or length(p_key) < 32 then raise exception 'invalid_access_key' using errcode='42501'; end if;
  select household_id into h from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  p_action := lower(coalesce(p_action,''));

  if p_action = 'list_expenses' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.expense_date desc, x.created_at desc) from (
      select e.id, e.card_account_id, a.name as card_name, e.entry_mode, e.expense_date, e.description, e.amount, e.note, e.created_at
      from taichinh_gd.card_expenses e join taichinh_gd.accounts a on a.id=e.card_account_id
      where e.household_id=h and e.deleted_at is null
    ) x), '[]'::jsonb));

  elsif p_action = 'save_expense' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_card := nullif(p_payload->>'card_account_id','')::uuid;
    if v_card is null or not exists(select 1 from taichinh_gd.accounts where id=v_card and household_id=h and account_type='credit') then
      raise exception 'invalid_card';
    end if;
    v_mode := coalesce(nullif(p_payload->>'entry_mode',''),'detail');
    if v_mode not in ('detail','lump') then raise exception 'invalid_entry_mode'; end if;
    v_amount := nullif(p_payload->>'amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
    v_date := coalesce(nullif(p_payload->>'expense_date','')::date, current_date);

    if v_id is null then
      insert into taichinh_gd.card_expenses(household_id,card_account_id,entry_mode,expense_date,description,amount,note)
      values (h,v_card,v_mode,v_date,nullif(btrim(p_payload->>'description'),''),v_amount,nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.card_expenses
      set card_account_id=v_card, entry_mode=v_mode, expense_date=v_date, description=nullif(btrim(p_payload->>'description'),''), amount=v_amount, note=nullif(btrim(p_payload->>'note'),'')
      where id=v_id and household_id=h and deleted_at is null;
      if not found then raise exception 'card_expense_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_expense' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.card_expenses set deleted_at=now() where id=v_id and household_id=h and deleted_at is null;
    return jsonb_build_object('ok', found);

  elsif p_action = 'list_installments' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.purchase_date desc) from (
      select i.id, i.card_account_id, a.name as card_name, i.name, i.purchase_date, i.principal_amount, i.fee_total,
             i.total_installments, i.paid_installments_before, i.first_payment_month, i.currency, i.note,
             coalesce((select jsonb_agg(to_jsonb(s) order by s.payment_month) from (
               select id, installment_no, payment_month, principal_amount, fee_amount, is_paid, payment_kind
               from taichinh_gd.credit_card_installment_schedule where installment_id=i.id and household_id=h
             ) s), '[]'::jsonb) as schedule
      from taichinh_gd.credit_card_installments i join taichinh_gd.accounts a on a.id=i.card_account_id
      where i.household_id=h
    ) x), '[]'::jsonb));

  elsif p_action = 'save_installment' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_card := nullif(p_payload->>'card_account_id','')::uuid;
    if v_card is null or not exists(select 1 from taichinh_gd.accounts where id=v_card and household_id=h and account_type='credit') then
      raise exception 'invalid_card';
    end if;
    v_name := nullif(btrim(p_payload->>'name'),'');
    if v_name is null then raise exception 'installment_name_required'; end if;
    v_amount := nullif(p_payload->>'principal_amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'principal_must_be_positive'; end if;
    v_total_installments := nullif(p_payload->>'total_installments','')::int;
    if v_total_installments is null or v_total_installments < 2 or v_total_installments > 60 then raise exception 'invalid_total_installments'; end if;
    v_paid_before := coalesce(nullif(p_payload->>'paid_installments_before','')::int, 0);
    if v_paid_before < 0 or v_paid_before >= v_total_installments then raise exception 'invalid_paid_before'; end if;
    v_date := coalesce(nullif(p_payload->>'purchase_date','')::date, current_date);
    v_first_month := coalesce(nullif(p_payload->>'first_payment_month','')::date, date_trunc('month', v_date)::date);

    -- Edit-by-id updates the header and regenerates the whole schedule
    -- (necessarily resets is_paid on every period — a changed kỳ count or
    -- amount can't be reconciled against the old schedule any other way).
    if v_id is not null then
      update taichinh_gd.credit_card_installments
      set card_account_id=v_card, name=v_name, purchase_date=v_date, principal_amount=v_amount,
          fee_total=coalesce(nullif(p_payload->>'fee_total','')::numeric,0), total_installments=v_total_installments,
          first_payment_month=v_first_month, currency=coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_card)),
          note=nullif(btrim(p_payload->>'note'),''), entry_mode=case when v_paid_before>0 then 'existing' else 'purchase' end,
          paid_installments_before=v_paid_before, updated_at=now()
      where id=v_id and household_id=h;
      if not found then raise exception 'installment_not_found'; end if;
      delete from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;
    else
      insert into taichinh_gd.credit_card_installments(
        household_id, card_account_id, name, purchase_date, principal_amount, fee_total,
        total_installments, first_payment_month, currency, note, entry_mode, schedule_mode, paid_installments_before
      ) values (
        h, v_card, v_name, v_date, v_amount, coalesce(nullif(p_payload->>'fee_total','')::numeric,0),
        v_total_installments, v_first_month, coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_card)),
        nullif(btrim(p_payload->>'note'),''), case when v_paid_before>0 then 'existing' else 'purchase' end, 'equal', v_paid_before
      ) returning id into v_id;
    end if;

    -- Equal schedule across every period from month 1 (not just what's left
    -- to pay) so "đã trả X kỳ" stays a visible fact, not lost history.
    insert into taichinh_gd.credit_card_installment_schedule(household_id, installment_id, installment_no, payment_month, principal_amount, fee_amount, is_paid, payment_kind)
    select h, v_id, gs, (v_first_month + ((gs - v_paid_before - 1) || ' months')::interval)::date,
           round(v_amount / v_total_installments), round(coalesce(nullif(p_payload->>'fee_total','')::numeric,0) / v_total_installments),
           gs <= v_paid_before, 'regular'
    from generate_series(1, v_total_installments) gs;

    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_installment' then
    v_id := nullif(p_payload->>'id','')::uuid;
    delete from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;
    delete from taichinh_gd.credit_card_installments where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'toggle_paid' then
    v_id := nullif(p_payload->>'id','')::uuid; -- schedule row id
    update taichinh_gd.credit_card_installment_schedule
    set is_paid = not is_paid, paid_at = case when not is_paid then now() else null end
    where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  else
    raise exception 'unknown_action';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Rebuild taichinh_gd_investment_api as the Đầu tư ledger.
-- ---------------------------------------------------------------------
create or replace function public.taichinh_gd_investment_api(p_key text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd, taichinh_gd_private, extensions
set "TimeZone" = 'Asia/Tokyo'
as $$
declare
  h uuid;
  v_id uuid;
  v_investment uuid;
  v_name text;
  v_currency text;
  v_amount numeric;
  v_type text;
  v_date date;
begin
  if p_key is null or length(p_key) < 32 then raise exception 'invalid_access_key' using errcode='42501'; end if;
  select household_id into h from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  p_action := lower(coalesce(p_action,''));

  if p_action = 'list' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
      select inv.id, inv.name, inv.asset_type, inv.currency, inv.initial_capital, inv.note, inv.created_at,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type='contribution' and deleted_at is null),0) as total_contributed,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type='withdrawal' and deleted_at is null),0) as total_withdrawn,
             (select amount from taichinh_gd.investment_events where investment_id=inv.id and event_type='valuation' and deleted_at is null order by event_date desc, created_at desc limit 1) as latest_value,
             (select event_date from taichinh_gd.investment_events where investment_id=inv.id and event_type='valuation' and deleted_at is null order by event_date desc, created_at desc limit 1) as latest_value_date
      from taichinh_gd.investments inv
      where inv.household_id=h and inv.is_active=true
    ) x), '[]'::jsonb));

  elsif p_action = 'save' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_name := nullif(btrim(p_payload->>'name'),'');
    if v_name is null then raise exception 'investment_name_required'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''),'JPY');
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    v_amount := coalesce(nullif(p_payload->>'initial_capital','')::numeric,0);
    if v_amount < 0 then raise exception 'initial_capital_negative'; end if;

    if v_id is null then
      insert into taichinh_gd.investments(household_id,name,asset_type,currency,initial_capital,note)
      values (h,v_name,nullif(btrim(p_payload->>'asset_type'),''),v_currency,v_amount,nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.investments
      set name=v_name, asset_type=nullif(btrim(p_payload->>'asset_type'),''), currency=v_currency, initial_capital=v_amount, note=nullif(btrim(p_payload->>'note'),''), updated_at=now()
      where id=v_id and household_id=h;
      if not found then raise exception 'investment_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.investments set is_active=false where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'list_events' then
    v_investment := nullif(p_payload->>'investment_id','')::uuid;
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.event_date desc, x.created_at desc) from (
      select id, event_type, amount, event_date, note, created_at from taichinh_gd.investment_events
      where household_id=h and investment_id=v_investment and deleted_at is null
    ) x), '[]'::jsonb));

  elsif p_action = 'save_event' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_investment := nullif(p_payload->>'investment_id','')::uuid;
    if v_investment is null or not exists(select 1 from taichinh_gd.investments where id=v_investment and household_id=h) then
      raise exception 'invalid_investment';
    end if;
    v_type := nullif(p_payload->>'event_type','');
    if v_type not in ('contribution','withdrawal','valuation') then raise exception 'invalid_event_type'; end if;
    v_amount := nullif(p_payload->>'amount','')::numeric;
    if v_amount is null or v_amount < 0 then raise exception 'amount_must_be_non_negative'; end if;
    v_date := coalesce(nullif(p_payload->>'event_date','')::date, current_date);

    if v_id is null then
      insert into taichinh_gd.investment_events(household_id,investment_id,event_type,amount,event_date,note)
      values (h,v_investment,v_type,v_amount,v_date,nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.investment_events
      set event_type=v_type, amount=v_amount, event_date=v_date, note=nullif(btrim(p_payload->>'note'),'')
      where id=v_id and household_id=h and deleted_at is null;
      if not found then raise exception 'event_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_event' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.investment_events set deleted_at=now() where id=v_id and household_id=h and deleted_at is null;
    return jsonb_build_object('ok', found);

  else
    raise exception 'unknown_action';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Data migration: preserve the existing Rakuten ¥10,000 transaction by
--    moving it into card_expenses, then soft-delete the original row so
--    it stops counting in Chi biến động but is never actually lost.
-- ---------------------------------------------------------------------
insert into taichinh_gd.card_expenses(household_id, card_account_id, entry_mode, expense_date, description, amount, note)
select t.household_id, t.account_id, 'detail', t.transaction_date,
       '(Chuyển từ Chi biến động cũ)', t.amount, t.note
from taichinh_gd.transactions t
join taichinh_gd.accounts a on a.id = t.account_id and a.account_type = 'credit'
where t.deleted_at is null and t.transaction_type = 'expense';

update taichinh_gd.transactions t
set deleted_at = now()
from taichinh_gd.accounts a
where a.id = t.account_id and a.account_type = 'credit' and t.deleted_at is null and t.transaction_type = 'expense';
