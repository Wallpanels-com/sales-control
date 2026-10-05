create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('verona', 'wallpanels')),
  display_name text not null,
  location_id text not null unique,
  timezone text not null default 'America/New_York',
  conversation_url_template text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  telegram_username text not null unique,
  role text not null check (role in ('sales', 'manager', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_users (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null unique references public.staff(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  telegram_username text,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghl_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ghl_user_id text not null,
  name text not null,
  email text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique(company_id, ghl_user_id)
);

create table if not exists public.staff_ghl_map (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  ghl_user_id text not null,
  mapping_source text not null default 'manual' check (mapping_source in ('manual', 'auto_exact_name')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id, company_id),
  unique(company_id, ghl_user_id)
);

create table if not exists public.message_events (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id text not null,
  conversation_id text not null,
  contact_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  message_type text,
  channel text not null,
  body text,
  source text,
  ghl_user_id text,
  is_human_outbound boolean not null default false,
  date_added timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id, message_id)
);

create index if not exists idx_message_events_conversation_date
  on public.message_events(company_id, conversation_id, date_added desc);

create table if not exists public.sla_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id text not null,
  contact_id text not null,
  latest_inbound_at timestamptz not null,
  latest_inbound_message_id text not null,
  latest_inbound_body text,
  channel text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  last_human_outbound_at timestamptz,
  resolved_at timestamptz,
  resolved_by_message_id text,
  responsible_ghl_user_id text,
  responsible_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_sla_incidents_one_open_per_conversation
  on public.sla_incidents(company_id, conversation_id) where status = 'open';
create unique index if not exists idx_sla_incidents_inbound_message
  on public.sla_incidents(company_id, latest_inbound_message_id);
create index if not exists idx_sla_incidents_open_age
  on public.sla_incidents(company_id, latest_inbound_at) where status = 'open';

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.sla_incidents(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id text not null,
  contact_id text not null,
  inbound_message_id text not null,
  threshold_minutes integer not null check (threshold_minutes > 0),
  recipient_staff_id uuid not null references public.staff(id) on delete cascade,
  delivery_status text not null default 'sending' check (delivery_status in ('sending', 'sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_attempt_at timestamptz not null default now(),
  telegram_message_id text,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(incident_id, inbound_message_id, threshold_minutes, recipient_staff_id)
);

create table if not exists public.assignment_mismatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  incident_id uuid references public.sla_incidents(id) on delete set null,
  conversation_id text not null,
  contact_id text not null,
  opportunity_owner_id text,
  conversation_owner_id text,
  contact_owner_id text,
  selected_owner_id text,
  selected_source text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists idx_assignment_mismatches_open
  on public.assignment_mismatches(company_id, conversation_id)
  where resolved_at is null;

create table if not exists public.routing_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  incident_id uuid references public.sla_incidents(id) on delete set null,
  conversation_id text not null,
  contact_id text not null,
  issue_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists idx_routing_issues_open_unique
  on public.routing_issues(company_id, conversation_id, issue_type)
  where resolved_at is null;

create table if not exists public.system_logs (
  id bigserial primary key,
  level text not null check (level in ('info', 'warn', 'error')),
  event_type text not null,
  company_id uuid references public.companies(id) on delete set null,
  conversation_id text,
  contact_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_logs_event_created
  on public.system_logs(event_type, created_at desc);

alter table public.companies enable row level security;
alter table public.staff enable row level security;
alter table public.telegram_users enable row level security;
alter table public.ghl_users enable row level security;
alter table public.staff_ghl_map enable row level security;
alter table public.message_events enable row level security;
alter table public.sla_incidents enable row level security;
alter table public.alerts enable row level security;
alter table public.assignment_mismatches enable row level security;
alter table public.routing_issues enable row level security;
alter table public.system_logs enable row level security;

-- The service is server-side only. Public API roles receive no table access.
revoke all on public.companies, public.staff, public.telegram_users, public.ghl_users,
  public.staff_ghl_map, public.message_events, public.sla_incidents, public.alerts,
  public.assignment_mismatches, public.routing_issues, public.system_logs
  from anon, authenticated;
revoke all on sequence public.message_events_id_seq, public.system_logs_id_seq
  from anon, authenticated;

grant select, insert, update, delete on public.companies, public.staff,
  public.telegram_users, public.ghl_users, public.staff_ghl_map,
  public.message_events, public.sla_incidents, public.alerts,
  public.assignment_mismatches, public.routing_issues, public.system_logs
  to service_role;
grant usage, select on sequence public.message_events_id_seq, public.system_logs_id_seq
  to service_role;
