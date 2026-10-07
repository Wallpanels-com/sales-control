# Test Plan

## Phase 1 — local smoke test
1. Set `TEST_MODE=true`.
2. Run the Supabase migration.
3. Start the app locally.
4. Open the Telegram bot from `@dimaqim` and send `/start`.
5. Send `/test_alert` and `/status`.

## Phase 2 — real Verona SLA test
1. Keep thresholds at `2,4,5` minutes.
2. Use a safe test contact/conversation in Verona Home.
3. Send a real inbound client-side message in SMS and Email, then repeat for any enabled WhatsApp, Instagram, Facebook, and WebChat channels.
4. Do not answer. Confirm alerts at ~2, ~4, ~5 minutes all arrive only to Dmitry.
5. Repeat. This time answer manually from HighLevel after the first alert.
6. Confirm later alerts stop after the human outbound message is ingested.
7. Inspect Supabase `message_events`, `sla_incidents`, and `alerts`.
8. Confirm call records do not open an unanswered-message SLA and automated outbound workflow messages do not resolve one.

## Read-only payload inspection (5 October 2026)

The Verona export returned `TYPE_SMS` and `TYPE_CALL` without `channel`, and `TYPE_EMAIL` with `channel=Email`. A fresh 30-day metadata-only inspection returned 161 records: manual `app` outbound messages were observed for both SMS and Email, while workflow outbound SMS and Email frequently carried known `userId` values. This confirms that `userId` alone cannot prove a human reply and validates the conservative `source=app` rule for the two live channels. Calls are explicitly excluded. No WhatsApp, Instagram, Facebook, or WebChat sample was present in that period, so those aliases are covered by tests and the generic text/file/attachment fallback but await a live example.

## Phase 3 — owner routing test
1. Keep TEST_MODE on.
2. Confirm the alert text says who the production Opportunity Owner would have been.
3. Verify owner resolution for at least one known sales rep.
4. Review unmapped GHL users and create explicit staff mappings if exact-name auto-mapping is not enough.

## Phase 4 — WallPanels
1. Add `WALLPANELS_API_TOKEN`.
2. Restart locally.
3. Repeat the same test against a safe WallPanels conversation.

## Phase 5 — production
1. Change `TEST_MODE=false`.
2. Set `SLA_THRESHOLDS_MINUTES=60,90,120`.
3. Set `PRODUCTION_CUTOVER_AT` to the approved UTC baseline timestamp.
4. Each sales rep and Katherina opens the bot and sends `/start` once.
5. Push `main` to corporate GitHub.
6. Railway auto-deploys from `main` with production Variables.
7. Keep exactly one bot service replica because Telegram long polling must have one active consumer for this token.

## AI classification
1. Confirm pure acknowledgements such as `Thank you!`, `Thanks 👍`, `Okay, got it`, and `Perfect, thank you` return `needs_reply=false` with confidence at least `0.90`.
2. Confirm messages containing a question or request remain actionable, including quote, price, installation, and product-option examples.
3. Confirm API errors, timeouts, rate limits, invalid JSON, and confidence below `0.90` all result in SLA control.
4. Start with an existing actionable incident, ingest a later non-actionable acknowledgement, and confirm the incident message and timer do not change.
5. Run automatic tests with a mocked Telegram sender. If a real Telegram smoke test is required, enable `TEST_MODE=true` and verify that only Dmitry's stored numeric chat ID receives it. Restore `TEST_MODE=false` afterward.
