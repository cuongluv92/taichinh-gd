-- Rebuild the trả góp (installment) calculation per user's formal spec.
--
-- Root cause of the whole back-and-forth today: the real bank statement
-- (Yamada Denki, 219,800 / 24 kỳ, bonus tháng 1+7 = 20,000/lần) rounds the
-- per-kỳ regular amount DOWN to the nearest 100 JPY before computing kỳ 1's
-- remainder:
--   B = 20,000 × 4 = 80,000
--   R = 219,800 − 80,000 = 139,800
--   S = floor((139,800 / 24) / 100) × 100 = floor(58.25) × 100 = 5,800   (not 5,825!)
--   kỳ1 = 139,800 − 5,800×23 = 6,400
--   kỳ bonus = 5,800 + 20,000 = 25,800
-- matches the statement 100%. bonus_amounts is genuinely an ADD-ON (not the
-- month's total) — that was correct all along; the missing piece was the
-- round-to-100 step, which is what pulled 5,825 down to 5,800 and pushed
-- the difference into kỳ 1.
--
-- Schema changes:
-- - credit_card_installments: rounding_unit (1/10/100/1000, default 100),
--   remainder_period ('first'/'last', default 'first').
-- - credit_card_installment_schedule: bonus_amount (numeric, default 0) —
--   bonus is now its own column instead of being folded into
--   principal_amount, so "tiền trả thường" and "tiền bonus" can always be
--   shown and edited separately (principal_amount = regular portion only).
--
-- Function changes (taichinh_gd_card_ledger_api):
-- - save_installment: regular kỳ = floor((R/N)/rounding_unit)×rounding_unit
--   for every kỳ except the remainder kỳ (first or last, per
--   remainder_period), which absorbs R − regular×(N−1). Bonus kỳ get their
--   configured bonus_amounts value ADDED on top, stored in the new
--   bonus_amount column.
-- - edit_schedule_row: now takes the kỳ's TOTAL amount (what's printed on a
--   statement) and stores principal_amount = total − that row's existing
--   bonus_amount (bonus itself is never touched by a plain edit).
-- - resplit_installment_from_first replaced by resplit_installment, which
--   generalizes "sửa 1 kỳ rồi chia lại các kỳ còn lại" to ANY kỳ (đầu, giữa,
--   cuối), matching the user's spec section 6: paid kỳ and the edited kỳ
--   stay fixed, every other unpaid non-bonus kỳ splits the remainder
--   evenly (rounded to rounding_unit); the remainder-of-remainder goes to
--   the LAST of that group normally, or the FIRST when the edited kỳ is
--   itself the schedule's last kỳ (so the absorbing kỳ is always the one
--   farthest from the edit).

alter table taichinh_gd.credit_card_installments
  add column if not exists rounding_unit numeric not null default 100,
  add column if not exists remainder_period text not null default 'first';

alter table taichinh_gd.credit_card_installments
  drop constraint if exists credit_card_installments_rounding_unit_check,
  add constraint credit_card_installments_rounding_unit_check check (rounding_unit in (1,10,100,1000)),
  drop constraint if exists credit_card_installments_remainder_period_check,
  add constraint credit_card_installments_remainder_period_check check (remainder_period in ('first','last'));

alter table taichinh_gd.credit_card_installment_schedule
  add column if not exists bonus_amount numeric not null default 0;

create or replace function public.taichinh_gd_card_ledger_api(p_key text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'taichinh_gd', 'taichinh_gd_private', 'extensions'
 set "TimeZone" to 'Asia/Tokyo'
as $function$
declare
  h uuid;
  v_id uuid;
  v_row uuid;
  v_card uuid;
  v_mode text;
  v_amount numeric;
  v_date date;
  v_name text;
  v_total_installments int;
  v_paid_before int;
  v_first_month date;
  v_bonus_amounts jsonb;
  v_total_bonus numeric;
  v_base_total numeric;
  v_regular numeric;
  v_fee_total numeric;
  v_count_rest int;
  v_principal numeric;
  v_rounding numeric;
  v_remainder_period text;
  v_bonus_amt numeric;
  v_edited_regular numeric;
  v_edited_no int;
  v_last_no int;
  v_fixed_regular numeric;
begin
  if p_key is null or length(p_key) < 9 then raise exception 'invalid_access_key' using errcode='42501'; end if;
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
             i.bonus_amounts, i.rounding_unit, i.remainder_period,
             coalesce((select jsonb_agg(to_jsonb(s) order by s.payment_month) from (
               select id, installment_no, payment_month, principal_amount, bonus_amount, fee_amount, is_paid, payment_kind
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
    v_fee_total := coalesce(nullif(p_payload->>'fee_total','')::numeric,0);
    v_rounding := coalesce(nullif(p_payload->>'rounding_unit','')::numeric, 100);
    if v_rounding not in (1,10,100,1000) then raise exception 'invalid_rounding_unit'; end if;
    v_remainder_period := coalesce(nullif(p_payload->>'remainder_period',''), 'first');
    if v_remainder_period not in ('first','last') then raise exception 'invalid_remainder_period'; end if;

    v_bonus_amounts := coalesce(p_payload->'bonus_amounts', '{}'::jsonb);
    if jsonb_typeof(v_bonus_amounts) <> 'object' then raise exception 'invalid_bonus_month'; end if;
    if exists (
      select 1 from jsonb_each_text(v_bonus_amounts) kv
      where kv.key !~ '^\d+$' or kv.key::int < 1 or kv.key::int > 12 or nullif(kv.value,'')::numeric is null or nullif(kv.value,'')::numeric <= 0
    ) then
      raise exception 'invalid_bonus_month';
    end if;

    -- bonus_amounts[thang] la khoan CONG THEM ngoai tien tra thuong (khong
    -- phai tong tien phai tra thang do) - dung nhu tren sao ke ngan hang.
    select coalesce(sum((v_bonus_amounts->>key)::numeric * cnt), 0)
    into v_total_bonus
    from jsonb_object_keys(v_bonus_amounts) key,
    lateral (
      select count(*) cnt from generate_series(1, v_total_installments) gs
      where extract(month from (v_first_month + ((gs - v_paid_before - 1) || ' months')::interval))::int = key::int
    ) c;

    if v_total_bonus >= v_amount then raise exception 'bonus_amount_too_large'; end if;
    v_base_total := v_amount - v_total_bonus;
    v_regular := floor((v_base_total / v_total_installments) / v_rounding) * v_rounding;

    if v_id is not null then
      update taichinh_gd.credit_card_installments
      set card_account_id=v_card, name=v_name, purchase_date=v_date, principal_amount=v_amount,
          fee_total=v_fee_total, total_installments=v_total_installments,
          first_payment_month=v_first_month, currency=coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_card)),
          note=nullif(btrim(p_payload->>'note'),''), entry_mode=case when v_paid_before>0 then 'existing' else 'purchase' end,
          paid_installments_before=v_paid_before, bonus_amounts=v_bonus_amounts,
          rounding_unit=v_rounding, remainder_period=v_remainder_period, updated_at=now()
      where id=v_id and household_id=h;
      if not found then raise exception 'installment_not_found'; end if;
      delete from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;
    else
      insert into taichinh_gd.credit_card_installments(
        household_id, card_account_id, name, purchase_date, principal_amount, fee_total,
        total_installments, first_payment_month, currency, note, entry_mode, schedule_mode, paid_installments_before,
        bonus_amounts, rounding_unit, remainder_period
      ) values (
        h, v_card, v_name, v_date, v_amount, v_fee_total,
        v_total_installments, v_first_month, coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_card)),
        nullif(btrim(p_payload->>'note'),''), case when v_paid_before>0 then 'existing' else 'purchase' end, 'equal', v_paid_before,
        v_bonus_amounts, v_rounding, v_remainder_period
      ) returning id into v_id;
    end if;

    insert into taichinh_gd.credit_card_installment_schedule(household_id, installment_id, installment_no, payment_month, principal_amount, bonus_amount, fee_amount, is_paid, payment_kind)
    select h, v_id, gs, pm,
           case
             when (v_remainder_period = 'first' and gs = 1) or (v_remainder_period = 'last' and gs = v_total_installments)
               then v_base_total - v_regular * (v_total_installments - 1)
             else v_regular
           end,
           coalesce((v_bonus_amounts->>(extract(month from pm)::int::text))::numeric, 0),
           round(v_fee_total / v_total_installments),
           gs <= v_paid_before,
           case when v_bonus_amounts ? (extract(month from pm)::int::text) then 'bonus' else 'regular' end
    from (select gs, (v_first_month + ((gs - v_paid_before - 1) || ' months')::interval)::date as pm from generate_series(1, v_total_installments) gs) s;

    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'edit_schedule_row' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_amount := nullif(p_payload->>'new_total_amount','')::numeric;
    if v_amount is null or v_amount < 0 then raise exception 'principal_must_be_positive'; end if;
    select bonus_amount into v_bonus_amt from taichinh_gd.credit_card_installment_schedule where id=v_id and household_id=h;
    if not found then raise exception 'schedule_row_not_found'; end if;
    if v_amount < v_bonus_amt then raise exception 'amount_below_bonus'; end if;
    update taichinh_gd.credit_card_installment_schedule
    set principal_amount = v_amount - v_bonus_amt
    where id = v_id and household_id = h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'resplit_installment' then
    v_id := nullif(p_payload->>'installment_id','')::uuid;
    v_row := nullif(p_payload->>'schedule_row_id','')::uuid;
    v_amount := nullif(p_payload->>'new_total_amount','')::numeric;
    if v_amount is null or v_amount < 0 then raise exception 'principal_must_be_positive'; end if;

    select principal_amount, rounding_unit into v_principal, v_rounding
    from taichinh_gd.credit_card_installments where id=v_id and household_id=h;
    if not found then raise exception 'installment_not_found'; end if;

    select installment_no, bonus_amount into v_edited_no, v_bonus_amt
    from taichinh_gd.credit_card_installment_schedule
    where id=v_row and installment_id=v_id and household_id=h;
    if not found then raise exception 'schedule_row_not_found'; end if;

    if v_amount < v_bonus_amt then raise exception 'amount_below_bonus'; end if;
    v_edited_regular := v_amount - v_bonus_amt;

    select coalesce(sum(bonus_amount),0) into v_total_bonus
    from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;

    -- fixedRegular = regular portion of everything OUTSIDE the redistribution
    -- pool: paid kỳ (their principal_amount never changes) AND bonus kỳ
    -- (their regular portion is untouched by resplit, only pool kỳ move) —
    -- plus the kỳ just edited. Missing the bonus-kỳ term here would let the
    -- pool "reuse" money already spoken for by bonus kỳ's own regular share.
    select coalesce(sum(principal_amount),0) into v_fixed_regular
    from taichinh_gd.credit_card_installment_schedule
    where installment_id=v_id and household_id=h and (is_paid or payment_kind='bonus') and id<>v_row;
    v_fixed_regular := v_fixed_regular + v_edited_regular;

    select max(installment_no) into v_last_no
    from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;

    select count(*) into v_count_rest
    from taichinh_gd.credit_card_installment_schedule
    where installment_id=v_id and household_id=h and payment_kind<>'bonus' and not is_paid and id<>v_row;
    if v_count_rest <= 0 then raise exception 'no_other_installments_to_resplit'; end if;

    v_base_total := v_principal - v_total_bonus - v_fixed_regular;
    if v_base_total < 0 then raise exception 'edited_amount_too_large'; end if;
    v_regular := floor((v_base_total / v_count_rest) / v_rounding) * v_rounding;

    update taichinh_gd.credit_card_installment_schedule
    set principal_amount = v_edited_regular
    where id = v_row and household_id = h;

    with eligible as (
      select id, row_number() over (order by installment_no) as rn, count(*) over () as cnt
      from taichinh_gd.credit_card_installment_schedule
      where installment_id = v_id and household_id = h and payment_kind <> 'bonus' and not is_paid and id <> v_row
    )
    update taichinh_gd.credit_card_installment_schedule s
    set principal_amount = case
      when v_edited_no = v_last_no and e.rn = 1 then v_base_total - v_regular * (e.cnt - 1)
      when v_edited_no <> v_last_no and e.rn = e.cnt then v_base_total - v_regular * (e.cnt - 1)
      else v_regular
    end
    from eligible e
    where s.id = e.id;

    return jsonb_build_object('ok', true);

  elsif p_action = 'delete_installment' then
    v_id := nullif(p_payload->>'id','')::uuid;
    delete from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;
    delete from taichinh_gd.credit_card_installments where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'toggle_paid' then
    v_id := nullif(p_payload->>'id','')::uuid;
    update taichinh_gd.credit_card_installment_schedule
    set is_paid = not is_paid, paid_at = case when not is_paid then now() else null end
    where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  else
    raise exception 'unknown_action';
  end if;
end;
$function$;
