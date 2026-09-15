-- Bug fix: every card purchase (openCardExpense / a credit-account row edited
-- in openTransactionEdit) has been failing to save since the card_categories
-- migration shipped. Root cause: the pre-existing
-- taichinh_gd.validate_transaction_integrity() trigger still unconditionally
-- requires category_id on every expense/income row — it was never taught
-- about the new card_category_id path, so save_transaction's own validation
-- passes (category_id=null is intentional for a card row) but the trigger
-- then rejects the insert/update with transaction_category_required.
--
-- Fix: an expense on a credit account uses card_category_id (or neither, for
-- a lump-sum entry) instead of category_id — so skip the category_id
-- requirement in exactly that case, and forbid category_id from being set on
-- a card-expense row (mirrors the existing "unexpected_category" symmetry).
-- Every other transaction type/account combination keeps its existing rules
-- unchanged.
create or replace function taichinh_gd.validate_transaction_integrity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, taichinh_gd
as $$
declare
  v_account_currency text;
  v_account_type text;
  v_transfer_currency text;
  v_category_direction text;
begin
  if new.account_id is null then
    raise exception 'transaction_account_required';
  end if;

  select currency, account_type into v_account_currency, v_account_type
  from taichinh_gd.accounts
  where id = new.account_id and household_id = new.household_id and is_active = true;
  if v_account_currency is null then raise exception 'invalid_account'; end if;
  if v_account_currency <> new.currency then raise exception 'account_currency_mismatch'; end if;

  if new.transaction_type in ('transfer','goal_save','goal_withdraw') then
    if new.transfer_account_id is null then raise exception 'transfer_account_required'; end if;
    if new.transfer_account_id = new.account_id then raise exception 'accounts_must_differ'; end if;
    select currency into v_transfer_currency
    from taichinh_gd.accounts
    where id = new.transfer_account_id and household_id = new.household_id and is_active = true;
    if v_transfer_currency is null then raise exception 'invalid_transfer_account'; end if;
    if v_transfer_currency <> new.currency then raise exception 'transfer_currency_mismatch'; end if;
  elsif new.transfer_account_id is not null then
    raise exception 'unexpected_transfer_account';
  end if;

  if new.transaction_type = 'expense' and v_account_type = 'credit' then
    if new.category_id is not null then raise exception 'unexpected_category'; end if;
  elsif new.transaction_type in ('income','expense') then
    if new.category_id is null then raise exception 'transaction_category_required'; end if;
    select direction into v_category_direction
    from taichinh_gd.categories
    where id = new.category_id and household_id = new.household_id and is_active = true;
    if v_category_direction is null then raise exception 'invalid_category'; end if;
    if v_category_direction <> new.transaction_type then raise exception 'category_direction_mismatch'; end if;
  elsif new.category_id is not null then
    raise exception 'unexpected_category';
  end if;

  if new.card_category_id is not null and not (new.transaction_type = 'expense' and v_account_type = 'credit') then
    raise exception 'unexpected_card_category';
  end if;

  return new;
end;
$$;
