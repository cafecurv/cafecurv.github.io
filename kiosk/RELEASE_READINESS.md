# Kiosk-only release safety and rollback

Local candidate only. No staging, commit, production SQL, accounts or deployment authorized. Base 79e8ff59cc978da586f311f1d392d145f2d14cf1 was verified by ls-remote without fetch/ref update. Existing integration/source/hotfix remain preserved.

## Release scope
Only kiosk runtime, disabled config, two reviewed SQL drafts, 13 reviewed menu overlay hunks, matched public-controller version marker, exact SDK pin/SRI, and essential tests/docs. Existing production Control and tracking sources are unchanged. Public fulfillment markup/defaults and controller business code are preserved; the actual base selects Dine In. No new WEBSITE_DELIVERY_D1/P5 code or migration is introduced.

## Migration and permission gates
Apply nothing until separately approved production metadata inspection verifies D0 pricing/submission helpers, Auth sessions, owner/POS membership checks, order columns/defaults, global orders_public_submission_key_idx, exact validated d0b1_order_pricing_metadata definition, RLS and effective inherited grants. Local tests do not prove production permissions. Check all public.kiosk_* names and kiosk_private namespace before installation: the reviewed backend draft's final grant-prefix loop can touch preexisting matching functions. Stop on collisions; any explicit-grant upgrade requires separate approval.

The schema draft replaces a shared check constraint to admit fingerprint version 3 while preserving 1/2. It takes table locks and validates history. Plan an approved maintenance/lock-timeout window, backup and definition hash review. The two drafts have separate transactions: if schema commits and backend fails, keep disabled and inspect; never blindly rerun collision-rejecting CREATE scripts or drop populated objects. No historic migration edits.

## Disabled state and public ordering
config.js remains enabled:false with blank URL/key. SQL settings mode starts off; no identities seeded. Provisioning and activation are separate approvals. website_ordering_enabled is still required for new kiosk submission. Do not toggle ordinary website ordering merely to enable kiosk without approval. Accepted replay occurs before current pricing/ordering gates, subject to live device/session authorization.

## Owner operations and uncertain attempts
Use dedicated nonstaff identity per tablet, never owner/staff sign-in. Owner-only kiosk_owner_device grants/renews finite leases (maximum 24 hours), drain or revocation. Opening/closing-shift checks and a trusted owner workstation are required. Browser-readable session tokens remain a theft risk; live revoke plus session invalidation/password rotation is the response, not JWT-expiry assumptions.

Keep uncertain frozen request/key. kiosk_owner_recover can verify a known generation/key but cannot discard an admitted attempt. Tab-loss discovery needs an approved owner metadata tool/query. A permanently invalid admitted request has no terminal reset RPC: quarantine/owner investigation and a documented staff fallback are required before activation; never delete attempts or generate a fresh key to evade uncertainty.

## Rollback
Planned: drain -> owner reconcile -> mode off and device revoke -> disable frontend. Emergency revoke/off may wait for already admitted transactions holding shared locks; inspect outcome afterward. Preserve accepted orders/provenance and version-3 constraint/guards. Do not downgrade fingerprints or drop schema as automatic rollback. Auth deletion is constrained by device foreign keys; revoke instead. Restore approved public assets without changing financial history.

## Remaining production gates
Independent review; metadata-only production inspection; explicit migration approval; production identity/owner-tool approval; exact frontend commit/tree deployment approval; separate controlled live-order/activation approval. Verify real catalog certification, same catalog/submission project, actual hosted JWT settings, effective anonymous/authenticated permissions and unchanged production Control write workflow. No local harness, test CA/keys, synthetic catalog, test identity or Control adapter belongs in production.

## Held production-Control baseline finding

The unchanged production renderer displays Unpaid when an intentionally malformed read response omits payment_status. The original integration test expected P5 fail-closed Unknown and removal of payment controls. The first negative assertion failed; the second was not reached. That original suite and log are preserved in the audit directory, not relabeled passing. The kiosk-only compatibility suite retains all real-order reads, controls, exact financial fields and zero-write checks, but excludes these two P5-only malformed-projection checks. The standalone real Auth suite additionally proves owner status/payment writes preserve authoritative total. Production verification must confirm payment_status exists and is selected; any decision to fix the legacy malformed-response defense requires a separate focused approval, never importing P5 wholesale.
