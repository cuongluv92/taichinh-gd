-- ---------------------------------------------------------------------
-- Bonus (ボーナス併用払い) cho trả góp + kỳ đầu gánh phần dư + kỳ có thể sửa tay.
--
-- 1. bonus_months/bonus_amount: hộ gia đình tự chọn (những) tháng nào
--    trong 12 tháng được cộng thêm một khoản bonus cố định (nhập tay) —
--    không cố định 1/7/12, có thể chọn 1, 2 hay nhiều tháng cùng lúc.
--    Theo đúng cách người Nhật
--    tính ボーナス併用払い: khoản bonus (đã nhập tay, không tự suy ra) được
--    TRỪ RA khỏi principal_amount trước, phần còn lại mới chia đều cho MỌI
--    kỳ (kể cả kỳ bonus) — rồi kỳ bonus mới được cộng thêm đúng số bonus đó
--    vào riêng kỳ mình. Nhờ vậy tổng cả lịch luôn khớp đúng principal_amount,
--    không cộng thêm ra ngoài giá mua.
-- 2. Kỳ đầu tiên (installment_no=1) gánh phần dư của phép chia phần "thường"
--    (không chia hết cho total_installments), các kỳ còn lại chia đều bằng
--    floor() — thay vì round() từng kỳ khiến tổng cộng lệch khỏi giá mua.
-- 3. edit_schedule_row: sửa tay đúng một kỳ, không tính lại cả lịch — chỗ
--    thoát hiểm khi cách chia tự động không khớp thực tế (ngân hàng làm
--    tròn khác, hoặc muốn điều chỉnh riêng một kỳ).
-- ---------------------------------------------------------------------

alter table taichinh_gd.credit_card_installments
  add column if not exists bonus_months smallint[] not null default '{}'::smallint[],
  add column if not exists bonus_amount numeric not null default 0;

create or replace function public.taichinh_gd_card_ledger_api(p_key text, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd, taichinh_gd_private, extensions
set "TimeZone" = 'Asia/Tokyo'
as $function$
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
  v_bonus_months smallint[];
  v_bonus_amount numeric;
  v_bonus_count int;
  v_base_total numeric;
  v_regular numeric;
  v_fee_total numeric;
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
             i.bonus_months, i.bonus_amount,
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
    v_fee_total := coalesce(nullif(p_payload->>'fee_total','')::numeric,0);

    -- Tháng bonus do hộ gia đình TỰ CHỌN (không cố định 1/7/12, mỗi công ty
    -- trả thưởng khác tháng nhau) — chọn được nhiều tháng cùng lúc.
    select coalesce(array_agg(x::smallint), '{}'::smallint[]) into v_bonus_months
    from jsonb_array_elements_text(coalesce(p_payload->'bonus_months', '[]'::jsonb)) x;
    if exists (select 1 from unnest(v_bonus_months) m where m < 1 or m > 12) then
      raise exception 'invalid_bonus_month';
    end if;
    v_bonus_amount := coalesce(nullif(p_payload->>'bonus_amount','')::numeric, 0);
    if v_bonus_amount < 0 then raise exception 'bonus_amount_must_be_nonnegative'; end if;
    if array_length(v_bonus_months,1) > 0 and v_bonus_amount <= 0 then raise exception 'bonus_amount_required'; end if;
    if array_length(v_bonus_months,1) is null and v_bonus_amount > 0 then raise exception 'bonus_months_required'; end if;

    select count(*) into v_bonus_count
    from generate_series(1, v_total_installments) gs
    where extract(month from (v_first_month + ((gs - v_paid_before - 1) || ' months')::interval))::int = any(v_bonus_months);

    if v_bonus_count > 0 and v_bonus_amount * v_bonus_count >= v_amount then
      raise exception 'bonus_amount_too_large';
    end if;
    v_base_total := v_amount - v_bonus_count * v_bonus_amount;
    v_regular := floor(v_base_total / v_total_installments);

    if v_id is not null then
      update taichinh_gd.credit_card_installments
      set card_account_id=v_card, name=v_name, purchase_date=v_date, principal_amount=v_amount,
          fee_total=v_fee_total, total_installments=v_total_installments,
          first_payment_month=v_first_month, currency=coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_card)),
          note=nullif(btrim(p_payload->>'note'),''), entry_mode=case when v_paid_before>0 then 'existing' else 'purchase' end,
          paid_installments_before=v_paid_before, bonus_months=v_bonus_months, bonus_amount=v_bonus_amount, updated_at=now()
      where id=v_id and household_id=h;
      if not found then raise exception 'installment_not_found'; end if;
      delete from taichinh_gd.credit_card_installment_schedule where installment_id=v_id and household_id=h;
    else
      insert into taichinh_gd.credit_card_installments(
        household_id, card_account_id, name, purchase_date, principal_amount, fee_total,
        total_installments, first_payment_month, currency, note, entry_mode, schedule_mode, paid_installments_before,
        bonus_months, bonus_amount
      ) values (
        h, v_card, v_name, v_date, v_amount, v_fee_total,
        v_total_installments, v_first_month, coalesce(nullif(p_payload->>'currency',''), (select currency from taichinh_gd.accounts where id=v_card)),
        nullif(btrim(p_payload->>'note'),''), case when v_paid_before>0 then 'existing' else 'purchase' end, 'equal', v_paid_before,
        v_bonus_months, v_bonus_amount
      ) returning id into v_id;
    end if;

    insert into taichinh_gd.credit_card_installment_schedule(household_id, installment_id, installment_no, payment_month, principal_amount, fee_amount, is_paid, payment_kind)
    select h, v_id, gs, pm,
           (case when gs = 1 then v_base_total - v_regular * (v_total_installments - 1) else v_regular end)
             + case when extract(month from pm)::int = any(v_bonus_months) then v_bonus_amount else 0 end,
           round(v_fee_total / v_total_installments),
           gs <= v_paid_before,
           case when extract(month from pm)::int = any(v_bonus_months) then 'bonus' else 'regular' end
    from (select gs, (v_first_month + ((gs - v_paid_before - 1) || ' months')::interval)::date as pm from generate_series(1, v_total_installments) gs) s;

    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'edit_schedule_row' then
    -- Escape hatch: the auto-generated split can be wrong for a household's
    -- real contract (bank rounds differently, a one-off adjustment, etc.) —
    -- let them fix a single kỳ directly instead of fighting the generator.
    v_id := nullif(p_payload->>'id','')::uuid;
    v_amount := nullif(p_payload->>'principal_amount','')::numeric;
    if v_amount is null or v_amount <= 0 then raise exception 'principal_must_be_positive'; end if;
    update taichinh_gd.credit_card_installment_schedule
    set principal_amount = v_amount
    where id = v_id and household_id = h;
    return jsonb_build_object('ok', found);

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
