-- Separate from unanswered-message SLA. No historical backfill or old-table changes.
create table public.followup_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  conversation_id text not null,
  contact_id text not null,
  cycle_inbound_message_id text not null,
  anchor_message_id text not null,
  anchor_at timestamptz not null,
  channel text not null,
  stage integer not null check (stage between 1 and 3),
  status text not null check (status in ('waiting', 'reminded', 'replied', 'suppressed', 'completed')),
  due_at timestamptz not null,
  reminded_at timestamptz,
  last_event_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, conversation_id)
);
create index idx_followup_threads_due on public.followup_threads(due_at) where status='waiting';

create table public.followup_notifications (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  thread_id uuid references public.followup_threads(id),
  company_id uuid not null references public.companies(id),
  conversation_id text not null,
  cycle_inbound_message_id text not null,
  anchor_message_id text not null,
  stage integer not null check (stage between 1 and 3),
  recipient_staff_id uuid not null references public.staff(id),
  preview boolean not null,
  draft text not null check (char_length(draft) between 1 and 256),
  ai_model text not null,
  ai_reason text not null,
  delivery_status text not null check (delivery_status in ('sending','sent','uncertain')),
  telegram_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_followup_notifications_thread on public.followup_notifications(thread_id);
create index idx_followup_notifications_recipient on public.followup_notifications(recipient_staff_id);
create index idx_followup_threads_company on public.followup_threads(company_id);
create index idx_followup_notifications_company on public.followup_notifications(company_id);
alter table public.followup_threads enable row level security;
alter table public.followup_notifications enable row level security;
revoke all on public.followup_threads, public.followup_notifications from public, anon, authenticated;
grant select,insert,update,delete on public.followup_threads, public.followup_notifications to service_role;
