# CURV POS P1A — owner review and acceptance

Status: local implementation and SQL drafts; no live Supabase execution.

## Apply order and prerequisites

Review `POS_PHASE_P1A_SCHEMA.sql`, then `POS_PHASE_P1A_BACKEND.sql`. These assume
the existing Menu/Options/Category Sections/Archive/Sold Out columns, Incoming
Orders through O14, and Timekeeping staff foundation. They do not reconstruct
the entire database. Check deployed definitions before applying either file.
Never include `LOCAL_DEV_TEST_BOOTSTRAP_ADMIN_HELPERS.sql` in this deployment.

The schema starts with a read-only pre-flight for all four new/replaced CHECK
constraints, before any schema changes. It takes exclusive locks on orders/items
until transaction end so writes cannot race the validation. Incompatible rows
abort with SQLSTATE `P0001` and a stable detail code:
`POS_PREFLIGHT_ORDER_STATUS`, `POS_PREFLIGHT_ORDER_BOUNDARY`,
`POS_PREFLIGHT_ORDER_DELIVERY`, or `POS_PREFLIGHT_ITEM_PRICE`. The message names
the constraint and affected row count. No historical rows are normalized or
repaired. If execution stops on this error, roll back the failed transaction
before investigating the existing data; do not bypass the gate.

The schema keeps `orders` and `order_items`, uses source `pos`, lowercase states
`open` / `held`, and the existing shared `C-...` sequence. Website rows retain
their existing status vocabulary. Dine-In maps to `dine_in`, Takeout to `pickup`,
and Delivery to `delivery`. Counter delivery is an order-type label in P1A:
there is no address, rider, delivery-fee or delivery-dispatch workflow here.

POS rows have NULL tracking tokens; website rows still require tokens. New
restrictive policies exclude POS rows from existing browser table queries and
writes, including owners' legacy paid/unpaid and fulfillment controls. Definer
POS RPCs validate access and use explicit safe read projections. Public website
RPCs and rendering code are unchanged. Website rows never receive POS revisions.

## Access provisioning

Owners sign in with their existing Supabase Auth account; the backend verifies
an actual owner row in `admin_profiles`. It does not rely on browser roles,
session presence alone, or the permissive local helper.

For each cashier, the owner must create a normal individual Supabase Auth user
and, through a trusted administrative database operation, add one
`pos_staff_access` row linking that Auth UUID to an existing active `staff.id`.
Set `created_by` to the owner Auth UUID. Do not add cashiers to `admin_profiles`.
There is no self-enrollment, browser access to this mapping, or new employee
directory. Deactivating either mapping or staff denies the next RPC, including
replay. An owner acting in POS is attributed to Auth UUID with no invented staff
identity. Cashier commands record both verified Auth UUID and staff UUID.

This phase uses individual Auth login, not staff PIN unlock. A future verified
staff session can be integrated at the private actor resolver. No command accepts
an employee UUID as authority. All authorized P1A cashiers can retrieve/edit all
counter open orders; this is intentionally one café, not a multitenant model.

The focused page does not load `admin.js` or owner navigation. Its Auth storage
key is `curv-pos-auth`, isolated from existing admin login storage. Owners may
therefore need to sign in separately in POS. The Control link is shown only after
server owner verification. Existing non-POS admin guards are not broadened.

## Product shaping and price snapshots

No duplicate catalog and no legacy product-name renderer is used. Active
categories and available, non-archived products are returned regardless of
publishing status; sold-out products are visible but cannot be added. RPCs check
sellability again. Public-safe projection excludes cost, private product notes,
PIN hashes, and staff directories.

The UI shapes variants plus configured single/multi option groups, required/min/
max selections, choices, defaults, and price deltas. Backend accepts IDs only and
resolves authoritative labels/prices. Amounts must be finite, nonnegative and
representable in centavos. One selected choice contributes its price delta once
per item unit. Default selections are explicit choices, not hidden free pricing.

Retained legacy compatibility pricing rules: **none**. In particular, the public
menu's Espresso Large-price-to-HOT-12oz alias and its hardcoded specialized add-ons
are not silently synthesized. If those choices are needed at the counter, the
owner must configure actual variants/options before acceptance. Temperature can
be a DB option; P1A does not model conditional size/temperature combinations.
Use explicit sellable variants where price/size depends on temperature. Review
each relevant café product before using this page operationally.

Ordinary quantity/note edits retain saved base price, option snapshot and unit
price. Quantity increases still require a currently sellable product/size.
“Change configuration” is explicit and uses current catalog pricing. Removal is
soft removal; removing the final item leaves an empty permanent open order. Void
and financial completion are not in this phase.

## Command and recovery contract

Public entry points: `pos_get_access`, `pos_get_catalog`, `pos_get_order`,
`pos_list_open_orders`, `pos_create_order`, `pos_add_item`, `pos_update_item`,
`pos_configure_item`, `pos_remove_item`, `pos_update_header`, `pos_hold_order`,
`pos_resume_order`.

Mutations authorize, claim a command key, compare its fingerprint on replay,
lock the parent, check expected revision/state, mutate narrowly, advance revision
once, and store the result in the same transaction. A retry returns the committed
result even when its expected revision is now old. The UI then refetches current
state before further editing. Changing payload/actor under a key is rejected.
The private command helper is not an exposed whole-order-save endpoint.

Keys, draft inputs and selected order ID are persisted per Auth user before a
request. An uncertain response blocks further mutations until the same command
is checked again. The page restores this state after refresh. Browser storage
must work before a new command can be sent. Signing out hides the previous user's
state; resuming that account restores its own pending request. Customer drafts
are stored locally on this trusted counter browser; clear site data only after
resolving pending commands. Clearing it while a command is uncertain destroys
the browser's recovery handle. Server command records have no automatic TTL.

Command records also retain actor, operation, target, timestamp and result as a
minimal operation history; this is not a general event-sourcing framework.

## Local validation

Install the declared dev dependencies, then run from the repository:

    node --check admin/pos.js
    node tests/pos-database.cjs
    node tests/pos-schema-preflight.cjs
    node tests/pos-core.cjs
    node tests/pos-browser.cjs
    node tests/public-menu-renderers.cjs
    node tests/public-menu-item-panels.cjs
    node tests/public-menu-geometry.cjs

Browser tests use existing Playwright conventions: `CURV_PLAYWRIGHT_MODULE` may
point to an installed Playwright module and `CURV_BROWSER_CHANNEL` defaults to
`msedge`. Database tests execute actual drafts in in-memory PGlite with pgcrypto,
the real owner helper and existing website RPCs. Fixtures do not connect to
Supabase. Browser POS tests call that embedded database via an intercepted bridge
and intentionally lose committed responses.

PGlite is a single-connection PostgreSQL runtime; these tests exercise stale
revision and replay behavior but do not prove simultaneous transactions under
Supabase/PostgREST. A real two-session test remains part of deployment acceptance.
Two independent authenticated sessions against the actual approved Supabase
deployment must open the same POS order at the same revision. Session A commits
a mutation. Session B then attempts a conflicting mutation from its stale
revision. B must receive `POS_REVISION_CONFLICT`; no overwrite or duplicate
item/order may occur, and the current server order must refresh cleanly. This
remains a live acceptance condition, not a local-test requirement or a claim
that PGlite proves simultaneous transactions. Do not run it before deployment
approval.
The verify file is read-only. The smoke file rolls back fixtures but, like any
PostgreSQL rollback, cannot undo sequence consumption. It leaves C-number gaps.

## Manual acceptance after approved SQL

1. Apply reviewed schema then backend to the approved environment; run VERIFY.
   Expect no unfinished commands, tracking-token violations, or total mismatches.
   Anonymous execute must be false; private functions must not be executable by
   authenticated users; only public POS endpoints should be callable by them.
2. Provision a test cashier mapping. Sign in at `/admin/pos.html`. Confirm its
   name appears and no owner navigation is present. Test owner access separately.
3. Try an unmapped Auth user and a deactivated staff/mapping: POS must reject both.
   Confirm those accounts cannot read owner-only catalog costs, Team or Inventory.
4. Check unpublished/available products, sold-out products, unavailable products,
   actual sizes and required/default modifiers. Review temperature configuration.
5. New Order must allocate nothing. Add an item: get one C-number, correct option
   price, quantity and notes. Refresh: reopen the same order. Add a second line.
6. Edit quantity/note, then change a catalog price elsewhere: saved line prices
   stay fixed. Explicit configuration change adopts current pricing. Remove a line.
7. Edit customer/type/note; hold; open another order; use Open Orders to return and
   resume. Confirm only POS open/held orders appear and dates/totals are correct.
8. In two browser sessions load the same revision. Save in A then B: B must reject
   the stale write, refresh current state, and preserve its attempted inputs.
9. Simulate lost response after commit. Refresh and Check saved change: one order
   or one added line only. Do not clear site data while testing uncertain writes.
10. Confirm public website dine-in/pickup/delivery submission, tracking and
    cancellation still work, and Incoming Orders still prints website tickets.
    POS rows must not appear there or be writable by its old paid/status actions.

No payments, sales, refunds, discounts, register, inventory deductions, kitchen
submission, printing, or official invoices are implemented in this phase.
