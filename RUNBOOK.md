# WPVH Sales Control runbook

## Rotate a token

Replace the affected value in the local ignored `.env.local` and the matching Railway variable, then restart the one Railway service. Rotate the old credential in its provider after the new one passes `/health` and a read-only connection check. Keep `TEST_MODE=true` during rotation. Never paste token values into logs, issues, or commits.

## Add or update staff

Add the approved name, Telegram username, and role to `config/staff.seed.json`. Deploy, then have that person privately send `/start` to the bot. Registration binds the staff record to the numeric Telegram user ID; a different account cannot replace it with the same username. To change a registered account, an administrator must verify the person and clear that row's Telegram IDs in Supabase before the new account sends `/start`. Check `/status` for CRM mapping counts. Exact-name CRM matches are automatic; ambiguous or unmatched owners must be reviewed in `staff_ghl_map` and `routing_issues`.

## Test mode and production cutover

`TEST_MODE=true` sends all SLA alerts only to Dmitry's registered numeric chat ID at 2, 4, and 5 minutes. It ignores messages older than the current test service run so a 24-hour bootstrap does not flood Telegram. Before the approved production cutover, resolve existing open incidents as a pre-production baseline and set `PRODUCTION_CUTOVER_AT` to that UTC timestamp. With `TEST_MODE=false`, every 60, 90, and 120 minute alert goes to the mapped sales owner, Dmitry, and Katherina. Restart after a variable change. Keep one replica because Telegram uses long polling.

## Diagnose a missed alert

1. Check `GET /health`, Railway logs, and `/status`. Confirm the service is polling, the company is enabled, and Dmitry or the production recipient has pressed `/start`.
2. Check the HighLevel read-only token and location ID. Inspect `message_events` for the inbound message and `sla_incidents` for its latest inbound, status, and resolution values. Confirm the channel is supported and the message is inside the polling window.
3. Check that a later outbound was a real human message with a known HighLevel `userId`; automated sources do not resolve the SLA. Inspect `ghl_users`, `staff_ghl_map`, `routing_issues`, and `assignment_mismatches` for an unmapped or conflicting owner.
4. Check `alerts` for the inbound message ID, threshold, and recipient. If a row exists, Telegram accepted the send. If no row exists, inspect Telegram error logs and the recipient's registration. Alert rows persist across restarts to prevent normal resend.

The Open Conversation button is enabled only when a verified company URL template is configured. Do not guess a HighLevel UI route.
