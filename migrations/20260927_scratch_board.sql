-- "Bảng nháp" — a free-form 4-column scratchpad on Chi tiêu for totaling up
-- ad-hoc amounts (user's words: "tính toán các khoản để chuyển khoản",
-- "hàng tháng có nhiều khoản lẻ tẻ tôi cần tính tổng lại"). Deliberately
-- outside the real budget: column names and every line item's label are
-- blank by default and fully free-text, nothing here is a category, and
-- none of it is ever read by F.statsFor/installmentMonthDue/any KPI — it's
-- a private calculator, not a ledger.
--
-- Column names are per-household and NOT month-scoped (renamed once, reused
-- every month — same spirit as the fixed "Thu nhập/Chi cố định/..." column
-- titles above it never changing month to month). Items ARE month-scoped
-- (fresh list each month, matching "hàng tháng có nhiều khoản lẻ tẻ").

create table if not exists taichinh_gd.scratch_columns (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  column_no smallint not null check (column_no between 1 and 4),
  name text not null default '',
  unique (household_id, column_no)
);
alter table taichinh_gd.scratch_columns enable row level security;

create table if not exists taichinh_gd.scratch_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references taichinh_gd.households(id) on delete cascade,
  column_no smallint not null check (column_no between 1 and 4),
  month date not null,
  label text not null default '',
  amount numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists scratch_items_household_month_idx on taichinh_gd.scratch_items(household_id, month);
alter table taichinh_gd.scratch_items enable row level security;

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

    return jsonb_build_object(
      'columns', coalesce((select jsonb_agg(to_jsonb(x) order by x.column_no) from (
        select column_no, name from taichinh_gd.scratch_columns where household_id=h
      ) x), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.column_no, x.sort_order, x.created_at) from (
        select id, column_no, label, amount, sort_order, created_at from taichinh_gd.scratch_items
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

    if v_id is null then
      v_month := date_trunc('month', coalesce(nullif(p_payload->>'month','')::date, current_date))::date;
      insert into taichinh_gd.scratch_items(household_id, column_no, month, label, amount, sort_order)
      values (h, v_col, v_month, coalesce(btrim(p_payload->>'label'),''), v_amount,
        coalesce((select max(sort_order)+1 from taichinh_gd.scratch_items where household_id=h and column_no=v_col and month=v_month),0))
      returning id into v_id;
    else
      update taichinh_gd.scratch_items
      set label = coalesce(btrim(p_payload->>'label'),''), amount = v_amount
      where id=v_id and household_id=h;
      if not found then raise exception 'item_not_found'; end if;
    end if;
    return jsonb_build_object('ok', true, 'id', v_id);

  elsif p_action = 'delete_item' then
    v_id := nullif(p_payload->>'id','')::uuid;
    delete from taichinh_gd.scratch_items where id=v_id and household_id=h;
    return jsonb_build_object('ok', found);

  else
    raise exception 'unknown_action';
  end if;
end;
$function$;
