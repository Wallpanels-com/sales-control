alter table public.message_events
  add column if not exists ai_needs_reply boolean,
  add column if not exists ai_confidence numeric(4,3) check (ai_confidence between 0 and 1),
  add column if not exists ai_reason text,
  add column if not exists ai_model text,
  add column if not exists ai_classified_at timestamptz;

comment on column public.message_events.ai_needs_reply is 'AI result for whether the inbound message needs a human reply';
comment on column public.message_events.ai_confidence is 'AI confidence from 0 to 1';
comment on column public.message_events.ai_reason is 'Short diagnostic reason or safe fallback code';
comment on column public.message_events.ai_model is 'AI model used; never contains credentials';
comment on column public.message_events.ai_classified_at is 'Timestamp of AI classification';

-- Existing events were already processed by the pre-AI production logic.
-- Mark them as a safe baseline so deployment cannot reopen or rewrite history.
update public.message_events
set ai_needs_reply = true,
    ai_confidence = 0,
    ai_reason = 'pre-ai-baseline',
    ai_model = 'pre-ai-baseline',
    ai_classified_at = now()
where direction = 'inbound'
  and ai_classified_at is null;
