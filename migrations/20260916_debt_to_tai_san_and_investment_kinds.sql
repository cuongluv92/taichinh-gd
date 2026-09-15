-- Follow-up to the Chi tiêu/Tài sản/Đầu tư split: (1) debt moves entirely out
-- of Chi tiêu into a new manual-only ledger on Tài sản (mirrors
-- account_adjustments — no more loan_pay/loan_borrow transaction-driven
-- balance); (2) "Thanh khoản ròng" is dropped; (3) investments/
-- investment_events gain a `kind` discriminator (nisa/securities/
-- savings_interest/other) with the fields each kind needs, a shared
-- optional monthly-contribution plan, and a shared optional growth-
-- simulation rate — all computed client-side, never mixed into real values.
-- Nothing is dropped: the old loans/loan_terms tables and loan_* transaction
-- rows stay exactly as they are, just no longer read by the frontend.

-- ---------------------------------------------------------------------
-- 1. Debt ledger (Nợ phải trả + Khoản phải thu), manual-only like accounts.
-- ---------------------------------------------------------------------
create table taichinh_gd.debts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  name text not null,
  counterparty text,
  direction text not null check (direction in ('payable','receivable')),
  currency text not null check (currency in ('JPY','VND')),
  opening_amount numeric not null default 0 check (opening_amount >= 0),
  start_date date,
  due_date date,
  interest_rate numeric,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table taichinh_gd.debts enable row level security;

create table taichinh_gd.debt_adjustments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  debt_id uuid not null references taichinh_gd.debts(id) on delete cascade,
  direction text not null check (direction in ('increase','decrease')),
  amount numeric not null check (amount > 0),
  adjustment_date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table taichinh_gd.debt_adjustments enable row level security;

create or replace function public.taichinh_gd_debt_ledger_api(p_key text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd, taichinh_gd_private, extensions
set "TimeZone" = 'Asia/Tokyo'
as $$
declare
  h uuid;
  v_id uuid;
  v_debt uuid;
  v_direction text;
  v_amount numeric;
  v_date date;
begin
  if p_key is null or length(p_key) < 32 then raise exception 'invalid_access_key' using errcode='42501'; end if;
  select household_id into h from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  p_action := lower(coalesce(p_action,''));

  if p_action = 'list' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.direction, x.name) from (
      select d.id, d.name, d.counterparty, d.direction, d.currency, d.opening_amount, d.start_date, d.due_date,
             d.interest_rate, d.note, d.is_active, d.created_at,
             d.opening_amount
               + coalesce((select sum(amount) from taichinh_gd.debt_adjustments where debt_id=d.id and direction='increase' and deleted_at is null),0)
               - coalesce((select sum(amount) from taichinh_gd.debt_adjustments where debt_id=d.id and direction='decrease' and deleted_at is null),0)
             as current_balance
      from taichinh_gd.debts d
      where d.household_id=h and d.is_active=true
    ) x), '[]'::jsonb));

  elsif p_action = 'save' then
    v_id := nullif(p_payload->>'id','')::uuid;
    if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'debt_name_required'; end if;
    v_direction := nullif(p_payload->>'direction','');
    if v_direction not in ('payable','receivable') then raise exception 'invalid_direction'; end if;
    v_amount := coalesce(nullif(p_payload->>'opening_amount','')::numeric, 0);
    if v_amount < 0 then raise exception 'amount_must_be_non_negative'; end if;

    if v_id is null then
      insert into taichinh_gd.debts(household_id, name, counterparty, direction, currency, opening_amount, start_date, due_date, interest_rate, note)
      values (h, p_payload->>'name', nullif(btrim(p_payload->>'counterparty'),''), v_direction,
              coalesce(nullif(p_payload->>'currency',''),'JPY'), v_amount,
              nullif(p_payload->>'start_date','')::date, nullif(p_payload->>'due_date','')::date,
              nullif(p_payload->>'interest_rate','')::numeric, nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.debts
      set name=p_payload->>'name', counterparty=nullif(btrim(p_payload->>'counterparty'),''), direction=v_direction,
          currency=coalesce(nullif(p_payload->>'currency',''),'JPY'), opening_amount=v_amount,
          start_date=nullif(p_payload->>'start_date','')::date, due_date=nullif(p_payload->>'due_date','')::date,
          interest_rate=nullif(p_payload->>'interest_rate','')::numeric, note=nullif(btrim(p_payload->>'note'),''), updated_at=now()
      where id=v_id and household_id=h;
      if not found then raise exception 'debt_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'archive' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.debts set is_active=false where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'unarchive' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.debts set is_active=true where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'delete' then
    v_id := nullif(p_payload->>'id','')::uuid;
    if exists(select 1 from taichinh_gd.debt_adjustments where debt_id=v_id and household_id=h and deleted_at is null) then
      raise exception 'debt_has_history';
    end if;
    delete from taichinh_gd.debts where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'list_adjustments' then
    v_debt := nullif(p_payload->>'debt_id','')::uuid;
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.adjustment_date desc, x.created_at desc) from (
      select id, debt_id, direction, amount, adjustment_date, note, created_at
      from taichinh_gd.debt_adjustments where household_id=h and debt_id=v_debt and deleted_at is null
    ) x), '[]'::jsonb));

  elsif p_action = 'save_adjustment' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_debt := nullif(p_payload->>'debt_id','')::uuid;
    if v_debt is null or not exists(select 1 from taichinh_gd.debts where id=v_debt and household_id=h) then
      raise exception 'invalid_debt';
    end if;
    v_direction := nullif(p_payload->>'direction','');
    if v_direction not in ('increase','decrease') then raise exception 'invalid_direction'; end if;
    v_amount := nullif(p_payload->>'amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
    v_date := coalesce(nullif(p_payload->>'adjustment_date','')::date, current_date);

    if v_id is null then
      insert into taichinh_gd.debt_adjustments(household_id, debt_id, direction, amount, adjustment_date, note)
      values (h, v_debt, v_direction, v_amount, v_date, nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.debt_adjustments
      set debt_id=v_debt, direction=v_direction, amount=v_amount, adjustment_date=v_date, note=nullif(btrim(p_payload->>'note'),'')
      where id=v_id and household_id=h and deleted_at is null;
      if not found then raise exception 'adjustment_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_adjustment' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.debt_adjustments set deleted_at=now() where id=v_id and household_id=h and deleted_at is null;
    return jsonb_build_object('ok', found);

  else
    raise exception 'unknown_action';
  end if;
end;
$$;

-- Migrate the existing loan: opening_amount = its CURRENT remaining_amount
-- (not the original principal) so the new ledger's balance matches today's
-- real debt with zero adjustments needed — the original principal and full
-- payment history remain intact and untouched in taichinh_gd.loans /
-- taichinh_gd.transactions for reference, this is a snapshot forward, not a
-- replacement of that history.
insert into taichinh_gd.debts(household_id, name, counterparty, direction, currency, opening_amount, start_date, due_date, interest_rate, note)
select l.household_id, l.counterparty, l.counterparty,
       case l.loan_type when 'borrowed' then 'payable' else 'receivable' end,
       l.currency, l.remaining_amount, l.start_date, l.due_date,
       t.annual_rate, l.note
from taichinh_gd.loans l
left join taichinh_gd.loan_terms t on t.loan_id = l.id
where l.remaining_amount > 0;

-- ---------------------------------------------------------------------
-- 2. Đầu tư: widen investments/investment_events with a `kind` discriminator
--    covering NISA (khung tích lũy/tăng trưởng + contribution plan),
--    Chứng khoán (position tracking), Tiết kiệm sinh lời (interest +
--    contribution plan), and Other (Vàng/Quỹ/custom, simple gốc+giá trị —
--    this is what the previous migration's investments table already was).
--    Both tables are still empty in production, so every change here is a
--    pure additive ALTER, safe to run without a data migration.
-- ---------------------------------------------------------------------
alter table taichinh_gd.investments
  add column kind text not null default 'other' check (kind in ('nisa','securities','savings_interest','other')),
  add column start_date date,
  -- NISA + securities
  add column broker_name text,
  add column nisa_frame text check (nisa_frame in ('tsumitate','growth','both')),
  add column nisa_annual_limit numeric,
  -- securities position (mutated in place by buy/sell events — see recompute below)
  add column ticker text,
  add column market text,
  add column quantity numeric not null default 0 check (quantity >= 0),
  add column avg_cost numeric not null default 0 check (avg_cost >= 0),
  add column current_price numeric,
  add column realized_pl numeric not null default 0,
  -- savings_interest
  add column bank_name text,
  add column interest_rate_annual numeric,
  add column interest_payment_method text check (interest_payment_method in ('monthly','quarterly','maturity','compound','simple')),
  add column term_end_date date,
  -- shared optional monthly contribution plan (NISA + savings_interest)
  add column monthly_amount numeric,
  add column monthly_day int check (monthly_day between 1 and 31),
  add column plan_start_month date,
  add column plan_end_month date,
  add column plan_paused boolean not null default false,
  -- shared optional growth simulation — computed client-side only, never
  -- mixed into "giá trị hiện tại"/"lãi/lỗ thực tế"
  add column expected_return_rate numeric,
  add column expected_return_period text check (expected_return_period in ('monthly','annual')),
  add column reinvest_mode text check (reinvest_mode in ('compound','none','dividend')) default 'none';

alter table taichinh_gd.investment_events
  drop constraint investment_events_event_type_check,
  add constraint investment_events_event_type_check check (event_type in (
    'contribution','withdrawal','valuation','buy','sell','dividend','fee','interest','plan_confirm','plan_skip'
  )),
  add column quantity numeric,
  add column price numeric,
  alter column amount drop not null,
  add constraint investment_events_amount_or_qty check (amount is not null or (quantity is not null and price is not null));

-- ---------------------------------------------------------------------
-- 3. Rebuild taichinh_gd_investment_api for the new kind-aware model.
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
  v_kind text;
  v_qty numeric;
  v_price numeric;
  r record;
  run_qty numeric;
  run_avg numeric;
  run_realized numeric;
begin
  if p_key is null or length(p_key) < 32 then raise exception 'invalid_access_key' using errcode='42501'; end if;
  select household_id into h from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  p_action := lower(coalesce(p_action,''));

  if p_action = 'list' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
      select inv.id, inv.name, inv.kind, inv.asset_type, inv.currency, inv.initial_capital, inv.note, inv.created_at, inv.start_date,
             inv.broker_name, inv.nisa_frame, inv.nisa_annual_limit, inv.ticker, inv.market, inv.quantity, inv.avg_cost,
             inv.current_price, inv.realized_pl, inv.bank_name, inv.interest_rate_annual, inv.interest_payment_method,
             inv.term_end_date, inv.monthly_amount, inv.monthly_day, inv.plan_start_month, inv.plan_end_month, inv.plan_paused,
             inv.expected_return_rate, inv.expected_return_period, inv.reinvest_mode,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type in ('contribution','buy') and deleted_at is null),0) as total_contributed,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type in ('withdrawal','sell') and deleted_at is null),0) as total_withdrawn,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type='dividend' and deleted_at is null),0) as total_dividends,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type='fee' and deleted_at is null),0) as total_fees,
             coalesce((select sum(amount) from taichinh_gd.investment_events where investment_id=inv.id and event_type='interest' and deleted_at is null),0) as total_interest,
             (select amount from taichinh_gd.investment_events where investment_id=inv.id and event_type='valuation' and deleted_at is null order by event_date desc, created_at desc limit 1) as latest_value,
             (select event_date from taichinh_gd.investment_events where investment_id=inv.id and event_type='valuation' and deleted_at is null order by event_date desc, created_at desc limit 1) as latest_value_date
      from taichinh_gd.investments inv
      where inv.household_id=h and inv.is_active=true
    ) x), '[]'::jsonb));

  elsif p_action = 'save' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_name := nullif(btrim(p_payload->>'name'),'');
    if v_name is null then raise exception 'investment_name_required'; end if;
    v_kind := coalesce(nullif(p_payload->>'kind',''),'other');
    if v_kind not in ('nisa','securities','savings_interest','other') then raise exception 'invalid_kind'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''),'JPY');
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    v_amount := coalesce(nullif(p_payload->>'initial_capital','')::numeric,0);
    if v_amount < 0 then raise exception 'initial_capital_negative'; end if;

    if v_id is null then
      insert into taichinh_gd.investments(
        household_id, name, asset_type, currency, initial_capital, note, kind, broker_name, nisa_frame, nisa_annual_limit,
        ticker, market, bank_name, interest_rate_annual, interest_payment_method, term_end_date, start_date,
        monthly_amount, monthly_day, plan_start_month, plan_end_month, plan_paused,
        expected_return_rate, expected_return_period, reinvest_mode
      ) values (
        h, v_name, nullif(btrim(p_payload->>'asset_type'),''), v_currency, v_amount, nullif(btrim(p_payload->>'note'),''), v_kind,
        nullif(btrim(p_payload->>'broker_name'),''), nullif(p_payload->>'nisa_frame',''), nullif(p_payload->>'nisa_annual_limit','')::numeric,
        nullif(btrim(p_payload->>'ticker'),''), nullif(btrim(p_payload->>'market'),''),
        nullif(btrim(p_payload->>'bank_name'),''), nullif(p_payload->>'interest_rate_annual','')::numeric, nullif(p_payload->>'interest_payment_method',''),
        nullif(p_payload->>'term_end_date','')::date, nullif(p_payload->>'start_date','')::date,
        nullif(p_payload->>'monthly_amount','')::numeric, nullif(p_payload->>'monthly_day','')::int,
        nullif(p_payload->>'plan_start_month','')::date, nullif(p_payload->>'plan_end_month','')::date,
        coalesce((p_payload->>'plan_paused')::boolean, false),
        nullif(p_payload->>'expected_return_rate','')::numeric, nullif(p_payload->>'expected_return_period',''),
        coalesce(nullif(p_payload->>'reinvest_mode',''), 'none')
      ) returning id into v_id;
    else
      update taichinh_gd.investments set
        name=v_name, asset_type=nullif(btrim(p_payload->>'asset_type'),''), currency=v_currency, initial_capital=v_amount,
        note=nullif(btrim(p_payload->>'note'),''), kind=v_kind, broker_name=nullif(btrim(p_payload->>'broker_name'),''),
        nisa_frame=nullif(p_payload->>'nisa_frame',''), nisa_annual_limit=nullif(p_payload->>'nisa_annual_limit','')::numeric,
        ticker=nullif(btrim(p_payload->>'ticker'),''), market=nullif(btrim(p_payload->>'market'),''),
        bank_name=nullif(btrim(p_payload->>'bank_name'),''), interest_rate_annual=nullif(p_payload->>'interest_rate_annual','')::numeric,
        interest_payment_method=nullif(p_payload->>'interest_payment_method',''), term_end_date=nullif(p_payload->>'term_end_date','')::date,
        start_date=nullif(p_payload->>'start_date','')::date,
        monthly_amount=nullif(p_payload->>'monthly_amount','')::numeric, monthly_day=nullif(p_payload->>'monthly_day','')::int,
        plan_start_month=nullif(p_payload->>'plan_start_month','')::date, plan_end_month=nullif(p_payload->>'plan_end_month','')::date,
        plan_paused=coalesce((p_payload->>'plan_paused')::boolean, plan_paused),
        expected_return_rate=nullif(p_payload->>'expected_return_rate','')::numeric, expected_return_period=nullif(p_payload->>'expected_return_period',''),
        reinvest_mode=coalesce(nullif(p_payload->>'reinvest_mode',''), reinvest_mode), updated_at=now()
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
      select id, event_type, amount, quantity, price, event_date, note, created_at from taichinh_gd.investment_events
      where household_id=h and investment_id=v_investment and deleted_at is null
    ) x), '[]'::jsonb));

  elsif p_action = 'save_event' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_investment := nullif(p_payload->>'investment_id','')::uuid;
    select kind into v_kind from taichinh_gd.investments where id=v_investment and household_id=h;
    if v_kind is null then raise exception 'invalid_investment'; end if;
    v_type := nullif(p_payload->>'event_type','');
    if v_type not in ('contribution','withdrawal','valuation','buy','sell','dividend','fee','interest','plan_confirm','plan_skip') then
      raise exception 'invalid_event_type';
    end if;
    v_date := coalesce(nullif(p_payload->>'event_date','')::date, current_date);
    v_qty := nullif(p_payload->>'quantity','')::numeric;
    v_price := nullif(p_payload->>'price','')::numeric;
    v_amount := nullif(p_payload->>'amount','')::numeric;
    if v_type in ('buy','sell') then
      if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then raise exception 'quantity_and_price_required'; end if;
      v_amount := coalesce(v_amount, v_qty * v_price);
    elsif v_type = 'valuation' and v_kind = 'securities' then
      if v_price is null or v_price < 0 then raise exception 'price_required'; end if;
      v_amount := coalesce(v_amount, 0);
    else
      if v_amount is null or v_amount < 0 then raise exception 'amount_must_be_non_negative'; end if;
    end if;

    if v_id is null then
      insert into taichinh_gd.investment_events(household_id,investment_id,event_type,amount,quantity,price,event_date,note)
      values (h,v_investment,v_type,v_amount,v_qty,v_price,v_date,nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.investment_events
      set event_type=v_type, amount=v_amount, quantity=v_qty, price=v_price, event_date=v_date, note=nullif(btrim(p_payload->>'note'),'')
      where id=v_id and household_id=h and deleted_at is null;
      if not found then raise exception 'event_not_found'; end if;
    end if;

    -- Securities: keep quantity/avg_cost/realized_pl and current_price on
    -- the row itself in sync by replaying full buy/sell/valuation history —
    -- a full replay (not an incremental mutation) so edits and deletes
    -- always converge to a correct position, not just creates.
    if v_kind = 'securities' then
      run_qty := 0; run_avg := 0; run_realized := 0;
      for r in (select event_type, quantity, price from taichinh_gd.investment_events
                where investment_id=v_investment and event_type in ('buy','sell') and deleted_at is null
                order by event_date, created_at) loop
        if r.event_type = 'buy' then
          run_avg := case when run_qty + r.quantity > 0 then (run_qty*run_avg + r.quantity*r.price) / (run_qty + r.quantity) else run_avg end;
          run_qty := run_qty + r.quantity;
        else
          run_realized := run_realized + r.quantity * (r.price - run_avg);
          run_qty := run_qty - r.quantity;
        end if;
      end loop;
      update taichinh_gd.investments set quantity=run_qty, avg_cost=run_avg, realized_pl=run_realized,
        current_price = coalesce((select price from taichinh_gd.investment_events where investment_id=v_investment and event_type='valuation' and deleted_at is null order by event_date desc, created_at desc limit 1), current_price)
      where id=v_investment;
    end if;

    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_event' then
    v_id := nullif(p_payload->>'id','')::uuid;
    select investment_id into v_investment from taichinh_gd.investment_events where id=v_id and household_id=h;
    select kind into v_kind from taichinh_gd.investments where id=v_investment;
    update taichinh_gd.investment_events set deleted_at=now() where id=v_id and household_id=h and deleted_at is null;
    if v_kind = 'securities' and v_investment is not null then
      run_qty := 0; run_avg := 0; run_realized := 0;
      for r in (select event_type, quantity, price from taichinh_gd.investment_events
                where investment_id=v_investment and event_type in ('buy','sell') and deleted_at is null
                order by event_date, created_at) loop
        if r.event_type = 'buy' then
          run_avg := case when run_qty + r.quantity > 0 then (run_qty*run_avg + r.quantity*r.price) / (run_qty + r.quantity) else run_avg end;
          run_qty := run_qty + r.quantity;
        else
          run_realized := run_realized + r.quantity * (r.price - run_avg);
          run_qty := run_qty - r.quantity;
        end if;
      end loop;
      update taichinh_gd.investments set quantity=run_qty, avg_cost=run_avg, realized_pl=run_realized where id=v_investment;
    end if;
    return jsonb_build_object('ok', true);

  else
    raise exception 'unknown_action';
  end if;
end;
$$;
