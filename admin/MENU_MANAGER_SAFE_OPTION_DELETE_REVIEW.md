# Option Library safe deletion — local draft review

No database was contacted and MENU_MANAGER_SAFE_OPTION_DELETE.sql was not executed,
including against a local database. Static and mocked-browser checks are not database
execution or concurrency acceptance. Do not deploy the frontend delete controls until
the separately reviewed RPC migration is installed and verified.

## Local dependency findings

OPTION_GROUPS_PHASE_A_SCHEMA.sql defines CASCADE foreign keys:
- option_choices.option_group_id -> option_groups.id
- product_option_groups.option_group_id -> option_groups.id
- product_option_defaults.option_group_id -> option_groups.id
- product_option_defaults.option_choice_id -> option_choices.id
- defaults (option_choice_id,option_group_id) -> choices (id,option_group_id)
- defaults (product_id,option_group_id) -> assignments (product_id,option_group_id)

D0A.1 override, compatibility and requirement tables reference option_choices.id
with default NO ACTION (not SET NULL, and not cascading). Their product/size FKs
remain unchanged. Owner API roles cannot directly inspect all private pricing data.
D0B1 certificates reference products by FK, but store full groups/choices/configuration
as JSON expected_structure; they have no live group/choice FK. Historical order_items
store readable options and independent structured pricing snapshots, with no FK to
live option groups/choices. Historical JSON is preserved and is NOT a delete blocker.
No safe group/choice delete RPC existed. The product-delete RPC is not reused: its
intentional cascading behavior would be inappropriate for reusable options.

## New draft RPCs

public.menu_manager_delete_option_group(p_group_id uuid)
public.menu_manager_delete_option_choice(p_choice_id uuid)

Both use the existing auth.uid()/is_admin() owner pattern, SECURITY DEFINER, pinned
pg_catalog search_path, PUBLIC/anon revocation and authenticated EXECUTE (owner checked
inside). Migration must run as existing trusted is_admin owner; no role/email/user
is hardcoded. It is transactional, checks required objects/types, and refuses any
existing same-name overload. Do not automatically reapply or drop collisions.

Both lock all eight option/configuration/certification tables in the same SHARE ROW
EXCLUSIVE order before inspecting data. This blocks concurrent configuration writes,
including certification writes not backed by FKs, through deletion/transaction end.
Ordinary SELECT remains possible. Require READ COMMITTED so reads after lock acquisition
see completed writers. Lock acquisition is bounded to 2 seconds; contention/deadlocks
return RETRY_REQUIRED and no deletion. Keep API transactions short. These broad
configuration locks are a deliberate conservative tradeoff for infrequent deletion;
review operational impact before deployment. No pricing/certification semantics change.

Group blockers, including inactive rows: any choices; any product assignments; any
defaults; any UUID occurrence in certificate expected_structure. Existing choices
already prevent loss of their indirect overrides/compatibility/requirements.
Choice blockers, including inactive rows: defaults, overrides, compatibility,
requirements, ANY assignment of its containing group, and certificate JSON references.
This protects options that customers can select even without an explicit default.

Both reject unexpected option-targeting FK names/schemas and user DELETE triggers for
manual review, and catch FK violations. Before production, compare exact FK definitions
(not names alone) against this inventory; a known constraint redefined with different
columns is prerequisite drift and must not be accepted. Privileged concurrent DDL is
outside ordinary CRUD acceptance. There is exactly one target-row DELETE per RPC,
no child deletes, no certificate mutation, no deactivation prerequisite. Active but
unused accidental entries are eligible. No order/history data is touched.

Return: {ok:true,deleted_id} or {ok:false,code,reasons?}. Known blocks use IN_USE plus
stable reason codes. Missing targets, permission failure, contention and unexpected
errors are distinct safe codes. UI uses a fixed concise message map; raw SQL errors
are not shown. Unknown/missing RPC fails closed. Confirmation cancellation sends no
request. Busy controls and auth-generation checks protect asynchronous completion.

## Required later approval and acceptance

1. Review full migration, current production is_admin ownership/security, all FK
   definitions, triggers, table permissions and D0A.1/B1 prerequisite types. Stop on drift.
2. With separate permission, execute the draft ONLY in a disposable PostgreSQL database
   first. Exercise unused active/inactive groups/choices, each dependency separately,
   certifications containing otherwise removed group/choice IDs, historical snapshots,
   anonymous/non-owner/owner calls, unknown FK/delete trigger, missing target and errors.
3. Use truly independent transactions to race deletion against choice/assignment/default/
   pricing-reference INSERT and certification INSERT/UPDATE. Existing dependencies block;
   a concurrent writer waits and then sees normal FK enforcement/current configuration.
   Confirm no cascade loss or stale certification acceptance. Also test lock timeout,
   repeatable-read rejection, rollback, and preservation of original child/history rows.
4. Static checks and mocked tests here do NOT establish those execution guarantees.
5. Only after approval, manually install once in a quiet configuration-editing window;
   verify function owner/search_path/ACL/is_admin enforcement. Never paste fixture IDs
   into production. Then release the matching frontend. No steps performed here.
6. Rollback before use: remove UI access or retain inactive new RPCs pending review.
   After actual permanent deletion there is no automatic undo: recovery requires a
   separately reviewed backup restore. Never promise deactivation-style reversibility.
