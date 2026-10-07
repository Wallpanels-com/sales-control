# WPVH Sales Control — Architecture

## Goal
Prevent client messages in Verona Home and WallPanels from sitting unanswered for more than 2 hours, and deliver actionable Telegram alerts to the responsible sales rep and management.

## Production flow

HighLevel (read-only API) → Railway backend (24/7) → Supabase → Telegram Bot

No HighLevel workflow is required for the MVP. The Railway service polls HighLevel message exports on a short interval, with overlap and database de-duplication.

### Why polling is used
Private Integration Tokens are suited to internal integrations but do not themselves subscribe to webhook events. Polling lets the project stay read-only inside HighLevel and avoids adding CRM workflows. The code uses a small number of API requests per poll and de-duplicates messages by HighLevel message ID.

## Message ingestion
For each enabled company:
1. Fetch recent non-email messages with `GET /conversations/messages/export`.
2. Fetch recent Email messages with the same endpoint using `channel=Email`.
3. Normalize SMS, Email, WhatsApp, Instagram, Facebook, WebChat, and GMB to a single `channel` field. Retain new text/attachment channels under their original type for review. Exclude calls and CRM activity records.
4. Insert unseen messages into `message_events`.
5. Classify each new inbound message with Groq using the latest message and up to five prior conversation messages. Store the result and model metadata in `message_events`.
6. Suppress a new SLA incident only when the model returns `needs_reply=false` with confidence `>= 0.90`. Any failure or uncertainty stays under SLA.
7. An actionable incoming message opens a new `sla_incidents` record or advances the current open incident. A non-actionable follow-up never closes, replaces, or resets an existing actionable incident.
8. Human outbound message after the actionable inbound message resolves the state.

A human outbound message must have `source=app`, the manual source observed in live Verona and WallPanels exports. When HighLevel supplies `userId`, it must be a known HighLevel user. HighLevel omits `userId` on some real manual Email, Instagram and Facebook replies, so those `source=app` replies are accepted without it. Workflow/API/AI outbound messages use other sources and never resolve an incident, even when they carry a known user ID.

## SLA
Production: 60 → 90 → 120 minutes.
Test mode: 2 → 4 → 5 minutes.

- 60m: responsible sales rep + Dmitry + Katherina.
- 90m: responsible sales rep + Dmitry + Katherina.
- 120m: SLA breach, responsible sales rep + Dmitry + Katherina.
- TEST_MODE routes every alert only to `@dimaqim` while preserving the calculated production owner in the message.

## Routing
Responsibility order:
1. Open Opportunity owner (`opportunity.assignedTo`).
2. Conversation assigned user (`conversation.assignedTo`).
3. Contact owner/assigned user if present.
4. Manager/admin fallback.

If owners disagree, the alert still routes using the priority above and records a CRM assignment mismatch for later review.

## Telegram registration
The approved staff list is seeded in `config/staff.seed.json`.
Each employee must open the bot once and press `/start`. The bot stores the immutable Telegram user/chat IDs in `telegram_users`. Username alone is not used for delivery after registration.

## Security boundaries
- No HighLevel write endpoint is used.
- Secrets live only in local `.env.local` and Railway Variables.
- `.env*`, Token documents and secret files are git-ignored.
- Supabase tables have RLS enabled and no public policies; only the backend secret key accesses them.
- The Groq API key is read only from environment variables and is never written to Supabase or logs.
- Codex must never inspect personal GitHub, personal Supabase, browser passwords, Keychain, or unrelated folders/accounts.
