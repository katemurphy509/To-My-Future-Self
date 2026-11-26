create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  requester_email text not null,
  recipient_email text not null,
  recipient_id uuid references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint friendships_valid_emails check (
    requester_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and lower(requester_email) <> lower(recipient_email)
  ),
  constraint friendships_status_fields check (
    (status = 'pending' and recipient_id is null and accepted_at is null)
    or (status = 'accepted' and recipient_id is not null and accepted_at is not null)
  )
);

create unique index friendships_unique_pair
  on public.friendships (
    least(lower(requester_email), lower(recipient_email)),
    greatest(lower(requester_email), lower(recipient_email))
  );

alter table public.friendships enable row level security;
revoke all on public.friendships from public, anon;
grant select, insert on public.friendships to authenticated;
grant update (recipient_id, status) on public.friendships to authenticated;
grant all on public.friendships to service_role;

create policy "Friend request participants can read requests"
  on public.friendships for select to authenticated
  using (
    requester_id = auth.uid()
    or recipient_id = auth.uid()
    or lower(recipient_email) = lower(auth.jwt() ->> 'email')
  );

create policy "Users can request a friend connection"
  on public.friendships for insert to authenticated
  with check (
    requester_id = auth.uid()
    and lower(requester_email) = lower(auth.jwt() ->> 'email')
    and status = 'pending'
    and recipient_id is null
    and accepted_at is null
  );

create policy "Invited users can accept their request"
  on public.friendships for update to authenticated
  using (
    status = 'pending'
    and lower(recipient_email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    status = 'accepted'
    and recipient_id = auth.uid()
    and lower(recipient_email) = lower(auth.jwt() ->> 'email')
  );

create function public.set_friendship_accepted_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'pending'
    or new.status <> 'accepted'
    or new.recipient_id is distinct from auth.uid()
    or lower(old.recipient_email) <> lower(auth.jwt() ->> 'email')
  then
    raise exception 'This friend request cannot be accepted by this account.';
  end if;

  new.accepted_at := now();
  return new;
end;
$$;

create trigger friendships_set_accepted_at
  before update on public.friendships
  for each row execute function public.set_friendship_accepted_at();

create table public.scheduled_letters (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sender_email text not null,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  recipient_email text not null,
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 20000),
  unlock_at timestamptz not null check (unlock_at > created_at),
  created_at timestamptz not null default now(),
  notification_claimed_at timestamptz,
  notification_sent_at timestamptz,
  check (sender_id <> recipient_id)
);

create function public.prepare_scheduled_letter()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  connection public.friendships%rowtype;
begin
  if auth.uid() is null or auth.jwt() ->> 'email' is null then
    raise exception 'Sign in with an email account to schedule a letter.';
  end if;

  select *
    into connection
    from public.friendships
   where id = new.friendship_id
     and status = 'accepted'
     and (requester_id = auth.uid() or recipient_id = auth.uid());

  if not found then
    raise exception 'Letters can only be sent to an accepted friend.';
  end if;

  new.sender_id := auth.uid();
  new.sender_email := auth.jwt() ->> 'email';
  if connection.requester_id = auth.uid() then
    new.recipient_id := connection.recipient_id;
    new.recipient_email := connection.recipient_email;
  else
    new.recipient_id := connection.requester_id;
    new.recipient_email := connection.requester_email;
  end if;

  if new.unlock_at <= now() then
    raise exception 'Choose a future delivery date.';
  end if;

  return new;
end;
$$;

create trigger scheduled_letters_prepare
  before insert on public.scheduled_letters
  for each row execute function public.prepare_scheduled_letter();

alter table public.scheduled_letters enable row level security;
revoke all on public.scheduled_letters from public, anon;
grant select (
  id,
  friendship_id,
  sender_id,
  sender_email,
  recipient_id,
  recipient_email,
  title,
  body,
  unlock_at,
  created_at
) on public.scheduled_letters to authenticated;
grant insert (friendship_id, title, body, unlock_at)
  on public.scheduled_letters to authenticated;
grant all on public.scheduled_letters to service_role;

create policy "Senders and unlocked recipients can read letters"
  on public.scheduled_letters for select to authenticated
  using (
    sender_id = auth.uid()
    or (recipient_id = auth.uid() and unlock_at <= now())
  );

create policy "Friends can schedule future letters"
  on public.scheduled_letters for insert to authenticated
  with check (
    sender_id = auth.uid()
    and unlock_at > now()
    and exists (
      select 1
        from public.friendships
       where id = friendship_id
         and status = 'accepted'
         and (requester_id = auth.uid() or recipient_id = auth.uid())
    )
  );

create function public.claim_due_scheduled_letters()
returns table (letter_id uuid, recipient_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only the notification service can claim scheduled letters.';
  end if;

  return query
  with due as (
    select letters.id
      from public.scheduled_letters as letters
     where letters.unlock_at <= now()
       and letters.notification_sent_at is null
       and (
         letters.notification_claimed_at is null
         or letters.notification_claimed_at < now() - interval '10 minutes'
       )
     order by letters.unlock_at
     limit 100
     for update skip locked
  ),
  claimed as (
    update public.scheduled_letters as letters
       set notification_claimed_at = now()
      from due
     where letters.id = due.id
     returning letters.id, letters.recipient_id
  )
  select claimed.id, claimed.recipient_id from claimed;
end;
$$;

revoke all on function public.claim_due_scheduled_letters() from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_letters() to service_role;
grant update (notification_claimed_at, notification_sent_at)
  on public.scheduled_letters to service_role;
