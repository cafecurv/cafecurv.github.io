# D0B5 gated authoritative v2 submission

Local draft and local acceptance only. No live Supabase, production SQL,
deployment, commit or push. No menu/frontend switch, payment settlement,
distance quote, amendment or POS change.

## Architecture and gate

Add `public.submit_public_order_v2(p_request jsonb) returns jsonb` separately.
The existing public.submit_public_order(jsonb) definition, ownership, privileges
and behavior remain unchanged. No failed v2 request is routed to legacy handling.
The gate is the separate endpoint: existing clients still call v1. Installing
this draft WOULD expose the new opt-in RPC to anon/authenticated; it is not a
disabled feature flag. Installation/deployment requires later approval.

The v2 wrapper performs D0B2 replay, current validation, D0B3 pricing and D0B4
review comparison. Only a matched quote is translated into trusted legacy
snapshot fields and passed to the existing writer, without a submission key.
This shares existing validation, order allocation, insert, C1B and tracking
logic instead of maintaining a second order-creation implementation.

Inside the SAME transaction the wrapper attaches the key, canonical intent
fingerprint and pricing metadata, then attaches each structured item snapshot.
It restores exact reviewed display labels (the legacy writer trims them).
Only then does it return. The provisional keyless order is never committed or
visible to another transaction. Any later failure rolls back that order, all
items and transactional customer maintenance. This adapter intentionally uses
an UPDATE before commit; it is not an externally visible order amendment.

Tradeoffs: additional small updates, reliance on the reviewed legacy writer's
contract, and that writer/C1B seeing provisional metadata inside this transaction.
Any production triggers must be reviewed before deployment, especially external
side effects. Future v1 retirement must first extract/share the writer or preserve
an internal writer entry; simply disabling the currently reused function would
also break v2. No such retirement is implemented now.

## Installation checks

Requires reviewed D0B1-D0B4 plus O12/O14/C1B/structured timing. The transaction
checks expected metadata column types, required helpers, writer owner/security
and baseline markers, and exact valid/ready unique partial submission-key index.
Any overload collision with either new function stops installation for review.
No tables, indexes, columns or policies are added. No historical backfill.
Run under the existing trusted writer owner after production preflight approval.
Reapplication deliberately stops rather than overwriting existing functions.

## Exact request contract

The envelope is D0B2's envelope, not a new flat request. Optional client_context
stays outside the frozen payload so exact legacy replay is possible.

```json
{
  "payload": {
    "pricing_contract_version": 2,
    "submission_key": "<UUID>",
    "review_fingerprint": "<64 lowercase hex characters from D0B4>",
    "customer_name": "Guest",
    "customer_phone": "",
    "customer_email": null,
    "fulfillment_type": "dine_in",
    "payment_method": "counter",
    "preparation_timing": "asap",
    "requested_preparation_at": null,
    "customer_notes": null,
    "items": [{
      "product_id": "<UUID>",
      "product_size_id": "<UUID>",
      "option_choice_ids": [],
      "quantity": 1,
      "item_note": null
    }]
  },
  "client_context": {}
}
```

Delivery additionally needs delivery_option (curv_rider/lalamove) and an actual
delivery_address; Pickup/Delivery need a nonblank phone. pickup_time/preferred_time
retain existing string semantics and limits; they are not repurposed for dine-in.
Scheduled dine-in uses an explicit-offset requested_preparation_at, later today
in Asia/Manila. D0B2 normalizes timestamp/identity solely for intent comparison.

Allowlisted compatibility monetary/display fields are ignored, including subtotal,
total, unit_price, line_total, client product/option/size names and price snapshots.
Submitted delivery_fee/status cannot set a fee or claim confirmation. Unknown
fields still fail under the frozen D0B2 contract. The review hash is excluded
from the intent fingerprint; changing only the reviewed hash permits the same
key to be reused after PRICE_CHANGED. New payload <=256 KiB, outer D0B2 envelope
<=1 MiB, <=30 raw lines, <=64 choices per line, <=500-character item notes.

## Replay and validation order

1. D0B2 bounded envelope/key checks.
2. Transaction-scoped per-key lock (READ COMMITTED; bounded one-second wait).
3. Lookup existing order and dispatch stored fingerprint version (NULL/1 or 2).
4. Matching replay returns original order_number/tracking_token immediately.
   No ordering-open/time/catalog/review validation, pricing, allocation or linking.
5. Mismatch returns ORDER_SUBMISSION_KEY_CONFLICT.
6. Only a new request proceeds through canonical customer/fulfillment validation,
   review-hash shape check, current ordering/payment/delivery/timing checks,
   authoritative pricing and review comparison.

Ordering fails closed if store settings are missing/closed. Current website
payment selections are counter/cod/gcash/bank; new dine-in must send counter.
No method confirms payment: status remains unpaid. The new-only check mirrors
the current form and does not change permissive historical v1 handling.
The website's Returning customer address placeholder is rejected for new delivery.
No invented operating-hours or multi-day scheduling rule is introduced.

The legacy writer repeats its full current checks immediately before allocation.
Thus a closure or scheduled deadline reached after pricing still prevents insertion.
D0B2 shape errors (including malformed quantity or missing timing) remain its
ORDER_CART_INVALID rather than changing frozen replay canonicalization. New
computed monetary overflow uses QUANTITY_INVALID; current scheduled-date failures
use DINE_TIMING_NOT_LATER_TODAY. No existing phone-format policy is broadened:
supported C1B phones link; unsupported nonblank phones remain guest orders.

## Pricing, review and PRICE_CHANGED

One D0B3 statement snapshot supplies all prices, labels and certified configuration.
The stored values and D0B4 customer_pricing_review use that SAME engine result;
there is no second pricing query or client price trust.

If the provided review hash differs, return:

```json
{
  "ok": false,
  "error": {
    "code": "PRICE_CHANGED",
    "message": "Your order details or prices changed. Please review again."
  },
  "quote": "<the complete D0B4 quote object, not a string in the actual response>"
}
```

Nothing is inserted/linked and no sequence number is allocated. D0B6 must show
the fresh quote and wait for explicit customer review. It must not automatically
resubmit or treat PRICE_CHANGED as success. For unchanged intent it can retain
the key and replace only review_fingerprint. After ambiguous transport failure,
retry the same frozen request/key; an accepted order returns replay even if its
review hash, prices, opening status or scheduled deadline are now stale. Intent
edits must follow D0B2's different-key lifecycle, not overwrite an accepted order.

## Persistence

Success retains exactly `{order_number, tracking_token}` without a new success
envelope. Header metadata:

- pricing_contract_version=2
- pricing_policy_version from engine
- pricing_fingerprint_version=1
- accepted_review_fingerprint from D0B4
- priced_at set by server after pricing
- submission_fingerprint_version=2
- public_submission_fingerprint from D0B2 canonical customer intent

Subtotal is authoritative merchandise subtotal. Existing total semantics are
preserved: delivery initially stores the same amount in total while delivery_fee
is NULL and delivery_fee_status=to_confirm. That total is NOT confirmed delivery
grand total. Pickup/dine-in have NULL fee and not_applicable status.

Readable product/category/variant/options/quantity/note/prices/sort order come
from the engine. Options retain the existing object-of-readable-arrays format;
equal group display names share a list, while private snapshots preserve IDs.
Per-line policy/version/identities/options are stored in the D0B1 structured
pricing_configuration_snapshot. Later catalog changes do not reprice saved rows.
No current consumers need to read private structured snapshots.

Original trimmed submitted phone stays in the order snapshot; canonical phone
normalization applies to intent hashing and existing C1B linking. Blank dine-in
phone keeps customer_id NULL. Existing C1B runs exactly once through the writer
for a genuinely new successful order. Replay/PRICE_CHANGED do not invoke it.

## Atomicity, numbering and unique backstop

No intermediate commits. The exception boundary covers legacy writer calls,
customer maintenance, metadata attachment and item snapshots. Failed item insert,
link or snapshot update leaves no partial order/items/customer changes.

Replay, known-invalid requests and PRICE_CHANGED allocate no order number. A normal
success allocates one. PostgreSQL sequence advances cannot be rolled back: late
failure, transaction rollback or noncooperating-writer conflict can leave gaps.
Do not weaken transactional rollback to remove gaps.

The primary v2 lock is supplemented by the existing unique partial key index.
Only orders_public_submission_key_idx is caught as a recoverable key conflict.
The complete failed attempt rolls back, then D0B2 looks up the winner and dispatches
its stored fingerprint version. Match returns replay, mismatch returns conflict;
a missing winner returns ORDER_RETRY_REQUIRED. Other unique failures are sanitized.

## Error/security contract

Public wrapper: VOLATILE SECURITY DEFINER, pinned search_path=pg_catalog, qualified
application objects, no runtime dynamic SQL. Only anon/authenticated receive
explicit execution; PUBLIC is revoked. The new current-validation helper and
all prior pricing/submission helpers remain private. No raw table grants added.

Expected safe codes: CLIENT_UPDATE_REQUIRED, ORDER_CART_INVALID, QUANTITY_INVALID,
PRODUCT_UNAVAILABLE, SIZE_INVALID, OPTION_INVALID, OPTION_REQUIRED,
OPTION_SELECTION_INVALID, CONFIGURATION_INVALID, PRICE_CHANGED,
ORDER_SUBMISSION_KEY_CONFLICT, ORDER_RETRY_REQUIRED, CURV_ORDERING_CLOSED,
DINE_TIMING_REQUIRED, DINE_TIMING_INVALID, DINE_TIMING_NOT_LATER_TODAY.
Unknown errors return ORDER_INTERNAL_ERROR. SQLSTATE/table/function/constraint
names and raw messages are never returned. Errors are `{ok:false,error:{code,message}}`.
No payment/Sale/reservation is created and no lower price can be forced by forging
a review hash. Upstream admission/rate/statement deadlines remain deployment work.

## Native concurrency evidence

Fresh PostgreSQL 17.6 cluster, independent A/B/C backend PIDs, explicit overlapping
transactions, pg_stat_activity/pg_blocking_pids observations, synthetic data only.
The test uses the REAL D0B5 endpoint, not a replacement submission implementation.

29 assertions across eight recorded scenarios:

1. Same key/same intent with forged money: one order/item set, same result, one
   C1B maintenance; an unrelated key commits while the first transaction stays open.
2. Same key/different intent: winner plus safe conflict.
3. Rollback: first order disappears, lock released, waiting peer succeeds.
4. PRICE_CHANGED: no allocation; explicitly reviewed same-key retry succeeds.
5. Noncooperating legacy writer: real unique-index conflict, matching v1 replay.
6. Same backstop with different intent: conflict, no orphan attempted order/items.
7. Catalog price/certification commits during an in-flight statement: coherent old
   reviewed snapshot persists; next statement requires the new quote. Pricing is
   a statement-snapshot checkpoint, not a catalog reservation through commit.
8. Scheduled order: successful submit, actual wait past deadline, successful replay.

The catalog test adds a rollback/disposable-only advisory gate around the actual
STABLE engine to establish its snapshot before the independent catalog commit.
No production engine changes. Results retain order/item/customer-audit evidence.
All clusters shut down. Final evidence path is recorded in the completion report.

## Consumer compatibility and local admin caveat

Real saved v2 rows pass current tracking RPC/DOM, C2 owner history, admin item
detail DOM and kitchen ticket rendering. Options/notes/amounts render and dynamic
labels escape correctly. Timing renderer shows Preparation: ASAP or Manila time.
POS customer-copy tests remain isolated; no website order is admitted to POS RPCs.

This checkout still has the previous old-schema Incoming Orders SELECT lists:
they omit preparation_timing/requested_preparation_at, although renderers support
both. Its existing browser suite explicitly tests that compatibility mode.
That pre-existing difference from the user-reported timing-enabled deployment was
not changed here. Consumer tests separately exercise the timing renderer with
actual persisted v2 rows. Before a frontend deployment, reconcile the intended
timing-enabled admin artifact; do not overwrite it with this older local mode.

## Acceptance / next phase

New suites: integration 162, preflight 21, native concurrency 29, real-row browser
consumers 14. Existing pricing/configuration/menu/dine-in/customer/POS/kitchen and
native replay/snapshot/preview suites passed; detailed counts in final report.
All five new CJS files pass syntax checks; whitespace checks pass.

No local v2 backend blocker remains. Ready for separately authorized D0B6 frontend
review/submit integration, with explicit PRICE_CHANGED acknowledgement and frozen
retry handling. Production preflight, trigger review, prerequisites/certification,
owner/privilege checks, upstream limits and deployment approval remain gates.
