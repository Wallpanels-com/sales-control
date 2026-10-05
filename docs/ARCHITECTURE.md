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
5. Incoming customer message opens a new `sla_incidents` record or advances the current open incident to the latest inbound message.
6. Human outbound message after the inbound message resolves the state.

A human outbound message is deliberately classified conservatively: its `userId` must be a known HighLevel user and its source must be `app`, the manual source observed in the live Verona export. Workflow outbound messages often carry known user IDs, so other sources cannot by themselves prove a human reply.

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
- Codex must never inspect personal GitHub, personal Supabase, browser passwords, Keychain, or unrelated folders/accounts.
