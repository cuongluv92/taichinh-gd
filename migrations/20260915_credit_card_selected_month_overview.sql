create or replace function public.taichinh_gd_credit_card_month_api(p_key text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, taichinh_gd, taichinh_gd_private, extensions
set "TimeZone" = 'Asia/Tokyo'
as $$
declare
  h uuid;
  v_month date;
  v_result jsonb;
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'invalid_access_key' using errcode='42501';
  end if;

  select household_id into h
  from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  v_month := date_trunc('month',coalesce(p_month,current_date))::date;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.card_name),'[]'::jsonb)
  into v_result
  from (
    select a.id account_id,a.name card_name,a.currency,
      v_month payment_month,
      taichinh_gd.card_clamped_day(v_month,s.payment_day) payment_date,
      coalesce((
        select sum(t.amount)
        from taichinh_gd.transactions t
        left join taichinh_gd.credit_card_installments ci
          on ci.purchase_transaction_id=t.id and ci.household_id=h
        where t.household_id=h
          and t.account_id=a.id
          and t.transaction_type='expense'
          and ci.id is null
          and taichinh_gd.card_payment_month(t.transaction_date,s.closing_day,s.payment_month_offset)=v_month
      ),0) regular_amount,
      coalesce((
        select sum(cs.principal_amount)
        from taichinh_gd.credit_card_installment_schedule cs
        join taichinh_gd.credit_card_installments ci on ci.id=cs.installment_id
        where cs.household_id=h and ci.card_account_id=a.id and cs.payment_month=v_month
      ),0) installment_principal,
      coalesce((
        select sum(cs.fee_amount)
        from taichinh_gd.credit_card_installment_schedule cs
        join taichinh_gd.credit_card_installments ci on ci.id=cs.installment_id
        where cs.household_id=h and ci.card_account_id=a.id and cs.payment_month=v_month
      ),0) installment_fee,
      coalesce((
        select sum(t.amount)
        from taichinh_gd.transactions t
        left join taichinh_gd.credit_card_installments ci
          on ci.purchase_transaction_id=t.id and ci.household_id=h
        where t.household_id=h
          and t.account_id=a.id
          and t.transaction_type='expense'
          and ci.id is null
          and taichinh_gd.card_payment_month(t.transaction_date,s.closing_day,s.payment_month_offset)=v_month
      ),0)
      + coalesce((
        select sum(cs.principal_amount+cs.fee_amount)
        from taichinh_gd.credit_card_installment_schedule cs
        join taichinh_gd.credit_card_installments ci on ci.id=cs.installment_id
        where cs.household_id=h and ci.card_account_id=a.id and cs.payment_month=v_month
      ),0) expected_amount,
      exists(
        select 1 from taichinh_gd.credit_card_statement_payments sp
        where sp.household_id=h and sp.card_account_id=a.id and sp.payment_month=v_month
      ) paid
    from taichinh_gd.accounts a
    join taichinh_gd.credit_card_settings s on s.account_id=a.id and s.household_id=h
    where a.household_id=h and a.is_active and a.account_type='credit'
  ) x;

  return jsonb_build_object('month',v_month,'items',v_result);
end;
$$;

revoke all on function public.taichinh_gd_credit_card_month_api(text,date) from public;
grant execute on function public.taichinh_gd_credit_card_month_api(text,date) to anon, service_role;
