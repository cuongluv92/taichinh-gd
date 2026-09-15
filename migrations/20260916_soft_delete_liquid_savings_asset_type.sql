-- Three follow-ups from the last review, all additive/non-destructive:
--
-- 1. Soft delete for transactions. Deleting used to be a hard DELETE with
--    no way back. Adds transactions.deleted_at (nullable, defaults NULL for
--    every existing row — nothing is retroactively "deleted"). Every read
--    path (bootstrap/month/export) now filters deleted_at is null, so a
--    soft-deleted row disappears from the app exactly like a hard delete
--    did — except it can be restored. The loan-remaining and goal-current
--    sync triggers are taught to treat a deleted_at transition the same as
--    a delete/insert (reverse on delete, re-apply on restore), so a soft-
--    deleted loan_pay or goal_save can't leave stale balances behind.
--
-- 2. accounts.is_liquid (boolean, default true — every existing account,
--    savings included, keeps today's behavior unchanged). Only meaningful
--    for a savings account: false marks it "tiết kiệm dài hạn" (locked),
--    excluded from F.financialPosition's liquid/liquidNet but still fully
--    counted in totalAssets/netWorth, exactly like the spec's split.
--
-- 3. accounts.asset_type (free text, nullable). Only meaningful for an
--    investment account — lets it carry "Cổ phiếu", "Vàng", "Quỹ ETF"...
--    without overloading the name field.

alter table taichinh_gd.transactions add column if not exists deleted_at timestamptz;
alter table taichinh_gd.accounts add column if not exists is_liquid boolean not null default true;
alter table taichinh_gd.accounts add column if not exists asset_type text;

create or replace function taichinh_gd.sync_loan_remaining_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, taichinh_gd
as $$
declare
  v_type text;
begin
  if tg_op in ('DELETE','UPDATE')
     and old.loan_id is not null
     and old.transaction_type in ('loan_pay','loan_collect')
     and old.deleted_at is null then
    update taichinh_gd.loans
       set remaining_amount = least(principal, remaining_amount + old.amount),
           updated_at = now()
     where id = old.loan_id;
  end if;

  if tg_op in ('INSERT','UPDATE')
     and new.loan_id is not null
     and new.transaction_type in ('loan_pay','loan_collect')
     and new.deleted_at is null then
    select loan_type into v_type
      from taichinh_gd.loans
     where id = new.loan_id
       and household_id = new.household_id;

    if v_type is null then
      raise exception 'loan_not_found';
    end if;
    if new.transaction_type = 'loan_pay' and v_type <> 'borrowed' then
      raise exception 'loan_type_mismatch';
    end if;
    if new.transaction_type = 'loan_collect' and v_type <> 'lent' then
      raise exception 'loan_type_mismatch';
    end if;

    update taichinh_gd.loans
       set remaining_amount = remaining_amount - new.amount,
           updated_at = now()
     where id = new.loan_id
       and remaining_amount >= new.amount;

    if not found then
      raise exception 'payment_exceeds_remaining';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function taichinh_gd.sync_goal_current_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd
as $$
declare
  old_delta numeric := 0;
  new_delta numeric := 0;
begin
  if tg_op in ('UPDATE','DELETE') and old.goal_id is not null and old.deleted_at is null then
    old_delta := case old.transaction_type when 'goal_save' then old.amount when 'goal_withdraw' then -old.amount else 0 end;
    if old_delta <> 0 then
      update taichinh_gd.goals
      set current_amount = greatest(0, current_amount - old_delta),
          is_completed = (greatest(0, current_amount - old_delta) >= target_amount)
      where id = old.goal_id and household_id = old.household_id;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') and new.goal_id is not null and new.deleted_at is null then
    new_delta := case new.transaction_type when 'goal_save' then new.amount when 'goal_withdraw' then -new.amount else 0 end;
    if new_delta <> 0 then
      update taichinh_gd.goals
      set current_amount = greatest(0, current_amount + new_delta),
          is_completed = (greatest(0, current_amount + new_delta) >= target_amount)
      where id = new.goal_id and household_id = new.household_id;
    end if;
  end if;
  return coalesce(new,old);
end;
$$;

create or replace function public.taichinh_gd_api(p_key text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'taichinh_gd', 'taichinh_gd_private', 'extensions'
 set "TimeZone" to 'Asia/Tokyo'
as $function$
declare
  h uuid;
  v_id uuid;
  v_month date;
  v_category uuid;
  v_account uuid;
  v_transfer uuid;
  v_amount numeric;
  v_fx numeric;
  v_type text;
  v_direction text;
  v_cost_type text;
  v_name text;
  v_currency text;
  v_date date;
  v_color text;
  v_is_liquid boolean;
  v_asset_type text;
  v_result jsonb;
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'invalid_access_key' using errcode = '42501';
  end if;

  select household_id into h
  from taichinh_gd_private.app_config
  where id = 1
    and access_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');

  if h is null then
    raise exception 'invalid_access_key' using errcode = '42501';
  end if;

  p_action := lower(coalesce(p_action, ''));

  if p_action = 'health' then
    return jsonb_build_object('ok', true, 'version', 1);

  elsif p_action = 'bootstrap' then
    select jsonb_build_object(
      'household', (select to_jsonb(x) from (
        select id, name, base_currency from taichinh_gd.households where id = h
      ) x),
      'accounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.name) from (
        select id, name, account_type, currency, opening_balance, is_active, sort_order, is_liquid, asset_type
        from taichinh_gd.accounts where household_id = h order by sort_order, name
      ) x), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(to_jsonb(x) order by x.direction desc, x.sort_order, x.name) from (
        select c.id, c.direction, c.color, coalesce(cv.sort_order, c.sort_order) as sort_order, coalesce(cv.is_active, c.is_active) as is_active,
               coalesce(cv.name, c.name) as name,
               coalesce(cv.cost_type, c.cost_type) as cost_type,
               coalesce(cv.planned_amount, 0) as planned_amount,
               cv.effective_month
        from taichinh_gd.categories c
        left join lateral (
          select v.name, v.cost_type, v.planned_amount, v.effective_month, v.is_active, v.sort_order
          from taichinh_gd.category_versions v
          where v.category_id = c.id
            and v.effective_month <= date_trunc('month', current_date)::date
          order by v.effective_month desc limit 1
        ) cv on true
        where c.household_id = h and (cv.effective_month is not null or not exists (select 1 from taichinh_gd.category_versions vx where vx.category_id = c.id))
      ) x), '[]'::jsonb),
      'category_versions', coalesce((select jsonb_agg(to_jsonb(v) order by v.effective_month desc) from (
        select id, category_id, effective_month, name, cost_type, planned_amount, is_active, sort_order
        from taichinh_gd.category_versions where household_id = h
      ) v), '[]'::jsonb),
      'transactions', coalesce((select jsonb_agg(to_jsonb(x) order by x.transaction_date desc, x.created_at desc) from (
        select t.id, t.account_id, t.category_id, t.transfer_account_id, t.transaction_type,
               t.amount, t.currency, t.fx_rate, t.transaction_date, t.note, t.created_at,
               coalesce(cv.name, c.name) as category_name,
               a.name as account_name, ta.name as transfer_account_name
        from taichinh_gd.transactions t
        left join taichinh_gd.categories c on c.id = t.category_id
        left join lateral (
          select v.name
          from taichinh_gd.category_versions v
          where v.category_id = t.category_id
            and v.effective_month <= date_trunc('month', t.transaction_date)::date
          order by v.effective_month desc limit 1
        ) cv on true
        left join taichinh_gd.accounts a on a.id = t.account_id
        left join taichinh_gd.accounts ta on ta.id = t.transfer_account_id
        where t.household_id = h and t.deleted_at is null
        order by t.transaction_date desc, t.created_at desc
        limit 200
      ) x), '[]'::jsonb),
      'goals', coalesce((select jsonb_agg(to_jsonb(x) order by x.is_completed, x.target_date nulls last, x.created_at) from (
        select id, name, target_amount, current_amount, currency, target_date, is_completed, created_at
        from taichinh_gd.goals where household_id = h
      ) x), '[]'::jsonb),
      'loans', coalesce((select jsonb_agg(to_jsonb(x) order by x.remaining_amount desc, x.start_date desc) from (
        select id, counterparty, loan_type, principal, remaining_amount, currency, start_date, due_date, note
        from taichinh_gd.loans where household_id = h
      ) x), '[]'::jsonb),
      'monthly_summary', coalesce((select jsonb_agg(to_jsonb(x) order by x.month) from (
        with months as (
          select generate_series(
            date_trunc('month', current_date) - interval '11 months',
            date_trunc('month', current_date),
            interval '1 month'
          )::date as month
        )
        select m.month,
               coalesce(sum(case when t.transaction_type = 'income' then t.amount * t.fx_rate else 0 end),0) as income,
               coalesce(sum(case when t.transaction_type = 'expense' then t.amount * t.fx_rate else 0 end),0) as expense
        from months m
        left join taichinh_gd.transactions t
          on t.household_id = h
         and t.transaction_date >= m.month
         and t.transaction_date < (m.month + interval '1 month')
         and t.deleted_at is null
        group by m.month
        order by m.month
      ) x), '[]'::jsonb)
    ) into v_result;
    return v_result;

  elsif p_action = 'month' then
    v_month := coalesce(nullif(p_payload->>'month','')::date, date_trunc('month', current_date)::date);
    v_month := date_trunc('month', v_month)::date;
    return jsonb_build_object(
      'month', v_month,
      'categories', coalesce((select jsonb_agg(to_jsonb(x) order by x.direction desc, x.sort_order, x.name) from (
        select c.id, c.direction, c.color, coalesce(cv.sort_order, c.sort_order) as sort_order, coalesce(cv.is_active, c.is_active) as is_active,
               coalesce(cv.name, c.name) as name,
               coalesce(cv.cost_type, c.cost_type) as cost_type,
               coalesce(cv.planned_amount, 0) as planned_amount,
               cv.effective_month
        from taichinh_gd.categories c
        left join lateral (
          select v.name, v.cost_type, v.planned_amount, v.effective_month, v.is_active, v.sort_order
          from taichinh_gd.category_versions v
          where v.category_id = c.id and v.effective_month <= v_month
          order by v.effective_month desc limit 1
        ) cv on true
        where c.household_id = h and (cv.effective_month is not null or not exists (select 1 from taichinh_gd.category_versions vx where vx.category_id = c.id))
      ) x), '[]'::jsonb),
      'transactions', coalesce((select jsonb_agg(to_jsonb(x) order by x.transaction_date desc, x.created_at desc) from (
        select t.id, t.account_id, t.category_id, t.transfer_account_id, t.transaction_type,
               t.amount, t.currency, t.fx_rate, t.transaction_date, t.note, t.created_at,
               coalesce(cv.name, c.name) as category_name,
               a.name as account_name, ta.name as transfer_account_name
        from taichinh_gd.transactions t
        left join taichinh_gd.categories c on c.id = t.category_id
        left join lateral (
          select v.name from taichinh_gd.category_versions v
          where v.category_id = t.category_id and v.effective_month <= v_month
          order by v.effective_month desc limit 1
        ) cv on true
        left join taichinh_gd.accounts a on a.id = t.account_id
        left join taichinh_gd.accounts ta on ta.id = t.transfer_account_id
        where t.household_id = h
          and t.transaction_date >= v_month
          and t.transaction_date < (v_month + interval '1 month')
          and t.deleted_at is null
      ) x), '[]'::jsonb)
    );

  elsif p_action = 'save_transaction' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_type := coalesce(nullif(p_payload->>'transaction_type',''), 'expense');
    if v_type not in ('income','expense','transfer') then
      raise exception 'invalid_transaction_type';
    end if;
    v_amount := nullif(p_payload->>'amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'amount_must_be_positive'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''), (select base_currency from taichinh_gd.households where id=h));
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    v_fx := coalesce(nullif(p_payload->>'fx_rate','')::numeric, 1);
    if v_fx <= 0 then raise exception 'invalid_fx_rate'; end if;
    v_date := coalesce(nullif(p_payload->>'transaction_date','')::date, current_date);
    v_category := nullif(p_payload->>'category_id','')::uuid;
    v_account := nullif(p_payload->>'account_id','')::uuid;
    v_transfer := nullif(p_payload->>'transfer_account_id','')::uuid;

    if v_category is not null and not exists(select 1 from taichinh_gd.categories where id=v_category and household_id=h) then
      raise exception 'invalid_category';
    end if;
    if v_account is not null and not exists(select 1 from taichinh_gd.accounts where id=v_account and household_id=h) then
      raise exception 'invalid_account';
    end if;
    if v_transfer is not null and not exists(select 1 from taichinh_gd.accounts where id=v_transfer and household_id=h) then
      raise exception 'invalid_transfer_account';
    end if;

    if v_id is null then
      insert into taichinh_gd.transactions(
        household_id, account_id, category_id, transfer_account_id, transaction_type,
        amount, currency, fx_rate, transaction_date, note, created_by
      ) values (
        h, v_account, case when v_type='transfer' then null else v_category end,
        case when v_type='transfer' then v_transfer else null end,
        v_type, v_amount, v_currency, v_fx, v_date, nullif(btrim(p_payload->>'note'),''), null
      ) returning id into v_id;
    else
      update taichinh_gd.transactions set
        account_id = v_account,
        category_id = case when v_type='transfer' then null else v_category end,
        transfer_account_id = case when v_type='transfer' then v_transfer else null end,
        transaction_type = v_type,
        amount = v_amount,
        currency = v_currency,
        fx_rate = v_fx,
        transaction_date = v_date,
        note = nullif(btrim(p_payload->>'note'),'')
      where id = v_id and household_id = h and deleted_at is null;
      if not found then raise exception 'transaction_not_found'; end if;
    end if;
    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'delete_transaction' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.transactions set deleted_at = now()
      where id = v_id and household_id = h and deleted_at is null;
    return jsonb_build_object('ok', found);

  elsif p_action = 'restore_transaction' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.transactions set deleted_at = null
      where id = v_id and household_id = h and deleted_at is not null;
    return jsonb_build_object('ok', found);

  elsif p_action = 'deleted_transactions' then
    return jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(x) order by x.deleted_at desc) from (
      select t.id, t.account_id, t.category_id, t.transfer_account_id, t.transaction_type,
             t.amount, t.currency, t.transaction_date, t.note, t.deleted_at,
             coalesce(cv.name, c.name) as category_name,
             a.name as account_name, ta.name as transfer_account_name
      from taichinh_gd.transactions t
      left join taichinh_gd.categories c on c.id = t.category_id
      left join lateral (
        select v.name from taichinh_gd.category_versions v
        where v.category_id = t.category_id and v.effective_month <= date_trunc('month', t.transaction_date)::date
        order by v.effective_month desc limit 1
      ) cv on true
      left join taichinh_gd.accounts a on a.id = t.account_id
      left join taichinh_gd.accounts ta on ta.id = t.transfer_account_id
      where t.household_id = h and t.deleted_at is not null
      order by t.deleted_at desc
      limit 50
    ) x), '[]'::jsonb));

  elsif p_action = 'save_category' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_name := nullif(btrim(p_payload->>'name'),'');
    if v_name is null then raise exception 'category_name_required'; end if;
    v_direction := coalesce(nullif(p_payload->>'direction',''), 'expense');
    if v_direction not in ('income','expense') then raise exception 'invalid_direction'; end if;
    v_cost_type := nullif(p_payload->>'cost_type','');
    if v_direction='income' then v_cost_type := null; end if;
    if v_cost_type is not null and v_cost_type not in ('fixed','variable') then raise exception 'invalid_cost_type'; end if;
    v_color := coalesce(nullif(p_payload->>'color',''), '#64748b');
    v_month := coalesce(nullif(p_payload->>'effective_month','')::date, date_trunc('month', current_date)::date);
    v_month := date_trunc('month', v_month)::date;
    v_amount := coalesce(nullif(p_payload->>'planned_amount','')::numeric,0);
    if v_amount < 0 then raise exception 'planned_amount_negative'; end if;

    if v_id is null then
      insert into taichinh_gd.categories(household_id,name,direction,cost_type,color,sort_order,is_active)
      values (h,v_name,v_direction,v_cost_type,v_color,
              coalesce((select max(sort_order)+10 from taichinh_gd.categories where household_id=h),10),true)
      returning id into v_id;
    else
      update taichinh_gd.categories
      set name=v_name,direction=v_direction,cost_type=v_cost_type,color=v_color,is_active=true
      where id=v_id and household_id=h;
      if not found then raise exception 'category_not_found'; end if;
    end if;

    insert into taichinh_gd.category_versions(household_id,category_id,effective_month,name,cost_type,planned_amount,sort_order,is_active)
    values (h,v_id,v_month,v_name,v_cost_type,v_amount,coalesce((select sort_order from taichinh_gd.categories where id=v_id),10),true)
    on conflict (category_id,effective_month)
    do update set name=excluded.name,cost_type=excluded.cost_type,planned_amount=excluded.planned_amount,sort_order=excluded.sort_order,is_active=true;

    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'archive_category' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.categories set is_active=false where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'save_account' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_name := nullif(btrim(p_payload->>'name'),'');
    if v_name is null then raise exception 'account_name_required'; end if;
    v_type := coalesce(nullif(p_payload->>'account_type',''),'cash');
    if v_type not in ('cash','bank','credit','savings','investment','loan_receivable','loan_payable') then raise exception 'invalid_account_type'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''),'JPY');
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    v_amount := coalesce(nullif(p_payload->>'opening_balance','')::numeric,0);
    v_is_liquid := coalesce((nullif(p_payload->>'is_liquid',''))::boolean, true);
    v_asset_type := nullif(btrim(p_payload->>'asset_type'),'');

    if v_id is null then
      insert into taichinh_gd.accounts(household_id,name,account_type,currency,opening_balance,sort_order,is_active,is_liquid,asset_type)
      values (h,v_name,v_type,v_currency,v_amount,
              coalesce((select max(sort_order)+10 from taichinh_gd.accounts where household_id=h),10),true,v_is_liquid,v_asset_type)
      returning id into v_id;
    else
      update taichinh_gd.accounts
      set name=v_name,account_type=v_type,currency=v_currency,opening_balance=v_amount,is_active=true,is_liquid=v_is_liquid,asset_type=v_asset_type
      where id=v_id and household_id=h;
      if not found then raise exception 'account_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'archive_account' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.accounts set is_active=false where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'unarchive_account' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.accounts set is_active=true where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'save_goal' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_name := nullif(btrim(p_payload->>'name'),'');
    if v_name is null then raise exception 'goal_name_required'; end if;
    v_amount := nullif(p_payload->>'target_amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'target_amount_must_be_positive'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''),'JPY');
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    if v_id is null then
      insert into taichinh_gd.goals(household_id,name,target_amount,current_amount,currency,target_date,is_completed)
      values (h,v_name,v_amount,coalesce(nullif(p_payload->>'current_amount','')::numeric,0),v_currency,
              nullif(p_payload->>'target_date','')::date,coalesce((p_payload->>'is_completed')::boolean,false))
      returning id into v_id;
    else
      update taichinh_gd.goals set
        name=v_name,target_amount=v_amount,
        current_amount=coalesce(nullif(p_payload->>'current_amount','')::numeric,0),
        currency=v_currency,target_date=nullif(p_payload->>'target_date','')::date,
        is_completed=coalesce((p_payload->>'is_completed')::boolean,false)
      where id=v_id and household_id=h;
      if not found then raise exception 'goal_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_goal' then
    v_id := nullif(p_payload->>'id','')::uuid;
    delete from taichinh_gd.goals where id=v_id and household_id=h;
    return jsonb_build_object('ok',found);

  elsif p_action = 'save_loan' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_name := nullif(btrim(p_payload->>'counterparty'),'');
    if v_name is null then raise exception 'counterparty_required'; end if;
    v_type := coalesce(nullif(p_payload->>'loan_type',''),'borrowed');
    if v_type not in ('lent','borrowed') then raise exception 'invalid_loan_type'; end if;
    v_amount := nullif(p_payload->>'principal','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'principal_must_be_positive'; end if;
    v_currency := coalesce(nullif(p_payload->>'currency',''),'JPY');
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    if v_id is null then
      insert into taichinh_gd.loans(household_id,counterparty,loan_type,principal,remaining_amount,currency,start_date,due_date,note)
      values (h,v_name,v_type,v_amount,coalesce(nullif(p_payload->>'remaining_amount','')::numeric,v_amount),v_currency,
              coalesce(nullif(p_payload->>'start_date','')::date,current_date),nullif(p_payload->>'due_date','')::date,
              nullif(btrim(p_payload->>'note'),''))
      returning id into v_id;
    else
      update taichinh_gd.loans set
        counterparty=v_name,loan_type=v_type,principal=v_amount,
        remaining_amount=coalesce(nullif(p_payload->>'remaining_amount','')::numeric,v_amount),
        currency=v_currency,start_date=coalesce(nullif(p_payload->>'start_date','')::date,current_date),
        due_date=nullif(p_payload->>'due_date','')::date,note=nullif(btrim(p_payload->>'note'),'')
      where id=v_id and household_id=h;
      if not found then raise exception 'loan_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete_loan' then
    v_id := nullif(p_payload->>'id','')::uuid;
    delete from taichinh_gd.loans where id=v_id and household_id=h;
    return jsonb_build_object('ok',found);

  elsif p_action = 'save_household' then
    v_name := coalesce(nullif(btrim(p_payload->>'name'),''),'Gia đình');
    v_currency := coalesce(nullif(p_payload->>'base_currency',''),'JPY');
    if v_currency not in ('JPY','VND') then raise exception 'invalid_currency'; end if;
    update taichinh_gd.households set name=v_name, base_currency=v_currency where id=h;
    return jsonb_build_object('ok',true);

  elsif p_action = 'export' then
    return jsonb_build_object(
      'exported_at', now(),
      'household', (select to_jsonb(x) from (select * from taichinh_gd.households where id=h) x),
      'accounts', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from taichinh_gd.accounts where household_id=h) x),'[]'::jsonb),
      'categories', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from taichinh_gd.categories where household_id=h) x),'[]'::jsonb),
      'category_versions', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from taichinh_gd.category_versions where household_id=h) x),'[]'::jsonb),
      'transactions', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from taichinh_gd.transactions where household_id=h and deleted_at is null) x),'[]'::jsonb),
      'goals', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from taichinh_gd.goals where household_id=h) x),'[]'::jsonb),
      'loans', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from taichinh_gd.loans where household_id=h) x),'[]'::jsonb)
    );

  else
    raise exception 'unknown_action';
  end if;
end;
$function$;
