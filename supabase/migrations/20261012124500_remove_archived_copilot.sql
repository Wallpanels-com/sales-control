-- The separate wpvh-sales-copilot application is archived. Its production
-- sync was disabled before this cleanup. These objects are isolated from the
-- SLA bot tables (companies, staff, Telegram, messages, incidents and alerts).
drop view if exists public.copilot_product_lead_rows;
drop view if exists public.copilot_live_lead_rows;

drop table if exists public.copilot_action_audit_log cascade;
drop table if exists public.copilot_ai_call_state cascade;
drop table if exists public.copilot_ai_lead_state cascade;
drop table if exists public.copilot_ai_lessons cascade;
drop table if exists public.copilot_ai_usage_log cascade;
drop table if exists public.copilot_crm_calls_cache cascade;
drop table if exists public.copilot_crm_contacts_cache cascade;
drop table if exists public.copilot_crm_conversations_cache cascade;
drop table if exists public.copilot_crm_messages_cache cascade;
drop table if exists public.copilot_crm_opportunities_cache cascade;
drop table if exists public.copilot_crm_pipelines_cache cascade;
drop table if exists public.copilot_crm_tasks_cache cascade;
drop table if exists public.copilot_locations cascade;
drop table if exists public.copilot_profiles cascade;
drop table if exists public.copilot_sync_state cascade;
drop table if exists public.copilot_user_ghl_mappings cascade;
drop table if exists public.copilot_user_preferences cascade;
