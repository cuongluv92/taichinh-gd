-- User clarified the exact scope wanted: "Lưu" on month N unlocks ONLY
-- month N+1 — further months (N+2, N+3, ...) stay blank until THAT month
-- gets its own "Lưu". Previously any never-touched month/column, however
-- far ahead, seeded from whichever mẫu was last saved (that's how tháng
-- 9 and tháng 12 both ended up with October's mẫu just from being opened).
--
-- Fix: scratch_templates now records source_month — the month it was
-- captured FROM. 'list' only auto-seeds a column when the requested month
-- is exactly source_month + 1 month; any other never-touched month is
-- left genuinely blank.

alter table taichinh_gd.scratch_templates
  add column if not exists source_month date;

-- Backfill: the only template ever saved so far was captured from October
-- 2026 (the household's real, manually re-entered data).
update taichinh_gd.scratch_templates
set source_month = '2026-10-01'
where source_month is null;

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

    -- Per-column seeding, but only into the ONE month right after the mẫu's
    -- source month — a further month (N+2 or later) stays blank until it
    -- gets its own save_template call.
    insert into taichinh_gd.scratch_items(household_id, column_no, month, label, amount, sign, sort_order)
    select h, t.column_no, v_month, t.label, t.amount, t.sign, t.sort_order
    from taichinh_gd.scratch_templates t
    where t.household_id = h
      and t.source_month is not null
      and v_month = (t.source_month + interval '1 month')::date
      and not exists (
        select 1 from taichinh_gd.scratch_items si
        where si.household_id = h and si.month = v_month and si.column_no = t.column_no
      );

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
    insert into taichinh_gd.scratch_templates(household_id, column_no, label, amount, sign, sort_order, source_month)
    select h, column_no, label, amount, sign, sort_order, v_month
    from taichinh_gd.scratch_items
    where household_id = h and month = v_month and btrim(label) <> '';
    return jsonb_build_object('ok', true);

  else
    raise exception 'unknown_action';
  end if;
end;
$function$;
