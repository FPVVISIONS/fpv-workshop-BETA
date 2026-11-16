-- NEXA ONE: run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
--
-- Lets a signed-in user delete THEIR OWN account from the app. The app only holds the public
-- "anon" key, which can't delete users, so deletion goes through this function. It runs with
-- elevated rights but can only ever remove the row of the user who is calling it (auth.uid()).

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
