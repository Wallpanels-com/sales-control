# WPVH Sales Control

Telegram SLA control for **Verona Home + WallPanels**.

The service runs 24/7 on Railway, reads HighLevel using read-only Private Integration Tokens, stores state in Supabase, and alerts staff in Telegram when a client is waiting too long for a human response.

## Production SLA
- 60 minutes — responsible sales rep + Dmitry + Katherina
- 90 minutes — responsible sales rep + Dmitry + Katherina
- 120 minutes — SLA breach to responsible sales rep + Dmitry + Katherina

## Test mode
`TEST_MODE=true` routes all notifications only to `@dimaqim` and uses `2,4,5` minute thresholds by default.

## Responsible user
1. Open Opportunity owner
2. Conversation assigned user
3. Contact owner/assigned user
4. Manager/admin fallback

## HighLevel changes required
**None for the MVP.** This version deliberately uses polling through the read-only API, so no HighLevel Workflow has to be published. HighLevel remains read-only.

The backend polls `conversations/messages/export` with overlap + de-duplication. Email is fetched separately because HighLevel's export endpoint requires `channel=Email` for email messages.

Before opening or advancing an SLA incident, the backend asks Groq `openai/gpt-oss-20b` whether the latest inbound message needs a human reply. Only `needs_reply=false` with confidence of at least `0.90` can suppress a new incident. Errors, timeouts, rate limits, invalid responses, and lower confidence remain under SLA. A non-actionable follow-up never closes or resets an existing actionable incident.

Verona Home and WallPanels use separate HighLevel `locationId` values and separate company rows in Supabase. WallPanels may be disabled safely by leaving its token empty; production currently enables both companies.

## Staff
- Kate Lukovych — `@lukovychk` — sales
- Kit Pavano — `@Irakli_Kit` — sales
- Anthony Kosariev — `@tonykosarev` — sales
- Mary Razumna — `@mariarayme` — sales
- Dmitry — `@dimaqim` — admin
- Katherina — `@katherina_ostroglo` — manager
- Igor Kravchenko — `@FoxionCEO` — admin (global alerts)

Registered staff are identified by numeric Telegram user ID, and delivery uses chat ID. For a new employee, an admin/manager sends `/invite @username` in the bot's private chat and forwards the returned personal link to that employee. The link is signed, bound to the approved staff record/username and valid for 24 hours. Opening it and pressing Start binds the numeric Telegram account. A bare `/start` cannot claim an unregistered staff identity. Existing registrations continue to work with `/start`.

## Local start
Codex should perform these steps for the user. They are documented here for reproducibility:

```bash
npm install
npm run dev
```

Before starting, create `.env.local` from the supplied Token document and load it into the shell/runtime. Do not commit it.

AI variables: `GROQ_API_KEY`, `AI_MODEL`, `AI_CONFIDENCE_THRESHOLD`, and `AI_TIMEOUT_MS`.

## Database
Apply all files in `supabase/migrations` to the corporate Supabase project in order.

## Railway
Use one service replica. Connect the corporate GitHub repository to Railway and deploy from `main`. Add the same secrets as Railway Variables. Railway should auto-deploy on every push to `main`.

Current production health URL: `https://wpvh-sales-control-production.up.railway.app/health`.

## Health
`GET /health`

## Operations
See [RUNBOOK.md](RUNBOOK.md) for token rotation, staff registration, test-mode cutover, and missed-alert diagnosis.

## Telegram commands
- `/start` — approved staff registration
- `/invite @username` — personal registration link (admin/manager, private chat)
- `/status` — service status (admin/manager, private chat)
- `/test_alert` — delivery smoke test for admin/manager in private chat

## Security and synchronization
Supabase tables have RLS enabled with no public access policies; only the backend secret key accesses customer data. Secrets and the Token document are excluded from Git. AI receives limited message context through Groq and cannot execute tools or change staff permissions. Message text is treated as untrusted input; AI failures keep the conservative SLA result.

Alerts require a complete, successful, recent HighLevel sync for that company. They pause during ingestion, after failed polls, or when the snapshot is over three poll intervals old (minimum three minutes). A real human reply is rechecked in Supabase immediately before each delivery. HighLevel 429 responses pause that company for 15 minutes. Attachments without text remain under SLA but are not repeatedly submitted for AI classification.

## Lead follow-up reminders (approval-gated rollout)
Separate module for customer silence after a human sales reply: stage 1 after 24 hours; stage 2 after 48 hours from the actually sent first follow-up; stage 3 after 96 hours from the actually sent second follow-up. Reminder delivery or pressing Copy never advances the stage. Customer replies stop the chain, automation never advances it, and an unsolicited outbound without a preceding inbound cannot start it.

`FOLLOWUP_MODE=off` is the safe default. `preview` tracks new conversations but never automatically sends any follow-up notifications. The one-shot `npm run followup:demo` uses a fictional conversation, sends only to Dmitry, and verifies a real CRM link using metadata only. `npm run followup:preview` uses real conversation text with Groq and must only run after explicit data-sharing consent. Both commands require preview mode and never change production chain stages.

Follow-up messages contain an English AI draft (at most 256 characters), a native Telegram Copy button, and Open Conversation. Groq uses `FOLLOWUP_GROQ_API_KEY` (or the existing Groq key if unset). AI skips refusals/closings and defers agreed future contact dates. AI failure or low confidence postpones the check without inventing a message. HighLevel access remains read-only.

After explicit approval and verified Railway access, set a fresh `FOLLOWUP_CUTOVER_AT` and `FOLLOWUP_MODE=production`. Suppress pre-cutover preview threads first; do not backfill historical customer silence. Production recipients use the same responsibility priority and global manager/admin monitoring as the existing SLA. No other sales receive the conversation. Keep `TEST_MODE=false` for production; global TEST_MODE blocks follow-up production delivery.

Tables: `followup_threads` for chain state and `followup_notifications` for draft/delivery audit. Both have RLS and backend-only grants. See [follow-up operations](docs/FOLLOWUPS.md).

See `docs/ARCHITECTURE.md`, `docs/TEST_PLAN.md`, and `CODEX_PROMPT.md`.
