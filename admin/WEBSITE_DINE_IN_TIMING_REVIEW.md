# Website dine-in preparation timing — local implementation

Draft only. No production execution authorized or performed.

## Deployment order for later approval
1. Capture the deployed submit_public_order(jsonb) definition, owner, SECURITY DEFINER configuration and ACL. Confirm reviewed O10/O12/O14/C1B prerequisites and no timing-column collision.
2. Run WEBSITE_DINE_IN_TIMING_SCHEMA.sql. The transaction checks collisions and incompatible existing pairs before adding constraints. No backfill. ALTER TABLE takes a short exclusive lock; use a quiet window and an approved lock timeout.
3. Coordinate WEBSITE_DINE_IN_TIMING_BACKEND.sql and the public menu release in a short ordering pause. Older cached dine-in clients lack the required timing selection and must refresh; do not default them silently. The new frontend must not run against the old backend, which would ignore structured timing.
4. Publish admin/admin.js and admin/incoming-orders.html only after schema succeeds. The admin SELECT now includes the two columns.
5. Verify ASAP, scheduled later today, blank phone, normal workflow, pickup/delivery and matching replay using separately approved production acceptance steps.

## Contract
Legacy/unaffected NULL/NULL remains valid. ASAP requires NULL timestamp; scheduled requires a timestamptz. Future/same-day checks belong in the submission RPC, not a time-dependent CHECK constraint. Scheduled timestamps require an explicit offset and must be later today in Asia/Manila. No operating-hours rules added.

New dine-in requires timing and keeps pickup_time NULL. Payment remains counter/unpaid. Phone may be blank; existing nonblank length validation is unchanged. Unsupported nonblank phones already pass guest ordering and do not link to customers. C1B itself is unchanged.

Matching stored replays precede timing validation, including historical dine-in requests without structured timing. The frontend retains the selected timestamp during an ambiguous retry; it never rolls an expired selection forward to the next day.

## Rollback
If backend deployment fails, its transaction leaves the old function intact; leave additive columns in place and do not release the frontend. If rollback is necessary after release, restore the captured exact function and matching frontend together during an ordering pause. Keep populated timing columns/snapshots; do not erase scheduled requests or drop columns as a shortcut. Review those requests operationally before rolling back display support.

## Verification scope
Local PGlite exercises real SQL and rollback/idempotency behavior, not genuine simultaneous transactions. Browser suites intercept network traffic. No production state or physical printing was tested.
