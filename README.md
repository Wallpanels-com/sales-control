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

Each person must send `/start` once before the bot can notify them.

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
- `/status` — service status
- `/test_alert` — delivery smoke test for admin/manager

See `docs/ARCHITECTURE.md`, `docs/TEST_PLAN.md`, and `CODEX_PROMPT.md`.
