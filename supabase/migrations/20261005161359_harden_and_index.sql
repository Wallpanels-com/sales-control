create index if not exists idx_alerts_company_id
  on public.alerts(company_id);
create index if not exists idx_alerts_recipient_staff_id
  on public.alerts(recipient_staff_id);
create index if not exists idx_assignment_mismatches_incident_id
  on public.assignment_mismatches(incident_id);
create index if not exists idx_routing_issues_incident_id
  on public.routing_issues(incident_id);
create index if not exists idx_system_logs_company_id
  on public.system_logs(company_id);

-- This event-trigger function belongs to the project's RLS auto-enable helper.
-- It must remain callable by the event trigger, not through the public API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
