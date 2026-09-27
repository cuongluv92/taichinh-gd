-- Fix: auto-seed-from-template checked "does this MONTH have zero items
-- across ALL 4 columns", so once column 1 got seeded (even just once,
-- even back when the template was label-only) it permanently blocked
-- columns 2-4 from ever being seeded for that month, even after the user
-- fixed the template and typed into 2-4 in a later month. Reported by user:
-- saved a full 4-column mẫu, columns 2/3/4 never showed up in the next
-- never-opened month at all — only column 1 (already seeded weeks ago)
-- was there.
--
-- Fix: check emptiness PER COLUMN instead of per month — each column of
-- the template seeds itself into a given month independently, only when
-- THAT column has no items yet for that month. A column that already has
-- real data (typed by the user, or seeded earlier) is left alone; a
-- column that's still untouched gets its mẫu rows inserted, regardless of
-- what the other 3 columns already have.

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

    -- Per-column seeding: a column with zero items for this month gets its
    -- mẫu rows inserted, independent of whether other columns already have
    -- data (fixes the "only column 1 ever seeds" bug above).
    insert into taichinh_gd.scratch_items(household_id, column_no, month, label, amount, sign, sort_order)
    select h, t.column_no, v_month, t.label, t.amount, t.sign, t.sort_order
    from taichinh_gd.scratch_templates t
    where t.household_id = h
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
