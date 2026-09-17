# CURV POS P1B — local review and printer acceptance

Implementation is local. No live Supabase access, deployment, physical printer
proof, commit or push has been performed. P1B is not operationally accepted until
the actual device/printer path below is tested. Payments and P1C work are absent.

## Patch order and scope

After the accepted P1A baseline, review/apply `POS_PHASE_P1B_SCHEMA.sql`, then
`POS_PHASE_P1B_BACKEND.sql`. Run `POS_PHASE_P1B_VERIFY.sql`. All diagnostic counts
and browser raw-table privileges must be zero/false; public RPCs are executable
only by authenticated users and internally authorize through P1A's actor resolver.
Private functions have no browser execute grants. Check both immutable triggers.
`POS_PHASE_P1B_SMOKE_TEST.sql` is a whole-file rollback test. It consumes shared
C-number sequence values despite rollback; it does not reset the sequence.

Only new kitchen tables receive new CHECK constraints. Existing orders/items are
not rewritten or given new constraints, so no historical-data pre-flight is
needed in P1B. P1A's pre-flight remains unchanged. P1B replaces only P1A's private
order projection to append kitchen status; reapplying the older P1A backend later
would remove that projection extension. Apply phase files in order.

## Persistent model

`pos_kitchen_submissions` stores order, sequential per-order ticket number,
source revision, durable command key, verified Auth/staff attribution and label,
submission time, customer/type/note header and complete desired kitchen state.
`pos_kitchen_instructions` stores immutable per-line ADD/CHANGE/CANCEL actions,
quantity, stable order-item UUID, source revision as item version, before/after
snapshots and prior instruction linkage. ORDER-scope CHANGE instructions record
header changes with zero preparation quantity. There is no sent boolean.

Both tables have RLS, no browser table grants and update/delete rejection
triggers. Normal access is through authorized security-definer RPCs. Tickets have
no monetary fields and never depend on today's catalog. Snapshot state is the
last committed submission, irrespective of print dialog outcome.

## Delta semantics

- No prior line: ADD its current quantity.
- Same preparation, higher quantity: ADD only the difference.
- Same preparation, lower quantity: CANCEL only the difference.
- Removed line: CANCEL its last submitted quantity and old preparation snapshot.
- Changed product/variant/options/item note: CHANGE the complete previous batch
  to the explicitly displayed replacement batch, including before/after quantities.
  If configuration and quantity change together this is one replacement, not an
  extra ADD on top. Price-only changes are irrelevant to kitchen state.
- Header changed after a prior ticket: an ORDER-scope CHANGE says “No extra
  preparation” and shows old/new customer/type/note. It can be the only instruction.
- A line added then removed before any send produces no kitchen instruction.
- Hold/resume changes no preparation state. Sending requires OPEN; resume first.

For changing only part of a multi-unit line, use **Split quantity**, then edit the
new line. `pos_split_item` atomically moves units to a new UUID while preserving
price/options and order total. At send, the old line gets CANCEL for the moved
units and the new line gets ADD with its edited preparation. This is deliberately
explicit cancel/replacement, not a claim those units have not already been made.
For sent multi-unit lines, all ordinary note/configuration edits affect the whole
line; the UI states this and directs partial changes to Split quantity.

## Commands and recovery

`pos_send_kitchen(p_key,p_order_id,p_revision)` and `pos_split_item(...)` share
P1A's durable command namespace and actor checks. Authorization precedes replay.
An identical request returns its original committed result; changed request or
actor under the same key returns `POS_KEY_CONFLICT`. The order lock serializes
commands, checks revision and OPEN state, then computes the server-side diff.
No pending instruction returns `POS_KITCHEN_NO_CHANGES`. Successful send inserts
submission/instructions and advances order revision once in the same transaction.
The returned order includes `kitchen_submission`; subsequent reads include
current kitchen markers and the last submission ID. Failed commands roll back.

P1A's browser recovery stores the key before sending and blocks further mutations
while uncertain. Reload + Check saved change replays the original ticket and
refreshes current order state. Do not clear site storage during an uncertain send.
`pos_get_kitchen_ticket(p_submission_id)` is a read-only reprint projection. Reprint
does not advance revisions or create tickets/instructions/commands. The UI offers
the latest ticket; the authorized RPC also supports a known older ticket UUID.

## Renderer and print transport

`pos-kitchen.js` accepts only an immutable submission snapshot and returns escaped
HTML. It reuses the existing website renderer's 58mm page / 3mm margins / 52mm
content approach, monochrome type, Manila time and text escaping. CHANGE/CANCEL
use bold words/borders, not color. Long names/notes wrap. No selling prices,
subtotal, payment method, discounts, invoice or pre-bill appear.

A blank print window is reserved during the button gesture, then filled only
after persistence succeeds. Failed/uncertain requests close that window. Blocked
pop-ups do not roll back a saved send: allow pop-ups and Reprint Last Ticket.
The printable view has a Print button and remains available after cancellation.
No print-success status exists. Print-attempt logging is deferred: browser output
cannot establish physical success, and no business state depends on paper.

Boundary: immutable submission -> renderer -> browser `window.print()` transport.
The existing website renderer and Incoming Orders implementation are unchanged.

## Offline validation

Run from the repository with installed dependencies. Browser tests use
`CURV_PLAYWRIGHT_MODULE` and optional `CURV_BROWSER_CHANNEL` (default `msedge`).

    node tests/pos-kitchen-database.cjs
    node tests/pos-kitchen-browser.cjs
    node tests/pos-schema-preflight.cjs
    node tests/pos-database.cjs
    node tests/pos-core.cjs
    node tests/pos-browser.cjs
    node tests/public-menu-renderers.cjs
    node tests/public-menu-item-panels.cjs
    node tests/public-menu-geometry.cjs

PGlite uses one serialized connection. Stale/no-op/replay tests are local contract
checks, not proof of real simultaneous transactions. Browser tests intercept all
network access and stub physical printing. Screenshots in ignored
`node_modules/.pos-printer-proof` prove layout only, not hardware compatibility.

## Manual acceptance after approved deployment

1. On an approved test order, add 2 units of one product and 1 of another. Confirm
   NEW markers and pending count. Send: ticket #1 has ADD 2 and ADD 1, source
   revision is correct, order advances once and shows ALL ITEMS SENT.
2. Add one new product. Send: ticket #2 is KITCHEN UPDATE with only the new ADD.
3. Increase a sent quantity from 2 to 3. Send: ADD 1 only.
4. Decrease from 3 to 1. Send: CANCEL 2 only. Remove the remaining line and send:
   CANCEL 1 with the old preparation. Ticket #1 remains unchanged.
5. Change a sent line's note/modifier. Send: CHANGE shows the previous and replacement
   preparation. Change quantity and modifier together and verify both quantities.
6. For a sent line of 3, split 1, edit the new line and send: CANCEL 1 original plus
   ADD 1 replacement. The remaining 2 stay unchanged and the split itself does not
   change the bill total. Review preparation with the kitchen before physical use.
7. Change only order note/customer/type. Send: order-details CHANGE explicitly says
   no extra preparation. Confirm the new whole-order note prints separately.
8. Hold an order with pending updates. Send is disabled. Resume and send once.
9. Reprint the last ticket twice; cancel/close a print dialog. Check ticket count,
   instruction count, order revision and old snapshot are unchanged.
10. Lose a send response after commit. Reload, restore connectivity and Check saved
    change. The same ticket number/ID returns; no duplicate preparation is submitted.
11. Use two independent authenticated sessions against the actual approved
    Supabase deployment. Open the same POS order/revision with pending updates.
    A sends successfully; B sends from its stale revision and must receive
    `POS_REVISION_CONFLICT`, with no duplicate ticket/items and no overwrite.
    Refresh B: no pending updates remain. Repeat with simultaneous distinct keys;
    only one submission may commit for that pending state. This is live acceptance,
    not established by PGlite. Also test same-key uncertain retry on the deployment.
12. Verify inactive mappings/staff cannot send/read tickets and a website order UUID
    is rejected. Website submit/track/cancel/Incoming Orders print must still work.

## Actual 58mm device proof — required and NOT yet performed

Use the exact CURV iPhone/iPad, its normal browser, and actual VOZY/POS53D-style
58mm printer. Record device, OS/browser, printer model, connection/transport,
paper/driver settings, test date and operator; do not assume AirPrint support.

1. Open a real test POS order on that device after approved SQL/UI deployment.
2. Use multiple quantities, a very long product name, long modifier text, item
   note and order note. Send the first submission and verify the print view opens.
3. In the native print dialog, check whether the exact printer is discoverable.
   If supported, choose its 58mm paper/profile and print. Check physical width,
   clipping, wrapping, font readability, cutter/feed and absence of prices/peso signs.
4. Print add-on, quantity decrease/cancel, and modifier CHANGE tickets. Confirm
   the kitchen can unambiguously distinguish preparation from cancellation/replacement.
5. Reprint a saved ticket, cancel a dialog, then reprint again. Confirm the same
   submission number and data; no duplicate kitchen history/revision increment.
6. If feasible, test printer unavailable/paper-out. Restore the printer and reprint
   the existing ticket. Never press Send again to recover a physical output failure.
7. Record actual output/pass/failure for each case and retain a photo of the paper.

If printing fails, record whether failure is popup, native dialog, printer
discovery, unsupported transport, paper geometry or physical output. The fallback
is a separate transport adapter (e.g. an approved local/vendor print bridge for
that exact printer), consuming the same immutable snapshot/renderer. Select it
only after device evidence. Do not redesign kitchen history or claim printer proof
from an HTML preview. Hardware acceptance remains open until this record exists.

Next recommended work: close actual printer/transport acceptance first. Any
payment or customer pre-bill phase needs its own approved scope afterward.
