# WPVH Sales Control — Product & Technical Specification

## 1. Objective
Build an internal Telegram alerting service for Verona Home and WallPanels that detects client conversations waiting for a human sales response and escalates them before/at the 2-hour SLA.

The first production release is read-only toward HighLevel. It must never modify contacts, opportunities, conversations, tasks, pipelines, messages, or workflow state.

## 2. Users
- Sales: Kate Lukovych, Kit Pavano, Anthony Kosariev, Mary Razumna
- Manager: Katherina (`@katherina_ostroglo`)
- Admin/tester: Dmitry (`@dimaqim`)

## 3. SLA behavior
Production:
- T+60m: responsible sales rep
- T+90m: responsible sales rep + manager
- T+120m: responsible sales rep + manager; label as SLA BREACH

Testing:
- T+2m / T+4m / T+5m
- all alerts delivered only to Dmitry while calculated production owner is shown for verification

A new inbound customer message opens/reopens the SLA. A later manual human outbound response resolves it. Automated outbound activity must not resolve it.

## 4. Channels
Monitor supported customer communication messages from HighLevel, including:
- SMS
- Email
- WhatsApp
- Instagram
- Facebook Messenger
- Webchat
- GMB when present

Calls/activity records are not treated as text-response SLA messages in v1.

## 5. Responsible sales routing
Final priority:
1. Owner of the most relevant open Opportunity (`assignedTo`)
2. Conversation `assignedTo`
3. Contact assigned user/owner if available
4. Manager/admin fallback

If multiple open opportunities exist, deterministic selection is required. Prefer a configured pipeline if one is later configured; otherwise use the most recently changed active opportunity.

Assignment conflicts must be logged for CRM cleanup.

## 6. HighLevel integration
Use read-only Private Integration Tokens per location.

Required read scopes for full v1 behavior:
- `conversations.readonly`
- `conversations/message.readonly`
- `contacts.readonly`
- `opportunities.readonly`
- `locations.readonly`
- `users.readonly`

No HighLevel Workflow is required in v1. Railway polls the message export endpoint at a bounded cadence. This keeps HighLevel configuration untouched and works with read-only credentials.

Polling design:
- default interval: 60 seconds
- bounded overlap window to tolerate restarts/network failures
- message de-duplication by `(company_id, message_id)`
- non-email export + separate Email export
- first boot lookback: configurable, default 24h
- pagination supported
- 429/5xx retry/backoff should be added/verified by Codex before production

## 7. Human-response classification
Conservative rule:
- message direction is outbound
- `userId` matches a known active HighLevel user synced from the location
- source is not `workflow`, `campaign`, `bulk_actions`, or `api`

The implementation must inspect real payloads during testing. If manual messages are represented differently in the live account, update the classifier without weakening it to “any outbound message.”

## 8. Telegram
The bot operates via long polling in v1; one Railway replica only.

Approved users register with `/start`. Bot stores Telegram numeric `user_id` and `chat_id` in Supabase. Delivery uses numeric chat ID, not username.

Commands:
- `/start`
- `/status`
- `/test_alert`

Alert must contain company, contact, owner, channel, wait time, trimmed last inbound message, and an `Open Conversation` button when a verified HighLevel URL template exists.

## 9. Supabase
Corporate Supabase only.

Tables:
- `companies`
- `staff`
- `ghl_users`
- `staff_ghl_map`
- `message_events`
- `telegram_users`
- `sla_incidents`
- `alerts`
- `assignment_mismatches`
- `routing_issues`
- `system_logs`

RLS enabled; no public policies for v1. Backend accesses via server-side secret key.

## 10. Deployment
Source of truth: private corporate GitHub repo `wpvh-sales-control`.
Hosting: Railway, one Node.js service, one replica.
Database: corporate Supabase.

Flow:
local Codex work → local validation → git commit → corporate GitHub `main` → Railway auto-deploy.

Secrets are stored only in:
- local `.env.local` (git-ignored)
- Railway Variables

Never in source, GitHub commits, README, screenshots, or logs.

## 11. Reliability acceptance criteria
- restart does not duplicate alerts already recorded
- same threshold alert cannot be sent twice to same recipient for same inbound message
- new client inbound after resolution can reopen monitoring
- manual human response stops future thresholds
- unmapped owner escalates safely instead of dropping alert
- one company can operate while the other company's token is absent
- health endpoint reports service state without secrets
- transient GHL/Telegram failures do not crash the process permanently

## 12. Production cutover gate
Do not turn `TEST_MODE=false` until:
1. Dmitry registration works
2. immediate Telegram test works
3. Verona live inbound 2/4/5 SLA test works
4. manual HighLevel reply correctly stops later alerts
5. owner mapping is verified for all four sales users
6. WallPanels equivalent test passes after its token is available
7. no secrets are present in Git history
