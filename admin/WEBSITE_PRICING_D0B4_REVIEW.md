# D0B4 public authoritative merchandise preview

LOCAL ONLY. No live Supabase connection, production SQL, deployment, commit or
push. Current submit_public_order, frontend pricing, structured dine-in timing,
customer linking, tracking, POS and kitchen implementation are unchanged.
This preview is not yet integrated with website submission or checkout.

## Files and installation boundary

- WEBSITE_PRICING_D0B4_PREVIEW.sql: transactional draft, public wrapper and private
  customer projection/review fingerprint helper.
- tests/public-pricing-preview.cjs: functional, authority, security, hash and
  side-effect tests using the existing offline D0B3 fixture.
- tests/public-pricing-preview-preflight.cjs: prerequisite/collision/atomicity tests.
- tests/public-pricing-preview-native.cjs: new disposable loopback PostgreSQL
  cluster for read-only role checks, frozen vector parity and measured overhead.
- This review document.

Install only after reviewed D0A.1, D0B1, D0B2 and D0B3. The draft checks roles,
SHA-256 dependency, engine signature/security/volatility/search_path and private
access restrictions. Any overload of either new function name is a collision:
STOP for review. Reapplication deliberately fails rather than replacing a function.
No tables, indexes, policies, customer data or existing functions are changed.
The function creator owns the two functions; eventual deployment must use the
reviewed trusted migration owner with access to the engine's private dependencies.

## Public contract

`public.quote_public_cart(p_request jsonb) returns jsonb`

Only these envelope keys are accepted; customer/fulfillment/payment fields are
neither required nor accepted:

```json
{
  "pricing_contract_version": 2,
  "items": [{
    "product_id": "<UUID>",
    "product_size_id": "<UUID>",
    "option_choice_ids": ["<UUID>"],
    "quantity": 1,
    "item_note": null
  }]
}
```

The engine's exact item contract remains in force: allowlisted browser monetary
and display fields are ignored, unknown item fields fail, duplicate choices fail,
and required selections/defaults remain explicit. No business rules changed.

## Success response (illustrative UUID placeholders)

```json
{
  "ok": true,
  "quote": {
    "pricing_contract_version": 2,
    "pricing_policy_version": "curv-cart-v2.1",
    "pricing_fingerprint_version": 1,
    "currency": "PHP",
    "subtotal": "125.00",
    "items": [{
      "line_index": 0,
      "product_id": "<product UUID>",
      "product_size_id": "<size UUID>",
      "option_choice_ids": ["<choice UUID>"],
      "quantity": 1,
      "item_note": null,
      "product_name": "Example product",
      "category_name": "Example category",
      "size_label": "Regular",
      "base_price": "100.00",
      "option_total": "25.00",
      "unit_price": "125.00",
      "line_total": "125.00",
      "options": [{
        "group_id": "<group UUID>",
        "group_key": "milk",
        "group_name": "Milk",
        "choice_id": "<choice UUID>",
        "label": "Oat",
        "value": "oat",
        "effective_price_delta": "25.00"
      }]
    }],
    "review_fingerprint": "<64 lowercase hexadecimal characters>"
  }
}
```

All monetary values in the public projection, including individual option effects,
are fixed-two-decimal strings. Option arrays and item arrays preserve the engine's
canonical ordering. No costs, internal notes, certificates, raw requirements,
overrides or internal persistence snapshot object are exposed. Future engine
metadata additions do not automatically become public: projection is an allowlist.

The future UI can render this review using server fields, without catalog-price
lookups. It must escape every dynamic name, label and note. No frontend consumer
or checkout change was made here.

## Review fingerprint v1 (frozen contract)

`configuration_private.customer_pricing_review(p_pricing jsonb)` accepts ONLY a
trusted engine result. It returns the safe quote including review_fingerprint.
It is private, IMMUTABLE, SECURITY INVOKER, search_path=pg_catalog.

1. Project the exact customer quote fields shown above, without review_fingerprint.
2. Include pricing_fingerprint_version=1 in that projection.
3. Canonical bytes are PostgreSQL `jsonb::text`, converted explicitly to UTF-8.
   Object ordering/spacing and canonical array ordering are part of this v1 contract.
   This is not JavaScript JSON.stringify or RFC 8785; clients must not calculate it.
4. Prefix the bytes with exactly `CURV:PUBLIC_PRICING_REVIEW:v1:` (no newline).
5. Compute SHA-256 and lowercase hex encode.
6. Append review_fingerprint to the projected quote.

Included: contract/policy/fingerprint versions, currency, canonical identities,
quantities, normalized notes, server labels and readable option snapshots, all
displayed monetary values, subtotal and canonical line indices.
Excluded: timestamps, fingerprint itself and all unprojected internal metadata.
Changes to this projection/encoding require a reviewed fingerprint-version change.
Database upgrades must rerun frozen vectors before deployment.

Frozen synthetic vectors in tests/public-pricing-preview.cjs:

| Input | SHA-256 |
|---|---|
| Simple sushi, product 1000 / size 1100, quantity 1, no choices/note | `6fa69d168e1b6ce3612232793989604560eab4b8551b7fa614364069e0cf5abd` |
| Same product quantity 3, note No sauce, plus drink 1001 / size 1101 with 3000/3010 | `3e20735640e5b9c4f540c1980f328f931815ed87e881cf4c371300881301d525` |

Numbers above are the fixture UUID suffixes, not production IDs. Tests independently
hash the canonical database bytes with Node SHA-256 and compare frozen constants.
The first vector is also verified on native PostgreSQL 17.6.

This is distinct from D0B2's submission intent fingerprint. It is a deterministic
review comparison token, not authentication, a reservation, or proof of payment.

## Stateless behavior and D0B5 compatibility

Every call reads current certified catalog configuration under the engine's
statement snapshot. There is no quote ID, expiry, cache, quote table, order,
submission key, inventory reservation, customer update or payment operation.

Future D0B5, for a NEW submission after existing idempotency/replay handling:

1. Accept the customer's reviewed fingerprint alongside stable intent.
2. Reprice with price_order_configuration using current authoritative state.
3. Apply this SAME customer_pricing_review helper to that trusted result.
4. Compare its fingerprint to the supplied reviewed fingerprint.
5. Persist only when equal, with future submission validation/transaction rules.
6. Otherwise return PRICE_CHANGED with the freshly computed safe quote.

Existing successful idempotent replays must retain D0B2 semantics and must not be
invalidated by later catalog changes. D0B4 does not implement PRICE_CHANGED or
submission. Availability/lifecycle/concurrent changes require D0B5's own controls.

## Errors and security

Expected private SQLSTATE 22023 detail codes map to fixed public messages; neither
raw message, detail, SQLSTATE, context nor hidden UUID is returned. Unknown codes,
other exceptions and query cancellation caught inside the pricing block return
PRICING_UNAVAILABLE. Malformed JSON rejected before RPC entry and connection/API
failures remain transport concerns; the API must not expose diagnostic details.

| Code | Customer message |
|---|---|
| ORDER_CART_INVALID | Please review your cart and try again. |
| QUANTITY_INVALID | Please review the item quantities. |
| PRODUCT_UNAVAILABLE | One of the selected items is no longer available. |
| SIZE_INVALID | One of the selected sizes is no longer available. |
| OPTION_INVALID | One of the selected options is no longer available. |
| OPTION_REQUIRED | Please complete the required options. |
| OPTION_SELECTION_INVALID | Please review the selected options. |
| CONFIGURATION_INVALID | This item is temporarily unavailable. Please refresh the menu. |
| PRICING_UNAVAILABLE | Pricing is temporarily unavailable. Please try again. |

Error shape: `{"ok":false,"error":{"code":"...","message":"..."}}`.

The public wrapper is STABLE SECURITY DEFINER because public callers cannot read
private configuration or execute the engine. search_path is pinned to pg_catalog;
all non-catalog functions are qualified. There is no dynamic SQL or table write.
Execution is granted explicitly to anon and authenticated; PUBLIC is revoked.
Authenticated permits ordinary signed-in website customers, not only admins.
No private schema/table/engine grants are added. The private projection helper
also explicitly revokes PUBLIC/anon/authenticated execution.

Tests use actual SET ROLE, deny private reads/calls and an ungranted role, inspect
metadata/ACLs, and inject unexpected private exceptions inside rollback-only tests.
Native anon/authenticated calls succeed in READ ONLY transactions. Existing
orders/items/customer/payment fields/submission keys/sequence states remain equal
before and after success/error/role tests, with a legitimate existing website
order/customer fixture to avoid vacuous update checks.

## Bounds and operational limits

- Full serialized JSONB request envelope <=256 KiB (slightly stricter than engine
  item-array-only size limit).
- Engine limits remain: 1-30 raw lines, <=64 choices per line, <=500-character
  normalized note, positive integral quantities and exact monetary safety.
- No business 20/50 quantity policy is silently introduced.
- Merchandise subtotal only: no delivery/service/payment fees, tip, discount or
  misleading final total, and no fulfillment/customer dependency.
- No SQL rate-limit storage or caching.

No function-local statement_timeout is claimed as a per-call execution deadline:
statement timeout must be set before the top-level statement begins. Deployment
must review the actual PostgREST/role/session statement deadline and upstream
request-size/rate controls (including JSON parse cost before this function).
No lock_timeout is added: this read-only function takes normal read locks, which
can still wait behind DDL; the top-level deadline should bound that wait. Do not
change shared role timeout settings as part of this local draft.

## Performance

Native PostgreSQL 17.6, 20,000 unrelated fixture products plus pricing fixtures.
EXPLAIN ANALYZE of complete private engine calls vs complete public preview calls,
12 measured samples after 3 warmups, alternating order, 10 choices per line:

| Lines | Engine median | Public preview median | Added projection/hash/security/error handling |
|---:|---:|---:|---:|
| 1 | 1.939 ms | 2.554 ms | 0.615 ms |
| 10 | 4.205 ms | 6.310 ms | 2.105 ms |
| 30 | 8.873 ms | 13.779 ms | 4.906 ms |

Projection is materialized once for both response and hashing; measurement exposed
and removed duplicate projection work. Overhead is small in absolute milliseconds,
but about 32-55% relative to this fast engine on these option-heavy fixtures; it
is not free. Total maximum-fixture time was about 14 ms. No caching/index changes
were justified. These are local warm measurements, not production SLA guarantees.
Deployment must measure real catalog/network/load characteristics separately.

Evidence: task workspace curv-d0b4-qmZPY9/results.json. Native D0B2 concurrency:
curv-d0b2-l5btGj/results.json. D0B3 snapshot/index regression:
curv-d0b3-C3dqo2/results.json. All disposable servers were shut down.

## Local acceptance and next phase

New suites: preview 148 assertions, preflight 39, native preview 10.
Regression results are reported in the completion message. Three new CJS files
pass node --check; tracked and untracked whitespace checks pass.

No local blocker remains before separately authorized D0B5 implementation.
Production permissions/owner, prerequisite deployment, catalog certification,
upstream limits and rollout approval remain later gates. D0B5 should integrate
new submission repricing/review comparison while preserving D0B2 replay behavior.
No production or checkout activation is included in this phase.
