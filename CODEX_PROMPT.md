# Prompt for Codex

You are finishing and deploying a production-oriented internal project called `wpvh-sales-control` for WallPanels / Verona Home.

## Hard boundaries
1. Work only inside the project folder I explicitly open/select and with the corporate resources whose credentials/URLs are contained in my Desktop Word document named `Token` (likely `Token.docx`).
2. Do **not** inspect, connect to, modify, search, or use any personal GitHub account, personal Supabase projects, personal Railway projects, personal browser profiles, Keychain/password manager, unrelated files, or unrelated repositories.
3. Do not enumerate my home directory looking for credentials. Only read the exact Token document I point you to and this project folder.
4. Never print secret values into chat, terminal logs, README, source code, commits, or GitHub. Never commit the Token document.
5. HighLevel must remain **read-only**. Do not call any HighLevel POST/PUT/PATCH/DELETE endpoint. Use only the supplied read-only Private Integration Tokens.
6. Before every `git push`, run a secret scan/check (`git diff --cached`, grep for known env variable values if safe locally, and verify `.env*`/Token files are ignored).
7. If browser authorization is required for corporate GitHub, Supabase CLI, or Railway, stop at that point and ask me only to approve the authorization. Do everything else yourself.

## Inputs
My Desktop `Token` Word document contains some or all of:
- SUPABASE_URL
- SUPABASE_SECRET_KEY
- TELEGRAM_BOT_TOKEN
- TELEGRAM_BOT_USERNAME
- VERONA_LOCATION_ID
- VERONA_API_TOKEN (read-only)
- WALLPANELS_LOCATION_ID
- WALLPANELS_API_TOKEN (may be temporarily blank; read-only when supplied)
- GITHUB_REPO_URL
- possibly a sample Verona/WallPanels HighLevel Conversation URL

Extract those values from the Word document without echoing them. If the Word document is `.docx`, use a local parser (e.g. Python `python-docx` or direct DOCX XML extraction). Do not upload this file anywhere.

Create `.env.local` yourself and keep it git-ignored. If a value is missing, leave only that feature disabled and continue where possible. Do not ask me to manually create config files.

## Existing project
I will provide/open an archive/project containing a starter implementation. Treat it as a strong starting point, but review and improve it before trusting it.

Technology target:
- Node.js 20+
- TypeScript
- Telegram Bot API (grammY is fine)
- Supabase corporate project
- HighLevel read-only API
- Railway for 24/7 hosting
- Corporate GitHub repo as source of truth

## Business requirement
A client must not sit without a **human** response for more than 2 hours.

Production thresholds:
- 60 minutes: notify responsible sales rep
- 90 minutes: sales rep + Katherina/management
- 120 minutes: SLA breach to sales rep + Katherina/management

Test thresholds:
- 2 minutes
- 4 minutes
- 5 minutes

During testing, `TEST_MODE=true`: route every notification only to Telegram `@dimaqim`, but show in the notification who the production responsible user would have been.

## Approved Telegram staff
Sales:
- Kate Lukovych — @lukovychk
- Kit Pavano — @Irakli_Kit
- Anthony Kosariev — @tonykosarev
- Mary Razumna — @mariarayme

Admin:
- Dmitry — @dimaqim

Manager:
- Katherina — @katherina_ostroglo

Each user must press `/start` once. Store immutable Telegram numeric user/chat IDs in Supabase. Do not rely on username for delivery after registration.

## Responsibility routing — final rule
Use this exact priority:
1. Open Opportunity owner (`opportunity.assignedTo`). If multiple open opportunities exist, prefer a configured preferred pipeline; otherwise select the most recently changed active opportunity deterministically.
2. Conversation `assignedTo`.
3. Contact owner/assigned user if available.
4. If no mapped responsible staff member exists, escalate to Katherina + Dmitry and log an unmapped owner issue.

If Opportunity owner, Conversation assigned user, and Contact owner disagree, route by the priority above but log a CRM assignment mismatch.

## HighLevel event detection
For MVP, do **not** require a HighLevel Workflow. Use the read-only API from Railway.

Preferred efficient strategy:
- Poll `GET /conversations/messages/export` for each enabled location with a short overlap window and DB de-duplication by HighLevel message ID.
- Fetch non-email messages and Email separately (`channel=Email`) because the HighLevel export endpoint handles Email separately.
- Track customer channels: SMS, Email, WhatsApp, Instagram, Facebook, Webchat, GMB where available.
- Use a 60-second polling interval by default. Do not hammer the API; respect HighLevel rate-limit headers and add retry/backoff for 429/5xx.
- On first boot use a bounded lookback (default 24 hours), then incremental polling.

A client is waiting when there is an inbound customer message with no later **human outbound** response.

Human response classification must be conservative:
- outbound
- `userId` belongs to a known HighLevel user for that location
- source is not workflow/campaign/bulk_actions/api
- verify actual live payload shape during integration testing and adjust carefully if HighLevel represents manual messages differently

Automated workflow/campaign/API/AI-like messages must not resolve the SLA simply because they are outbound.

## Supabase
Use the corporate Supabase URL/key from Token.
Apply/review the provided migration and create the required tables for:
- companies
- staff
- ghl_users
- staff_ghl_map
- message_events
- conversation_state
- alerts
- routing_issues

Enable RLS on tables. Backend uses the Supabase secret key; do not create broad public policies.

Automatically sync HighLevel users for each location. Try exact-name mapping to the approved Telegram staff. If ambiguous/unmatched, do not guess silently; log it and fall back to manager/admin. Build a simple way for me to inspect mapping status (Telegram `/status` or logs is enough for MVP).

## Telegram alert
Format should be compact and operational, approximately:

⚠️ CLIENT WAITING — 60 MIN
Verona Home
Kristin Mahoney
Owner: Mary Razumna
Channel: SMS
Waiting: 1h 02m

“Were you able to give me a quote?”

[Open Conversation]

At 90m use a stronger warning; at 120m show SLA BREACH.

The Open Conversation button must point to the exact HighLevel conversation. Do not invent the UI route. If the Token document contains a sample Conversation URL, derive a safe template from it. If it does not, ask me once for one real sample URL after the rest of the system is working.

## Reliability
- De-duplicate messages and alerts in Supabase.
- Restart-safe: Railway restart must not re-send already recorded threshold alerts.
- If a human replies, later threshold alerts for that inbound message must stop.
- A new later inbound message can reopen the SLA state.
- Add retry/backoff around HighLevel and Telegram transient errors.
- Add structured logs without secrets/customer-sensitive bodies where unnecessary.
- Add `/health` for Railway.
- Run only one Telegram long-polling replica unless you switch to a webhook architecture.

## Local testing
Do the setup yourself as far as possible.
1. Install dependencies.
2. Parse Token.docx into `.env.local` without printing secrets.
3. Apply/link Supabase migration using corporate Supabase only. If CLI browser auth is required, ask me to approve it.
4. Start locally in TEST_MODE.
5. Tell me to open the Telegram bot and press `/start` from @dimaqim.
6. Verify `/test_alert` and `/status`.
7. Test a real Verona inbound conversation with 2/4/5-minute thresholds.
8. Confirm alerts stop after a real manual HighLevel response.
9. Only after Verona works, enable WallPanels if its token exists and repeat.

## GitHub
The corporate repository URL is in Token.docx.
- If repo is empty, initialize the local project and set that repo as `origin`.
- Use the corporate GitHub identity only.
- If `gh auth` is not authorized, ask me for one browser confirmation; do not use any personal GitHub credentials.
- Commit only source/config templates/migrations/docs. Never commit `.env.local` or Token.docx.
- Use clear commits.
- Push `main` only after local tests/typecheck pass.

## Railway
Use the corporate Railway account already associated with the company GitHub when possible.
- If Railway CLI needs browser login, ask me for one confirmation.
- Create/link a project/service named `wpvh-sales-control`.
- Connect the service source to the corporate GitHub repo `main` so future pushes auto-deploy.
- Set Railway Variables from `.env.local` without exposing values in output.
- Production variables: `TEST_MODE=false` and production SLA `60,90,120` only after I explicitly approve production cutover. Until then deploy in TEST_MODE if deployment is needed for testing.
- Use one replica.
- Verify `/health` and Railway logs after deployment.

## Deliverables before you say done
1. Working local project.
2. Database migration applied to the exact corporate Supabase project.
3. Verona API connection verified read-only.
4. Telegram `/start`, `/status`, `/test_alert` verified.
5. Real test-mode SLA path verified as far as I can provide a test inbound message.
6. WallPanels wired when its token is available.
7. No HighLevel write calls anywhere.
8. No secret committed.
9. Corporate GitHub repo pushed.
10. Railway service connected to GitHub and healthy, if authorization is available.
11. Short `RUNBOOK.md` describing how to rotate a token, add a staff member, turn TEST_MODE off/on, and diagnose a missed alert.

Do not hand me a long list of shell commands. Execute what you can yourself. Ask me only for actions that genuinely require my browser approval or a missing credential/sample URL.
