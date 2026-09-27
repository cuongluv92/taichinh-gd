-- Bảng nháp refinements per user follow-up:
-- 1. "Lưu" (save_template) must now save the AMOUNT too, not just the
--    label — many of these ad-hoc transfer items repeat the same amount
--    every month, so a never-opened month should auto-fill both.
-- 2. Add a per-row +/− sign so a column can net additions against
--    subtractions (not just sum everything). The FIRST row in each column
--    is the baseline and has no sign toggle — it's always treated as +.
--    Every other row gets a +/− toggle; the column total = Σ sign×amount.
--    The sign is itself an ordinary saved field (persisted on save_item,
--    carried into the template same as label/amount).

alter table taichinh_gd.scratch_items
  add column if not exists sign smallint not null default 1;
alter table taichinh_gd.scratch_items
  drop constraint if exists scratch_items_sign_check,
  add constraint scratch_items_sign_check check (sign in (1,-1));

alter table taichinh_gd.scratch_templates
  add column if not exists amount numeric not null default 0,
  add column if not exists sign smallint not null default 1;
alter table taichinh_gd.scratch_templates
  drop constraint if exists scratch_templates_sign_check,
  add constraint scratch_templates_sign_check check (sign in (1,-1));

create or replace function public.taichinh_gd_scratch_api(p_key text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public', 'taichinh_gd', 'taichinh_gd_private', 'extensions'
 set "TimeZone" to 'Asia/Tokyo'
as $function$
declare
  h uuid;
  v_id uuid;
  v_col int;
  v_month date;
  v_amount numeric;
  v_sign smallint;
  v_count int;
begin
  if p_key is null or length(p_key) < 9 then raise exception 'invalid_access_key' using errcode='42501'; end if;
  select household_id into h from taichinh_gd_private.app_config
  where id=1 and access_hash=encode(extensions.digest(p_key,'sha256'),'hex');
  if h is null then raise exception 'invalid_access_key' using errcode='42501'; end if;

  p_action := lower(coalesce(p_action,''));

  if p_action = 'list' then
    v_month := date_trunc('month', coalesce(nullif(p_payload->>'month','')::date, current_date))::date;

    insert into taichinh_gd.scratch_columns(household_id, column_no, name)
    select h, gs, '' from generate_series(1,4) gs
    on conflict (household_id, column_no) do nothing;

    -- A genuinely untouched month (zero items in any column) gets seeded
    -- once from the saved template, label + amount + sign all copied —
    -- checked fresh on every 'list' call, so it seeds once and deleting
    -- rows down to zero re-seeds on the next load (accepted trade-off,
    -- this is a private calculator, not a ledger).
    select count(*) into v_count from taichinh_gd.scratch_items where household_id=h and month=v_month;
    if v_count = 0 then
      insert into taichinh_gd.scratch_items(household_id, column_no, month, label, amount, sign, sort_order)
      select h, t.column_no, v_month, t.label, t.amount, t.sign, t.sort_order
      from taichinh_gd.scratch_templates t where t.household_id = h;
    end if;

    return jsonb_build_object(
      'columns', coalesce((select jsonb_agg(to_jsonb(x) order by x.column_no) from (
        select column_no, name from taichinh_gd.scratch_columns where household_id=h
      ) x), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.column_no, x.sort_order, x.created_at) from (
        select id, column_no, label, amount, sign, sort_order, created_at from taichinh_gd.scratch_items
        where household_id=h and month=v_month
      ) x), '[]'::jsonb)
    );

  elsif p_action = 'save_column_name' then
    v_col := nullif(p_payload->>'column_no','')::int;
    if v_col is null or v_col < 1 or v_col > 4 then raise exception 'invalid_column'; end if;
    insert into taichinh_gd.scratch_columns(household_id, column_no, name)
    values (h, v_col, coalesce(btrim(p_payload->>'name'),''))
    on conflict (household_id, column_no) do update set name = excluded.name;
    return jsonb_build_object('ok', true);

  elsif p_action = 'save_item' then
    v_id := nullif(p_payload->>'id','')::uuid;
    v_col := nullif(p_payload->>'column_no','')::int;
    if v_col is null or v_col < 1 or v_col > 4 then raise exception 'invalid_column'; end if;
    v_amount := coalesce(nullif(p_payload->>'amount','')::numeric, 0);
    v_sign := case when nullif(p_payload->>'sign','')::int = -1 then -1 else 1 end;

    if v_id is null then
      v_month := date_trunc('month', coalesce(nullif(p_payload->>'month','')::date, current_date))::date;
      insert into taichinh_gd.scratch_items(household_id, column_no, month, label, amount, sign, sort_order)
      values (h, v_col, v_month, coalesce(btrim(p_payload->>'label'),''), v_amount, v_sign,
        coalesce((select max(sort_order)+1 from taichinh_gd.scratch_items where household_id=h and column_no=v_col and month=v_month),0))
      returning id into v_id;
    else
      update taichinh_gd.scratch_items
      set label = coalesce(btrim(p_payload->>'label'),''), amount = v_amount, sign = v_sign
      where id=v_id and household_id=h;
      if not found then raise exception 'item_not_found'; end if;
    end if;
    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'delete_item' then
    v_id := nullif(p_payload->>'id','')::uuid;
    delete from taichinh_gd.scratch_items where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  elsif p_action = 'save_template' then
    v_month := date_trunc('month', coalesce(nullif(p_payload->>'month','')::date, current_date))::date;
    delete from taichinh_gd.scratch_templates where household_id = h;
    insert into taichinh_gd.scratch_templates(household_id, column_no, label, amount, sign, sort_order)
    select h, column_no, label, amount, sign, sort_order
    from taichinh_gd.scratch_items
    where household_id = h and month = v_month and btrim(label) <> '';
    return jsonb_build_object('ok', true);

  else
    raise exception 'unknown_action';
  end if;
end;
$function$;
