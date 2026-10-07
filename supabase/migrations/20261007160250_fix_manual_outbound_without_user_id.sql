-- HighLevel omits userId on some manual app replies (observed live for
-- Instagram, Facebook and Email). Source remains the automation safeguard:
-- workflow/API/AI messages use other source values and are not changed here.
update public.message_events
set is_human_outbound = true
where direction = 'outbound'
  and lower(replace(replace(coalesce(source, ''), ' ', '_'), '-', '_')) = 'app'
  and ghl_user_id is null
  and is_human_outbound = false;

-- Reconcile incidents that remained open only because those genuine replies
-- were previously stored as non-human. Keep all alert history intact.
with first_reply as (
  select distinct on (incident.id)
    incident.id as incident_id,
    event.date_added as resolved_at,
    event.message_id as resolved_by_message_id
  from public.sla_incidents incident
  join public.message_events event
    on event.company_id = incident.company_id
   and event.conversation_id = incident.conversation_id
   and event.is_human_outbound = true
   and event.date_added >= incident.latest_inbound_at
  where incident.status = 'open'
  order by incident.id, event.date_added, event.message_id
)
update public.sla_incidents incident
set status = 'resolved',
    resolved_at = first_reply.resolved_at,
    resolved_by_message_id = first_reply.resolved_by_message_id,
    last_human_outbound_at = first_reply.resolved_at,
    updated_at = now()
from first_reply
where incident.id = first_reply.incident_id;
