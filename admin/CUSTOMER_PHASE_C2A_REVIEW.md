# C2A secure customer reads

Draft migration; no frontend, deployment, or changes to C1A/C1B/POS/tracking.

## Contracts

All functions return JSONB, are STABLE SECURITY DEFINER with search_path=pg_catalog,
and authorize auth.uid() plus public.is_admin() before validating inputs or reading data.
Only authenticated has API EXECUTE; that grant is not owner authorization by itself.
Existing public.is_admin() is the owner allowlist, not a staff role check.
No customer table grants, policies, private helper grants, or mutable counters are added.
Use a trusted migration owner able to read orders/customers and invoke the private
normalizer. Never install these functions under an untrusted application role.

- customer_admin_list(p_search text='', p_filter text='all', p_sort text='recent',
  p_limit integer=25, p_offset integer=0): customers[], limit, offset, total_count,
  has_more. Each customer has customer_id, latest_name, normalized_phone,
  latest_delivery_address, first_order_at, last_order_at, created_at,
  submitted_order_count, completed_order_count, repeat_customer.
- customer_admin_detail(p_customer_id uuid, p_limit integer=20, p_offset integer=0):
  customer (same summary), orders[], limit, offset, total_count, has_more.
  Orders expose only order_id, order_number, created_at, status, fulfillment_type,
  payment_method, payment_status, total, customer_name, customer_phone, delivery_address.
- customer_admin_order_items(p_customer_id uuid, p_order_id uuid): items[] containing
  only product_name, category_name, variant_label, quantity, unit_price, line_total,
  options, item_note, sort_order. Customer/order association and website source are
  mandatory. Sort by saved sort_order then item ID; item IDs are not returned.

Errors: 42501/CUSTOMER_FORBIDDEN; 22023/CUSTOMER_INPUT_INVALID;
P0002/CUSTOMER_NOT_FOUND; P0002/CUSTOMER_ORDER_NOT_FOUND. Anon ordinarily receives
PostgreSQL EXECUTE permission denial before entering the function. Missing and
mismatched orders share the same response. No data or input echo in custom errors.

## Search and pagination

Search maximum 200 characters (before trimming); null/blank means all. Case-insensitive
literal substring matching for name/address, literal phone matching. Complete supported
09..., 639..., +639... searches normalize through the unchanged C1B private helper.
No punctuation-stripping or verification claim. strpos avoids LIKE wildcard semantics;
percent, underscore, quotes and backslashes remain literal. No user-driven dynamic SQL.

Filter allowlist: all, repeat (>=2 submitted), one_time (=1).
Sort allowlist: recent=last_order_at DESC; most_orders=submitted count DESC;
newest=created_at DESC; oldest=created_at ASC; all tie on customer_id ASC.
History sorts created_at DESC, order_id ASC.
Limit must be 1..50; offset must be 0..100000; null and out-of-range values reject.
Totals count the entire filtered set, not the page. Offset pagination is stable for
unchanged data, not a frozen snapshot across requests: concurrent inserts/updates can
shift pages. Refresh restarts pagination. Beyond the offset cap, narrow the search;
consider keyset pagination later if measured scale requires it.

## Statistics and privacy

Every history/statistic query joins by customer_id and requires source='website'.
Counts use order headers without an item join. Submitted includes all current statuses,
including cancelled; completed means status='completed'; repeat means submitted>=2.
Zero-order stored customers remain visible in all, not one_time/repeat.
No phone-based reconstruction or historical backfill. Stored first/last timestamps keep
C1B semantics (not recalculated after hypothetical order deletion).
Saved order/item snapshots are returned unchanged; no catalog read. No token,
submission key/fingerprint, customer email, admin note, or helper data is projected.
No spend metrics, notes, edits, deletion, export, browser credentials, or public reads.
Contacts remain unverified phone groupings. History is linked website history only.

## Deployment and verification

1. Confirm the reviewed C1B schema/backend and genuine owner allowlist are installed;
   customers RLS/direct access restrictions, customer_private.normalize_phone(text),
   and orders_customer_history_idx must match C1B. Inspect RPC name collisions before
   initial deployment; unexpected pre-existing definitions/owners require review.
2. Manually apply CUSTOMER_PHASE_C2A_BACKEND.sql as a trusted migration owner.
   Transaction contains function DDL and EXECUTE grants only; no table alteration,
   index build, data migration, or existing RPC replacement.
3. Run CUSTOMER_PHASE_C2A_VERIFY.sql. All gates must PASS; review definitions/owner.
4. Optionally run CUSTOMER_PHASE_C2A_SMOKE_TEST.sql in SQL Editor. It uses an existing
   owner's ID with SET LOCAL ROLE in a read-only transaction and ends in ROLLBACK.
   Also verify real owner/non-owner/anon API sessions before frontend release.
5. If needed, withdraw EXECUTE on these three new functions; C1B submission and existing
   pages do not depend on them. Do not remove customer data or C1B objects.

No live execution was performed. Production scale/plans remain unmeasured. Existing
history index supports per-customer reads; global count sorting and substring search
can still scan substantial data. No speculative index or realtime subscription added.

## Local acceptance

Run node tests/customer-admin.cjs plus existing customer and POS/public-order suites.
Tests execute actual SQL against isolated PGlite with the real owner helper and local
Auth shim, including unauthorized roles, exact projections, snapshot immutability,
literal search, filters/sorts/ties/pagination, migration reapplication and unchanged
public RPC definitions/responses. This read API introduces no new write/concurrency
path and does not replace C1B's genuine two-session concurrency acceptance.

Local result (2026-09-28): FULL PASS. Commands and assertion counts:

| Command | Passed |
| --- | ---: |
| node tests/customer-admin.cjs | 116 |
| node tests/customer-records.cjs | 73 |
| node tests/public-customer-details.cjs | 41 |
| node tests/pos-schema-preflight.cjs | 11 |
| node tests/pos-database.cjs | 51 |
| node tests/pos-core.cjs | 11 |
| node tests/pos-browser.cjs | 13 |
| node tests/pos-kitchen-database.cjs | 45 |
| node tests/pos-kitchen-browser.cjs | 28 |
| node tests/pos-customer-print.cjs | 29 |
| node tests/pos-customer-print-browser.cjs | 20 |
| node tests/public-menu-renderers.cjs | 813 |
| node tests/public-menu-item-panels.cjs | 45 |
| node tests/public-menu-geometry.cjs | 3450 |
| node tests/public-menu-options-hydration.cjs | 47 |

node --check tests/customer-admin.cjs and git diff --check passed. New untracked
files were additionally checked with git diff --no-index --check against NUL.
Browser suites initially lacked module resolution for Playwright; successful runs
used NODE_PATH pointing to the existing bundled Node packages and installed Edge.
No packages or application dependencies were changed; browser requests were intercepted.
