create or replace function taichinh_gd.sync_existing_installment_liability()
returns trigger
language plpgsql
set search_path = pg_catalog, public, taichinh_gd
as $$
declare
  old_card uuid;
  old_entry text;
  new_card uuid;
  new_entry text;
begin
  if tg_op in ('DELETE','UPDATE') then
    select i.card_account_id, i.entry_mode
      into old_card, old_entry
    from taichinh_gd.credit_card_installments i
    where i.id = old.installment_id;

    if old_entry = 'existing' and old_card is not null then
      update taichinh_gd.accounts
      set opening_balance = coalesce(opening_balance,0) + coalesce(old.principal_amount,0)
      where id = old_card;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    select i.card_account_id, i.entry_mode
      into new_card, new_entry
    from taichinh_gd.credit_card_installments i
    where i.id = new.installment_id;

    if new_entry = 'existing' and new_card is not null then
      update taichinh_gd.accounts
      set opening_balance = coalesce(opening_balance,0) - coalesce(new.principal_amount,0)
      where id = new_card;
    end if;
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_existing_installment_liability on taichinh_gd.credit_card_installment_schedule;
create trigger trg_existing_installment_liability
after insert or delete or update of installment_id, principal_amount
on taichinh_gd.credit_card_installment_schedule
for each row execute function taichinh_gd.sync_existing_installment_liability();
