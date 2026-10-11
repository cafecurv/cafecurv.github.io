# D0B2 canonicalization and idempotency foundation

Local-only, inactive private helpers. No public submission, frontend, pricing,
tracking, C1B/C2, POS, kitchen, or dine-in timing implementation was replaced.
No quote API or v2 order creation API is included. No live database was accessed.

## Current legacy sequence, verified against local migration composition

The baseline is O12's O10-compatible submission body, widened by O14, patched by
C1B, then patched by WEBSITE_DINE_IN_TIMING_BACKEND.sql. The user's declared
deployed structured timing behavior remains the intended baseline.

1. Read/trim customer and fulfillment fields from the JSONB payload.
2. Require an object and parse optional `submission_key` as UUID.
3. Validate name/phone lengths and required fields (blank phone allowed for
   dine-in), fulfillment, delivery selections/address, items and client amounts.
   Build validated readable item snapshots. This is still legacy client pricing.
4. If a key exists, compute exactly:
   `encode(extensions.digest((payload - 'submission_key')::text,'sha256'),'hex')`.
5. Look up orders by key. Equal fingerprint returns `order_number` and
   `tracking_token`; mismatch raises existing `INV_SUBMISSION_KEY_CONFLICT`.
6. Only new submissions check the ordering-open setting (`CURV_ORDERING_CLOSED`).
7. Only new submissions validate structured dine-in timing: ASAP has no timestamp;
   scheduled must be later today in Asia/Manila. Dine-in clears pickup_time and
   uses counter payment. Other fulfillment cannot carry dine-in timing.
8. Allocate order number and insert the order. The unique partial submission-key
   index handles races; its unique-violation branch looks up the winner, compares
   the legacy fingerprint and either returns the original or conflicts.
9. Insert the validated order items.
10. C1B maintains/links the customer only on a new successful order, then returns
    the same order reference. Replay branches return before this hook.

Current submission has no catalog lookup. Replay is after static payload checks,
but before ordering closure and scheduled-time validation. This phase preserves
that exact function definition, owner, SECURITY DEFINER, config and ACL.

## New objects and deployment boundary

`WEBSITE_SUBMISSION_D0B2_FOUNDATION.sql` requires D0B1, C1B, timing, extensions.digest
and the valid/ready unique submission-key index. It creates only the private
`submission_private` schema/functions. Any existing namespace aborts for review;
no function replacement or table mutation/backfill occurs. Reapplication is not
an automatic upgrade. All new functions are SECURITY INVOKER with pinned
`pg_catalog` search_path; schema usage and function execution are revoked from
PUBLIC/anon/authenticated. No public wrapper calls these functions yet.

## Version dispatch

Use existing `orders.submission_fingerprint_version`:

- NULL or 1: exact O10 raw-payload hash, no prefix or field normalization.
- 2: canonical intent JSONB, UTF-8 bytes of `curv.intent.v2` + newline + JSONB text,
  SHA-256, lowercase hex. A fixed test vector pins this format in PGlite and native
  PostgreSQL. D0B1 `pricing_fingerprint_version` remains a separate future review
  fingerprint format; it is not the submission algorithm selector.

An existing row selects the algorithm, never the incoming client's preferred
version. Unsupported stored versions are a generic internal error, not a fallback.
New requests on this future path require numeric pricing_contract_version=2.
The current public v1 endpoint continues accepting current submissions unchanged.
Never edit the semantics of version 2 after activation; introduce another version
if normalization or the hash format must change.

## Exact canonical v2 intent

The canonical object contains:

```
pricing_contract_version: 2
currency: "PHP"
customer_name, customer_phone, customer_email
fulfillment_type
delivery_option, delivery_address
pickup_time
payment_method, customer_notes
preparation_timing, requested_preparation_at
items: [{product_id, product_size_id, option_choice_ids, quantity, item_note}]
```

Every optional field has an explicit JSON null. UUIDs become canonical lowercase
hyphenated PostgreSQL UUID text. The key is excluded from intent (it selects the
request slot). Browser prices/totals/fees, product/category/size display labels,
readable options and option snapshots, sort_order, review fingerprints, pricing
snapshots/metadata, generated timestamps and allowlisted UI state are excluded.
Unknown potential intent keys are rejected instead of silently disappearing.
An ignored field never becomes a value the future writer is permitted to trust.

### Normalization rules

| Field | Rule |
|---|---|
| Name | Required string, trim boundary ASCII whitespace, max 200 characters |
| Phone | Optional for dine-in; max 50; trim; current C1B supported PH forms become +639… |
| Unsupported nonblank phone | Preserve trimmed text, matching current acceptance; no fabricated customer identity |
| Email | Optional trimmed string, max 254; preserve case |
| Address | Optional trimmed string, max 1000; required for delivery; preserve interior whitespace and line breaks |
| Customer notes | Optional trimmed string, max 1000; no case/Unicode/internal whitespace folding |
| Item note | Optional trimmed string, max 500; empty becomes null |
| Fulfillment | Trim/lowercase using C collation; delivery/pickup/dine_in |
| Payment method | Optional trimmed/lowercased string, max 50; included in intent; future business validation remains necessary |
| Delivery option | curv_rider/lalamove for delivery; null for other fulfillment |
| Pickup/preferred time | Trim, max 120; preserve text; null for dine-in |
| Preparation timing | Lowercase asap/scheduled for dine-in; null otherwise |
| Requested time | Scheduled requires explicit-offset timestamp, at most six fractional digits; canonical UTC with microseconds |

The C1B phone rules are frozen in `normalize_phone_v2`, rather than dynamically
depending on future CRM normalization changes. Supported rules are tested against
the current C1B helper. Empty strings and absent optional values normalize to null.
Legacy aliases customer_address/preferred_time are supported, but conflicting
nonblank aliases are rejected. Delivery fields become null for non-delivery,
consistent with current semantics. Structured timing outside dine-in is rejected.

No current-time or catalog checks occur in canonicalization. An old scheduled
instant remains valid fingerprint input forever. Canonicalization is not complete
checkout validation: for example a different payment token changes intent, while
the eventual new-order validator must still enforce allowed payment/fulfillment
combinations, including counter payment for dine-in.

### Line normalization

Choice IDs sort by UUID; duplicates are rejected, including textual UUID aliases.
Quantity must be a positive integral JSON number within the PostgreSQL integer
range, not a numeric string. Canonical output is integer-valued.

Identical product + size + choices + normalized note merge by summed quantity.
Different notes remain separate. Canonical lines sort by their configuration JSONB
text under C collation, independent of customer line order. This is safe for
initial intent fingerprinting; future display ordering can be stored independently.
It does not merge or rewrite historical persisted/amendment line records.

## Resource bounds

- Future request envelope: at most 1 MiB of JSONB text, including client context.
- v2 payload: at most 256 KiB of JSONB text.
- 1–30 raw lines (existing website line limit), at most 64 choices per line.
- Each raw and merged quantity <= 2,147,483,647; no silent overflow or rounding.
- Existing text lengths retained as above.

These are technical bounds, not approval of new business quantity limits. Final
cart totals/quantity caps remain for pricing validation. JSONB parsing occurs
before these helpers: HTTP/request-size/rate limits are still necessary at the
future public entry point. The unchanged legacy endpoint is not newly size-capped;
oversized historical retries need its supported legacy route rather than being
forced through the bounded new envelope.

## Transaction lock and exact future sequence

`lock_submission_key(uuid)` derives a signed 64-bit advisory key from the first
64 bits of SHA-256 over a domain prefix plus canonical UUID. All UUID bits
participate; this avoids obvious prefix collisions. A theoretical 64-bit collision
can cause temporary unrelated-key contention, but cannot cause wrong-order replay
because lookup/comparison uses the full UUID and fingerprint.

The lock uses `pg_try_advisory_xact_lock`, 10 ms sleeps and a one-second acquisition
budget. It releases on transaction commit/rollback, not session logout. Lock
timeouts return ORDER_RETRY_REQUIRED. READ COMMITTED is required; repeatable-read
or serializable callers receive a retry response rather than using a stale
post-wait snapshot. `replay_or_prepare` is VOLATILE so its post-lock lookup can
observe the prior transaction's committed order.

`replay_or_prepare({payload, client_context?})` performs:

1. Bound/check envelope and payload object; parse required submission key.
2. Acquire the transaction-scoped key lock.
3. Look up the order by its full submission key.
4. Dispatch to stored NULL/1 or 2 fingerprint semantics.
5. Compare; on match return `{state:"replay", result:{order_number,tracking_token}}`
   immediately. No current catalog, ordering, time or pricing validation.
6. On mismatch, raise ORDER_SUBMISSION_KEY_CONFLICT.
7. If no order exists, require/canonicalize v2 and return private `state:"new"`,
   canonical intent, version and fingerprint. It creates NO order/customer/item.

The future privileged wrapper must hold this SAME transaction through new-order
ordering/fulfillment/time/catalog/pricing/review validation and atomic insertion.
Do not call prepare, commit and later insert in a second request. Its private
new-request result contains PII and a hash and must never be forwarded publicly.
Future successful public response remains the existing order reference shape.

The unique partial index remains the final backstop, especially during coexistence
with old writers that do not take the new advisory lock. Later integration must
catch that named unique conflict in a subtransaction and re-dispatch replay using
the stored version. This phase does not replace that public insertion path.
Use a short public statement/transaction budget as well: the one-second limit
bounds lock acquisition, not how long a successful caller subsequently holds it.

## Legacy additive-field boundary and browser lifecycle

The old raw hash includes even fields the old server ignored. It is mathematically
impossible to recover an arbitrary original payload from its stored hash. Removing
an arbitrary new field from retries would also reinterpret valid old hashes.

The safe migration boundary is a frozen original payload inside a new transport
envelope. New UI/transport metadata lives in `client_context`, OUTSIDE that payload.
Tests demonstrate that new envelope metadata still replays the exact old order.
Adding a field INSIDE a legacy payload still conflicts deliberately; there is no
relaxed, guessed or version-2 comparison for old records.

Current browser behavior: SHA-256 of JSON.stringify(payload) is kept with a UUID
and failure classification in sessionStorage (in-memory fallback). A changed
signature rotates the key unless the prior failure is classified validation.
Ambiguous replay eligibility requires exact signature equality. Success clears
pending state. The browser currently retains a digest, not a frozen pending body.

Future rollout must add pending-request freezing before introducing additive
payload changes for in-flight legacy attempts. Keep exact old pending payload/key
together; send later UI metadata separately. If a pre-upgrade ambiguous attempt
has only a digest and cannot reconstruct the exact body, do not silently rotate
the key or strip fields. Recover the existing order through the existing receipt/
tracking path or explicit customer/staff confirmation before starting another.
This is a frontend rollout requirement, not something solved by this SQL alone.

For v2, compare semantic intent using the same versioned rules: same intent and
ambiguous retry keeps the same key; price/review/quote refresh alone keeps it too.
Actual intent changes use a new key only after the prior outcome is known or the
customer explicitly resolves the pending attempt. PRICE_CHANGED without an order
does not require a new key. No frontend lifecycle behavior changed in this phase.

## Error contract and security

| Stable detail | SQLSTATE | Meaning / future UI action |
|---|---|---|
| ORDER_SUBMISSION_KEY_CONFLICT | P0001 | Do not overwrite; resolve existing order before starting another |
| ORDER_RETRY_REQUIRED | 55P03 | Retry same intent/key after bounded contention |
| CLIENT_UPDATE_REQUIRED | P0001 | Unsupported new contract; refresh client |
| ORDER_CART_INVALID | 22023 | Invalid/bounded structural intent; review input |

Known errors contain no hash, canonical body, lock identifier or SQL text. A future
public wrapper must allowlist these codes/messages and sanitize unexpected SQL
errors to a generic failure. Current public legacy conflict detail remains
INV_SUBMISSION_KEY_CONFLICT; that public contract was not changed here.

Keys are unguessable request capabilities, not authentication. A person possessing
a key AND matching complete intent can obtain the existing tracking reference, as
in the legacy path. Avoid logging keys/payloads/hashes. Conflicting reuse cannot
overwrite history. JSON key order, choice order and UUID formatting are handled
deterministically. Forged prices/review hashes cannot change the intent hash, but
only the future server pricing engine can prevent price tampering at submission.
SHA-256 is collision-resistant hashing, not a signature or proof of payment.

Raw private helpers are inaccessible to anon/authenticated, preventing direct
canonical PII readback and lock abuse. Future public admission limits remain
necessary because a public wrapper will enable requests to acquire locks.

## Tests and native concurrency method

`node tests/public-submission-foundation.cjs` uses disposable PGlite for model,
legacy replay, canonicalization, security, preflight and unchanged-backend checks.
It makes no simultaneous transaction claim.

`node tests/public-submission-concurrency.cjs` requires an already installed
PostgreSQL runtime via CURV_TEST_PG_BIN and node-postgres. Optional
CURV_TEST_TMPDIR chooses where retained evidence goes. It always initializes a NEW
cluster, binds only 127.0.0.1 on a free port, ignores existing PGHOST/DATABASE_URL,
and shuts its own server down afterward. It downloads nothing and never accepts
a remote database URL. Windows may require execution outside the restricted
process token for initdb; child windows are hidden.

Three independent backend PIDs exercise READ COMMITTED transactions. An observer
captures the holder's granted advisory lock and the overlapping waiter's active
PgSleep wait before releasing the holder. A test-only SECURITY DEFINER wrapper
uses the foundation and legacy RPC to insert legitimate fixture orders atomically,
then marks their fingerprint version. It is deliberately NOT a pricing engine
and is absent from deployment SQL. A customer-write audit verifies replay does not
run C1B maintenance again.

Scenarios: identical key/intent resolves one order/item and one customer write;
an unrelated key commits while the holder is still open; conflicting intent
returns the stable conflict; timeout returns retry within budget; transaction
rollback removes the tentative order and releases the lock; a waiting caller
continues after rollback. No advisory locks remain after completion. A frozen
hash vector is checked against both database engines.

These are genuine local PostgreSQL concurrency tests for the foundation. They do
not certify a future Supabase/PostgREST wrapper, authoritative pricing, mixed
writer deployment or production limits; those require later integration tests.

## Recommendation

D0B2 is ready for local D0B3 pricing-engine work. Keep current submission and
frontend behavior unchanged. Before later v2 activation, implement the privileged
writer/unique-conflict integration, exact legacy pending-request migration,
new-order validation, quote/review handling, public error filtering/admission
limits and approved production acceptance. No deployment is authorized here.

One unrelated regression fixture was corrected: customer-admin.cjs now fixes
first_order_at alongside its already fixed last_order_at, avoiding a constraint
failure once the real date passes October 1, 2026. No C2 business code changed.

## Recorded local acceptance — October 4, 2026

| Suite (node tests/<name>.cjs) | Passed assertions |
|---|---:|
| public-submission-foundation | 134 |
| public-submission-concurrency | 17, across 4 genuine concurrent scenarios |
| public-pricing-model | 92 |
| public-pricing-preflight | 28 |
| public-configuration-database | 46 |
| dine-in-timing-database | 41 |
| dine-in-timing-browser | 22 |
| customer-records | 73 |
| customer-admin | 116 |
| public-customer-details | 74 |
| customers-browser | 80 |
| pos-database | 51 |
| pos-kitchen-database | 45 |
| pos-browser | 13 |
| pos-kitchen-browser | 28 |

Final native run: PostgreSQL 17.6, loopback port 55870, independent backend PIDs
44308/41264/8568. Bounded contention returned 55P03/ORDER_RETRY_REQUIRED after
1012 ms; conflicting intent returned P0001/ORDER_SUBMISSION_KEY_CONFLICT. No
unexpected application errors, no exposed unique violation, no shutdown error.
Server stopped after the test. Evidence is retained in the task workspace:
`curv-d0b2-Mx1ZWs/results.json`.

All four changed/new CJS files pass node --check. git diff --check and explicit
untracked-file whitespace checks pass. The initial native bootstrap could not
run under the Windows restricted process token; acceptance subsequently ran in
fresh disposable clusters outside that token, with no live database access.
