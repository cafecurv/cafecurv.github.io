# D0B6 authoritative frontend checkout — local review

No live Supabase connection, production SQL, deployment, commit or push. No SQL
or historical order changes in this phase. POS/payment settlement/distance delivery
and amendments remain outside scope.

## Discovery and authority boundary

Existing cart entries contain product_id, product_size_id, option_choice_ids,
option snapshots, qty, options.note, plus local name/variant/category/price.
D0A.1 binds stable IDs; menu option chips still calculate responsive catalog-based
prices, including contextual display adjustments. renderCart/getCartSubtotal and
buildMessage calculate local quantity × price. Those are estimates/manual-copy
utilities; they are not used to calculate final checkout money.

Previously buildPublicOrderPayload copied local names/options/unit_price/line_total
and local subtotal/total into public.submit_public_order. Its confirmation modal
did not display an authoritative quote. sessionStorage held only key/digest/failure
mode, not the original body. That old helper remains for manual-copy compatibility
and existing tests, but the online submission entry now delegates exclusively to
the new authoritative-checkout.js controller.

The controller builds a separate allowlisted payload. No local display/monetary
fields are sent. Cart labels now say Estimated subtotal. Final review uses only
the D0B4 quote's merchandise subtotal, server names, sizes, options, quantity,
notes and fixed-decimal amounts. Delivery fee remains separately unconfirmed.
The existing success/after-submit/recent-order tracking UI receives the accepted
server quote subtotal, including zero without a local-price fallback.

## Files

- menu/authoritative-checkout.js: quote/review/submission/recovery controller.
- menu/index.html: controller load/delegation, authoritative confirmation,
  estimate wording, mutation hooks, paused recovery and scoped review wrapping.
- admin/admin.js: forward timing SELECT reconciliation and corrected comment.
- tests/public-checkout-browser.cjs: offline browser against actual local SQL.
- tests/public-checkout-test-fixture.cjs: quote transport for existing C1A/timing tests.
- tests/public-customer-details.cjs and tests/dine-in-timing-browser.cjs: v2 fixtures;
  local-profile storage failure remains independent of session-pending storage.
- tests/dine-in-incoming-browser.cjs: approved timing-enabled baseline fixtures.
- This review/rollout document.

## Quote model and equality

States: idle, quoting, ready, stale, error. State stores the authoritative quote,
review hash/version fields inside that quote, canonical item intent, semantic order
intent and an async generation counter. Late responses for invalidated requests
are discarded. Items use UUIDs, sorted unique choices, positive integral quantity
and ASCII-boundary-trimmed notes. Equal configurations/notes merge; line input
ordering does not change identity. These rules mirror D0B2 identity principles;
the browser does NOT compute a server fingerprint.

Quote RPC:
`quote_public_cart({p_request:{pricing_contract_version:2,items:[...]}})`.
No browsing-only quote calls. Opening the final review obtains a quote. Meaningful
cart mutations invalidate it; mutations during review close stale confirmation
and refresh review. Customer/fulfillment edits also require another confirmation.
Changing cached labels/prices does not create a false intent change.

Response shape/versions/currency/money/identity are checked before enabling final
confirmation. Quote/network failure leaves no final submit action and allows a
price-review retry. There is no local-price fallback. Both quote and submission
transport have a 30-second UI deadline; a submission deadline is ambiguous, not
proof that the server did not commit.

## V2 request and storage

RPC: `submit_public_order_v2({p_request:{payload,client_context:{}}})`.
Payload includes pricing_contract_version=2, submission_key, review_fingerprint,
customer_name/phone/email, fulfillment/payment/notes, applicable address/delivery
option/pickup time, structured dine-in timing, and stable item selections only.
No prices, labels, fee confirmation or payment credentials are authoritative.

Session key: `curv-pending-order-v2`, format version 1:

```text
{
  version: 1,
  state: ambiguous | price_changed | validation | conflict,
  request: { payload: <complete attempted request>, client_context: {} },
  subtotal: <accepted server quote subtotal>,
  remember: <original C1A opt-in>,
  details: <C1A allowlisted candidate only when opted in; otherwise null>
}
```

The request is persisted BEFORE network submission and deep-copied for transport.
Storage failure prevents an unfrozen send. The pending request necessarily contains
order/contact/address/note fields required for exact retry; it is session-scoped,
not a customer identity store. There are no payment credentials or secrets.
The optional C1A candidate preserves consented reusable details, not quote metadata.

On reload, uncertain recovery bypasses the current cart/form/current timing and
replays the stored request. No reconstruction from a digest or new catalog data.
Malformed/inaccessible pending storage blocks new submission conservatively.
An old digest-only ambiguous request cannot be reconstructed safely: customers
must use tracking/contact CURV to resolve it. It is never silently replaced by a
new v2 order. Do not erase those old keys during rollout.

## Key lifecycle and success

Same request/key: timeout, connection loss, incomplete confirmation, unexpected
submission error, ORDER_RETRY_REQUIRED. Current edits cannot replace it until
resolved. Recovery remains accessible when Website Ordering is paused or the
original dine-in scheduled time has passed.

PRICE_CHANGED proves no new order was created. The fresh quote displays immediately,
without resubmission. Review & Continue opens explicit confirmation. Only Confirm
Updated Order replaces review_fingerprint and submits with the same key. If intent
is edited instead, the known non-created attempt is retired and the next confirmed
attempt receives a new key and quote. Known validation failures permit correction;
unchanged intent can retain its key. A key conflict never silently rotates: it
requires safe tracking/operator recovery.

Success requires both order number and valid tracking token. Only then is pending
state cleared, the existing tracking/recent-order/confirmation UI shown, and the
cart/form locked as before. Existing success behavior retains the locked cart;
this phase does not introduce a new cart-reset policy. C1A saves only after success,
with original opt-in AND current consent; a later opt-out is respected. No quote,
hash, key or pending request enters long-lived remembered-customer storage.

## Error/UX/security boundaries

Expected D0B5 errors map to fixed customer messages. Quote errors cannot create
orders. Unknown submission errors remain conservative. Raw backend diagnostic
messages are never appended to customer text. There is no fallback to v1 submission.

Loading/duplicate-submit controls cover quoting, review and submission. Accessible
status announcements and the existing modal dialog/focus controls remain. All
dynamic server/customer/note fields in review HTML are escaped. Long text wraps;
the existing dialog scrolls for large carts. Responsive overflow checks passed at
320/390/768/1280; the 390-pixel screenshot was visually reviewed.

## Fulfillment, timing and payments

Dine-in: name required, phone optional, no delivery address, counter payment,
ASAP with null timestamp, scheduled later today in Asia/Manila. Existing controls
and validators remain. Pickup retains its time semantics and no dine-in timing;
Delivery retains real address/option requirements and an unresolved fee. GCash,
bank and cash method selection is not proof of payment. No settlement added.

Local Incoming Orders drift is reconciled FORWARD: list and search SELECTs now
include preparation_timing/requested_preparation_at. Realtime refresh uses the
same list path. Existing preparation renderer and ticket renderer are retained.
Tests cover ASAP, scheduled Manila display, NULL legacy rows, Pickup/Delivery,
search, realtime and normal status workflow. No production timing downgrade.

## Local acceptance

Focused browser tests call the REAL embedded D0B4/D0B5 SQL for quote/submission;
all web requests are intercepted. They exercise successful orders, forged display
prices, explicit PRICE_CHANGED review, same/new key behavior, response loss after
commit, loss before receipt, reload recovery, paused replay, timeout, conflict,
storage failure, quantity/choice/size/note/customer edits, delivery/pickup, C1A and XSS.
Existing C1A/timing tests use small updated mock quote transports; they are not the
evidence for backend monetary authority.

Native PostgreSQL regression clusters were newly created on loopback and stopped:
D0B5 concurrency 29, D0B2 concurrency 17, engine snapshot/performance 11, preview 10.
Full regression counts are in the completion report. Syntax checks include inline
menu scripts, the new controller, admin code and all changed/new CJS files.

## Exact recommended production order — NOT executed

1. Capture current deployed function/schema/ACL baselines and verify O10/O12/O14,
   C1B and the already-approved structured timing prerequisites. Confirm the
   intended timing-enabled admin artifact. Review production triggers and owner.
2. Review/apply WEBSITE_CONFIGURATION_D0A1_SCHEMA.sql only if not already deployed.
3. Review/apply WEBSITE_PRICING_D0B1_SCHEMA.sql only if not already deployed.
4. Populate/review exact live stable configuration mappings, overrides, requirements,
   compatibility and certifications. No dummy configuration or historical backfill.
5. Review/apply WEBSITE_SUBMISSION_D0B2_FOUNDATION.sql.
6. Review/apply WEBSITE_PRICING_D0B3_ENGINE.sql.
7. Review/apply WEBSITE_PRICING_D0B4_PREVIEW.sql.
8. Review/apply WEBSITE_SUBMISSION_D0B5_BACKEND.sql.
9. Verify definitions/owners/ACLs/RLS, preview values, v1 compatibility, v2 review
   mismatch and approved isolated replay/concurrency/rollback cases. Confirm public
   API timeouts/rate/request limits and configuration coverage. Never blindly rerun
   collision-protected drafts: an existing object requires review instead.
10. Only after D0B7 acceptance/approval, release menu/index.html and its new
    authoritative-checkout.js asset together, plus the reviewed timing-enabled
    admin artifact. Check real loading/caches/CDN and mobile/browser behavior.
11. Run approved live smoke acceptance, monitor errors and keep legacy replay
    support. v1 retirement is a separate controlled phase.

Production certification/population, permissions, native API behavior and deployment
remain unverified here. Local FULL PASS is not permission to execute this plan.

## Rollback strategy

If SQL prerequisite installation fails, stop before frontend release; retain the
existing v1 site. D0B6 itself adds no SQL. Each reviewed backend draft is transactional.
Use captured exact definitions/ACLs for any necessary function rollback; never
drop metadata or modify historical orders to roll back a UI.

After v2 clients have submitted, do NOT blindly restore a legacy-only frontend or
delete session keys: unresolved v2 requests could otherwise become duplicate v1
orders. Pause NEW ordering through the existing approved operational control,
retain v2 replay support and a recovery-capable frontend, resolve pending requests,
then perform a reviewed rollback. Preserve tracking and accepted-order data. Any
rollback bundle must retain frozen-v2 recovery and the timing-enabled admin baseline.

Ready for D0B7 production acceptance planning after local checks. No deployment,
live connection, commit or push was performed.
