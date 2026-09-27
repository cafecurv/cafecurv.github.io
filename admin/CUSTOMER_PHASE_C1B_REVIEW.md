# C1B internal website customer records — review

## Scope and deployment

Draft SQL only. No live Supabase connection, customer UI, OTP, public lookup, backfill,
POS integration, tracking changes, or browser changes. Existing C1A edits are separate.

Apply as the existing submit_public_order function owner, in order:
1. Existing O10/O12 submission and O14 dine-in prerequisites.
2. CUSTOMER_PHASE_C1B_SCHEMA.sql.
3. CUSTOMER_PHASE_C1B_BACKEND.sql.
4. CUSTOMER_PHASE_C1B_VERIFY.sql (read-only metadata assertions).
5. CUSTOMER_PHASE_C1B_SMOKE_TEST.sql only in a disposable test environment.

The backend migration checks the installed function contract and its owner, then
inserts one call immediately before the unique successful new-order return. It aborts
transactionally if that anchor differs. It does not copy an old RPC implementation.
Replay branches remain unchanged, including replays of historical unlinked orders.
Reapplying schema/backend is supported. Reapplying older submission migrations later
can remove the hook: always rerun verification after subsequent RPC deployments.

## Data and access

customers is an unverified phone-based contact, not an account or proven identity.
No public/authenticated table privileges, policies, private-schema usage or helper
execution are granted. RLS is enabled. No admin customer UI/access is introduced.
Helpers use SECURITY INVOKER and a pg_catalog search_path; relations/functions are
schema-qualified. The existing SECURITY DEFINER submit RPC invokes them as its owner.
Existing order RLS and RPC EXECUTE grants are unchanged.

orders.customer_id is nullable and indexed with created_at for website history.
Old orders stay null; snapshots stay on orders. There are no mutable counters.
Foreign key deletion uses SET NULL: deleting a contact never deletes order history.
Table owner/service-role operational access remains privileged and outside anon tests.

Normalization accepts exactly 09 plus nine digits, 639 plus nine digits, or +639 plus
nine digits, with surrounding ASCII spaces trimmed. Canonical form is +639XXXXXXXXX.
It does not strip punctuation, embedded whitespace, extensions or arbitrary digits,
or verify number allocation/ownership. Unsupported nonblank phones still submit with
no customer linkage. Blank phones remain rejected by pre-existing order validation;
the normalizer itself returns null for blank/null. No validation is weakened.

Latest fields update only for a strictly newer order.created_at. Equal timestamps keep
the existing fields (first successful upsert wins); first/last timestamps use min/max.
Pickup/dine-in/null/blank/Returning customer never replace a saved delivery address.
Concurrent upserts serialize through UNIQUE(normalized_phone) and ON CONFLICT, then
both orders obtain the same ID. All maintenance is in the order transaction; a helper
failure rolls back the order/items/contact together. An already-linked order is a no-op.
A delayed older delivery does not fill/replace profile fields, even if the newest order
was pickup. This intentionally prioritizes protection from stale submissions.

## Verification and limitations

node tests/customer-records.cjs uses actual local PostgreSQL via PGlite, including
existing O12/O14 and tracking SQL and installed POS migrations. It compares the
submission function before/after, tests permissions, replay, rollback and POS exclusion.
PGlite cannot prove simultaneous independent transactions. Docker daemon was unavailable
and no native PostgreSQL server was available on PATH. Do not call sequential tests a
concurrency proof. The two-session acceptance below remains UNRUN.

No retained customer data has been verified against a live database. Before production
application, review actual ownership/ACLs and installed RPC definition. No broad grant,
security-definer customer lookup, policy replacement or backfill is appropriate here.
Shared/recycled/spoofed numbers can group unrelated orders; never grant identity access
on the basis of this contact link. A later phase can add explicit authorized admin
history reads and retention/deletion policy. OTP retrieval is a separate future feature.

## Genuine two-session acceptance (disposable PostgreSQL only)

Use two independent connections to the SAME disposable database with the migration
chain applied and Website Ordering enabled. Run as the privileged migration/test owner;
the test requests themselves switch locally to anon. Never run this sample on production.
Use a clean test database to avoid existing fixed keys. These transactions COMMIT rows;
dispose of the database afterward. No production cleanup/backfill is included.

Session A: run this batch, and while it sleeps, start session B.

```sql
begin;
set local role anon;
select public.submit_public_order('{
 "submission_key":"c1b00000-0000-4000-8000-000000000101",
 "customer_name":"C1B Concurrent A","customer_phone":"09220000002",
 "fulfillment_type":"pickup","payment_method":"gcash","subtotal":1,"total":1,
 "items":[{"product_name":"Test","quantity":1,"unit_price":1,"line_total":1}]
}'::jsonb);
select pg_sleep(20);
commit;
```

Session B (must start before A commits):

```sql
begin;
set local role anon;
select public.submit_public_order('{
 "submission_key":"c1b00000-0000-4000-8000-000000000102",
 "customer_name":"C1B Concurrent B","customer_phone":"+639220000002",
 "fulfillment_type":"pickup","payment_method":"gcash","subtotal":1,"total":1,
 "items":[{"product_name":"Test","quantity":1,"unit_price":1,"line_total":1}]
}'::jsonb);
commit;
```

B should wait on the same normalized-phone upsert until A commits, then succeed without
a unique-constraint exception. Both responses retain only order_number/tracking_token.
As privileged owner, verify:

```sql
select count(*) as customers -- expected 1
from public.customers where normalized_phone='+639220000002';
select count(*) as orders, count(distinct customer_id) as contacts,
       count(*) filter(where customer_id is null) as unlinked
from public.orders where public_submission_key in (
 'c1b00000-0000-4000-8000-000000000101',
 'c1b00000-0000-4000-8000-000000000102'
); -- expected 2, 1, 0
```

Also rerun B's exact payload: same result, no customer/timestamp changes. Repeat with
A rolled back instead of committed: B must still succeed and create the sole contact.
For simultaneous same-key requests, use identical payload/key in both sessions: only
one order, one contact, same response. These are genuine integration acceptance checks.
