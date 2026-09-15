-- NISA accounts can now hold individual quỹ/ETF positions ("sản phẩm"),
-- matching how a real brokerage NISA screen looks (Rakuten Shoken, SBI,
-- v.v.): an account-level total plus a per-fund buy-price → current-price →
-- %/lãi-lỗ breakdown — the "chế độ chi tiết" mode from the original spec
-- that was disclosed as not-yet-built.
--
-- Implementation: a nullable self-reference `parent_investment_id` on
-- `investments`. A child row is just an ordinary kind='securities'
-- investment (100% reuse of the existing buy/sell/avg-cost/realized-pl
-- replay engine) that happens to belong to a NISA parent instead of
-- standing alone. No new tables, no new event types.
--
-- Mode selection is automatic and per-account: a NISA with zero children
-- keeps behaving exactly as before ("chế độ đơn giản" — vốn ròng/giá trị
-- hiện tại from its own contribution/withdrawal/valuation events). The
-- moment it has ≥1 child fund, the client (finance.js) switches to rolling
-- the account's value/vốn ròng/lãi-lỗ up from its children ("chế độ chi
-- tiết") — the account's own manual contribution/withdrawal/valuation
-- actions are hidden in that mode to avoid double-counting. The existing
-- monthly contribution-plan confirm/skip flow is unaffected either way —
-- it only touches event history, not this value calculation.
--
-- Nothing existing is dropped or renamed; both tables already have rows
-- (from the previous migration) so this is a pure additive ALTER.

alter table taichinh_gd.investments
  add column parent_investment_id uuid references taichinh_gd.investments(id) on delete cascade;
create index idx_investments_parent on taichinh_gd.investments(parent_investment_id) where parent_investment_id is not null;

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
  v_parent uuid;
  v_parent_kind text;
  v_parent_parent uuid;
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
             inv.expected_return_rate, inv.expected_return_period, inv.reinvest_mode, inv.parent_investment_id,
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

    v_parent := nullif(p_payload->>'parent_investment_id','')::uuid;
    if v_parent is not null then
      if v_kind <> 'securities' then raise exception 'only_securities_can_have_a_parent'; end if;
      select kind, parent_investment_id into v_parent_kind, v_parent_parent from taichinh_gd.investments where id=v_parent and household_id=h;
      if v_parent_kind is null then raise exception 'invalid_parent_investment'; end if;
      if v_parent_kind <> 'nisa' then raise exception 'parent_must_be_nisa'; end if;
      if v_parent_parent is not null then raise exception 'nested_holdings_not_allowed'; end if;
    end if;

    if v_id is null then
      insert into taichinh_gd.investments(
        household_id, name, asset_type, currency, initial_capital, note, kind, broker_name, nisa_frame, nisa_annual_limit,
        ticker, market, bank_name, interest_rate_annual, interest_payment_method, term_end_date, start_date,
        monthly_amount, monthly_day, plan_start_month, plan_end_month, plan_paused,
        expected_return_rate, expected_return_period, reinvest_mode, parent_investment_id
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
        coalesce(nullif(p_payload->>'reinvest_mode',''), 'none'), v_parent
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
        reinvest_mode=coalesce(nullif(p_payload->>'reinvest_mode',''), reinvest_mode), parent_investment_id=v_parent, updated_at=now()
      where id=v_id and household_id=h;
      if not found then raise exception 'investment_not_found'; end if;
    end if;
    return jsonb_build_object('ok',true,'id',v_id);

  elsif p_action = 'delete' then
    v_id := nullif(p_payload->>'id','')::uuid;
    -- Soft-deleting a NISA account also soft-deletes any quỹ/ETF held under
    -- it, so it doesn't linger orphaned-but-visible in the Đầu tư list.
    update taichinh_gd.investments set is_active=false where parent_investment_id=v_id and household_id=h;
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
