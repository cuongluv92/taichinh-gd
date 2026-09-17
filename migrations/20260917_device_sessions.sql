-- Device sessions — lets the household see which devices are currently
-- holding the shared "khóa gia đình" and revoke one immediately, without
-- rotating the household key itself (which would silently kick out every
-- other device too, not just the one being logged out).
--
-- The whole app currently has exactly one shared secret (app_config.
-- access_hash) checked independently inside 9 separate RPC entrypoint
-- functions. Threading a per-device check through all 9 (each a large,
-- already-live function) would mean blind-reproducing bodies this
-- migration doesn't need to touch, for a personal finance app where that
-- risk isn't worth it. Instead, every device-session action lives entirely
-- inside taichinh_gd_extension_api — already the "small settings-page
-- action" function (get/save_reporting/save_loan_terms/bank_payment) — and
-- every client call into it now also carries the device's own session
-- token, so revocation is checked on every extension.* call (get,
-- save_reporting, save_loan_terms, bank_payment, register_device,
-- revoke_device), which in practice fires on nearly every user action
-- (boot, month change, every save-triggered refresh) plus a periodic
-- client heartbeat — "immediate" in effect without touching the other 8
-- functions at all.
--
-- A device with no session_hash row (never registered, or a one-off
-- register_device call failed) is never treated as revoked — only a row
-- that EXISTS with revoked_at set blocks that token. This avoids a
-- transient-network-failure self-lockout.

create table if not exists taichinh_gd.device_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  session_hash text not null,
  device_label text not null default 'Thiết bị',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists device_sessions_household_hash_idx
  on taichinh_gd.device_sessions(household_id, session_hash);
create index if not exists device_sessions_household_idx
  on taichinh_gd.device_sessions(household_id);
alter table taichinh_gd.device_sessions enable row level security;
-- No policies — exactly like every other table here, all access is
-- mediated by the SECURITY DEFINER RPC function below, never direct
-- PostgREST table access from anon/authenticated.

create or replace function public.taichinh_gd_extension_api(p_key text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'taichinh_gd', 'taichinh_gd_private', 'extensions'
 SET "TimeZone" TO 'Asia/Tokyo'
AS $function$
declare
  h uuid;
  v_loan uuid;
  v_account uuid;
  v_principal numeric;
  v_interest numeric;
  v_remaining numeric;
  v_currency text;
  v_loan_type text;
  v_date date;
  v_rate numeric;
  v_show boolean;
  v_kind text;
  v_method text;
  v_term integer;
  v_day integer;
  v_id uuid;
  v_interest_id uuid;
  v_session_token text;
  v_session_hash text;
  v_device_label text;
  v_device_id uuid;
  v_revoked timestamptz;
begin
  if p_key is null or length(p_key) < 32 then
    raise exception 'invalid_access_key' using errcode='42501';
  end if;

  select household_id into h
  from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  -- Device-session check/heartbeat, shared by every action below. A token
  -- with no matching row is silently ignored (see note above) — only an
  -- existing row with revoked_at set blocks the call.
  v_session_token := nullif(p_payload->>'session_token','');
  if v_session_token is not null then
    v_session_hash := encode(extensions.digest(v_session_token,'sha256'),'hex');
    select revoked_at into v_revoked
    from taichinh_gd.device_sessions
    where household_id=h and session_hash=v_session_hash;
    if found then
      if v_revoked is not null then
        raise exception 'device_revoked' using errcode='42501';
      end if;
      update taichinh_gd.device_sessions set last_seen_at=now()
        where household_id=h and session_hash=v_session_hash;
    end if;
  end if;

  p_action := lower(coalesce(p_action,''));

  if p_action='get' then
    return jsonb_build_object(
      'reporting', coalesce(
        (select jsonb_build_object(
          'show_vnd_conversion', show_vnd_conversion,
          'jpy_vnd_rate', jpy_vnd_rate,
          'updated_at', updated_at
        ) from taichinh_gd.reporting_settings where household_id=h),
        jsonb_build_object('show_vnd_conversion',false,'jpy_vnd_rate',null)
      ),
      'loan_terms', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.loan_id)
        from (
          select loan_id, loan_kind, institution_name, product_name,
                 annual_rate, repayment_method, term_months, payment_day, updated_at
          from taichinh_gd.loan_terms
          where household_id=h
        ) x
      ),'[]'::jsonb),
      'device_sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'device_label', d.device_label,
          'created_at', d.created_at,
          'last_seen_at', d.last_seen_at,
          'revoked_at', d.revoked_at,
          'is_current', v_session_hash is not null and d.session_hash=v_session_hash
        ) order by d.last_seen_at desc)
        from taichinh_gd.device_sessions d
        where d.household_id=h
      ),'[]'::jsonb)
    );

  elsif p_action='register_device' then
    if v_session_token is null or length(v_session_token) < 8 then
      raise exception 'invalid_session_token';
    end if;
    v_device_label := coalesce(nullif(btrim(p_payload->>'device_label'),''), 'Thiết bị');
    insert into taichinh_gd.device_sessions(household_id, session_hash, device_label)
    values (h, v_session_hash, v_device_label)
    on conflict (household_id, session_hash) do update
      set device_label=excluded.device_label, last_seen_at=now();
    return jsonb_build_object('ok', true);

  elsif p_action='revoke_device' then
    v_device_id := nullif(p_payload->>'device_id','')::uuid;
    if v_device_id is null then raise exception 'invalid_device_id'; end if;
    update taichinh_gd.device_sessions
      set revoked_at = coalesce(revoked_at, now())
      where id=v_device_id and household_id=h;
    if not found then raise exception 'device_not_found'; end if;
    return jsonb_build_object('ok', true);

  elsif p_action='save_reporting' then
    v_show := coalesce((p_payload->>'show_vnd_conversion')::boolean,false);
    v_rate := nullif(p_payload->>'jpy_vnd_rate','')::numeric;
    if v_rate is not null and v_rate <= 0 then raise exception 'invalid_exchange_rate'; end if;
    if v_show and v_rate is null then raise exception 'exchange_rate_required'; end if;

    insert into taichinh_gd.reporting_settings(household_id,show_vnd_conversion,jpy_vnd_rate)
    values(h,v_show,v_rate)
    on conflict (household_id) do update
      set show_vnd_conversion=excluded.show_vnd_conversion,
          jpy_vnd_rate=excluded.jpy_vnd_rate;
    return jsonb_build_object('ok',true);

  elsif p_action='save_loan_terms' then
    v_loan := nullif(p_payload->>'loan_id','')::uuid;
    if v_loan is null or not exists(select 1 from taichinh_gd.loans where id=v_loan and household_id=h) then
      raise exception 'loan_not_found';
    end if;
    v_kind := coalesce(nullif(p_payload->>'loan_kind',''),'personal');
    if v_kind not in ('personal','bank') then raise exception 'invalid_loan_kind'; end if;
    v_method := coalesce(nullif(p_payload->>'repayment_method',''),'manual');
    if v_method not in ('manual','equal_payment','equal_principal') then raise exception 'invalid_repayment_method'; end if;
    v_rate := coalesce(nullif(p_payload->>'annual_rate','')::numeric,0);
    if v_rate < 0 then raise exception 'invalid_annual_rate'; end if;
    v_term := nullif(p_payload->>'term_months','')::integer;
    if v_term is not null and v_term <= 0 then raise exception 'invalid_term_months'; end if;
    v_day := nullif(p_payload->>'payment_day','')::integer;
    if v_day is not null and (v_day < 1 or v_day > 31) then raise exception 'invalid_payment_day'; end if;

    insert into taichinh_gd.loan_terms(
      loan_id,household_id,loan_kind,institution_name,product_name,
      annual_rate,repayment_method,term_months,payment_day
    ) values (
      v_loan,h,v_kind,nullif(btrim(p_payload->>'institution_name'),''),
      nullif(btrim(p_payload->>'product_name'),''),v_rate,v_method,v_term,v_day
    )
    on conflict (loan_id) do update set
      loan_kind=excluded.loan_kind,
      institution_name=excluded.institution_name,
      product_name=excluded.product_name,
      annual_rate=excluded.annual_rate,
      repayment_method=excluded.repayment_method,
      term_months=excluded.term_months,
      payment_day=excluded.payment_day,
      household_id=excluded.household_id;
    return jsonb_build_object('ok',true);

  elsif p_action='bank_payment' then
    v_loan := nullif(p_payload->>'loan_id','')::uuid;
    v_account := nullif(p_payload->>'account_id','')::uuid;
    v_principal := coalesce(nullif(p_payload->>'principal_amount','')::numeric,0);
    v_interest := coalesce(nullif(p_payload->>'interest_amount','')::numeric,0);
    v_date := coalesce(nullif(p_payload->>'transaction_date','')::date,current_date);

    if v_principal < 0 or v_interest < 0 or (v_principal + v_interest) <= 0 then
      raise exception 'invalid_payment_amount';
    end if;

    select loan_type,currency,remaining_amount into v_loan_type,v_currency,v_remaining
    from taichinh_gd.loans where id=v_loan and household_id=h;
    if v_loan_type is null then raise exception 'loan_not_found'; end if;
    if v_loan_type <> 'borrowed' then raise exception 'bank_loan_must_be_borrowed'; end if;
    if not exists(select 1 from taichinh_gd.loan_terms where loan_id=v_loan and household_id=h and loan_kind='bank') then
      raise exception 'bank_loan_terms_required';
    end if;
    if v_principal > v_remaining then raise exception 'payment_exceeds_remaining'; end if;

    if v_account is null or not exists(
      select 1 from taichinh_gd.accounts
      where id=v_account and household_id=h and is_active=true and currency=v_currency
    ) then raise exception 'invalid_account'; end if;

    if v_principal > 0 then
      insert into taichinh_gd.transactions(
        household_id,account_id,category_id,transfer_account_id,loan_id,goal_id,
        transaction_type,amount,currency,fx_rate,transaction_date,note,created_by
      ) values (
        h,v_account,null,null,v_loan,null,'loan_pay',v_principal,v_currency,1,v_date,
        nullif(btrim(p_payload->>'note'),''),null
      ) returning id into v_id;
    end if;

    if v_interest > 0 then
      insert into taichinh_gd.transactions(
        household_id,account_id,category_id,transfer_account_id,loan_id,goal_id,
        transaction_type,amount,currency,fx_rate,transaction_date,note,created_by
      ) values (
        h,v_account,null,null,v_loan,null,'loan_interest',v_interest,v_currency,1,v_date,
        coalesce(nullif(btrim(p_payload->>'note'),''),'Lãi / phí vay ngân hàng'),null
      ) returning id into v_interest_id;
    end if;

    return jsonb_build_object('ok',true,'principal_transaction_id',v_id,'interest_transaction_id',v_interest_id);

  else
    raise exception 'unknown_action';
  end if;
end;
$function$;
