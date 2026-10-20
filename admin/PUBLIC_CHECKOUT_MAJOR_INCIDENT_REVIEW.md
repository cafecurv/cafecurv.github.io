# Public checkout major incident audit — 2026-10-20 (Asia/Manila)

Delivery preflight is paused. No deployment, production SQL, order submission, commit or push was performed.

## Findings and evidence

The customer-wide root cause is NOT YET PROVEN. The exact unavailable condition is a missing controller, a release mismatch, or missing submit method in getCompatibleCheckout(). The live HTML reports this at line 10148; local repaired code is at submitPublicOrder()/showCheckoutUnavailable(). This happens BEFORE a checkout RPC and cannot itself be caused by product certification.

Read-only GETs of https://cafecurv.github.io/menu/ and its authoritative-checkout.js?v=2026-10-18.1 returned HTTP 200. Both declare 2026-10-18.1. Both bodies equal committed HEAD after newline/outer-whitespace normalization. Both responses advertise Cache-Control: max-age=600. Local working files also contain undeployed delivery code; they are not the deployed assets.

No service-worker registration was found in the repository. This does not inspect previously installed workers or caches on affected devices. Browser storage holds customer preferences and submission recovery, not executable checkout code. Blocked/corrupt session storage can block submission with the previous-order safety message while the controller still registers.

The code supports version-skew failure: an old page refuses a new controller, and the unversioned physical filename can serve newer bytes even under an older query parameter. Current matching responses do not prove historical/customer cache contents. The fixed recovery=1 URL was reusable across visits; caching is a supported risk, NOT a confirmed customer incident cause. There is no evidence attributing this to Facebook/Messenger or Safari specifically.

## Proven/reproduced weaknesses and local fix

- Submit during delayed initialization previously reported permanent unavailability. It now shows a waiting message and cannot send. Submit remains disabled until a compatible controller exists.
- Two load failures previously ended with refresh-only instructions. Recovery remains bounded at two total script requests; exhaustion now includes a safe Messenger contact link and a warning to check any earlier submission before resending.
- Recovery now uses the intentional release 2026-10-20.1 plus a one-attempt cache-busting query. No unbounded retry, automatic submission, storage clearing or cart clearing.
- Explicit active/reviewing/accepted/submitting guards precede stale-controller retirement, including old disposer implementations. Unknown unsafe controllers remain blocked. Exact pending requests survive idle replacement.
- Diagnostics include stage, releases, bootstrap/recovery state, generic Android/iOS/other category and timestamp. No raw user agent, customer fields, cart contents, payment details, keys or raw exceptions are logged.

The release is deliberately bumped in both page and asset. Old cached HTML may still fail closed after a release; assistance/reload is required in that case. This patch cannot repair unsupported JavaScript syntax in an already cached old page or guarantee access through a network that blocks scripts.

## Failure-path inventory

| Stage | Condition / customer-visible result | Retry semantics |
|---|---|---|
| Before RPC | Missing/mismatched controller; original “Checkout is unavailable. Please refresh and try again.” | One bounded reload while idle, then assistance; never automatic submit |
| Before RPC | Load error, script timeout (15 s), initialization exception, no registration | Same bounded recovery; second failure blocked |
| Before RPC | Active stale controller | Preserve controller/request; no replacement or new send |
| Before RPC | Empty cart, missing name/contact/method/payment/address, missing/invalid preparation time | Field-specific validation; fix inputs before explicit review |
| Before RPC | Malformed item identity/quantity/options or payload construction failure | “Please review your cart and try again.” No send |
| Before RPC | Ordering status unknown/paused/technical unavailable | Checking/paused/copy-order states; no bypass |
| Before RPC | Corrupt/denied recovery storage or unresolved older key | “A previous order needs to be checked…” Contact staff; no new key |
| During quote | Missing Supabase client, offline/network, 30 s timeout | “Unable to check current prices. Please retry.” Retry quote; no order sent |
| After quote | RPC error, malformed quote, invalid totals/fingerprint/items | Same generic pricing message unless mapped error; no confirmation/send |
| After quote | Known backend errors | Cart/quantity/product/size/options/configuration/client-update/ordering/dine-time messages; fail closed |
| Review | Customer cancels or edits while quoting/reviewing | No send; invalidated review must be confirmed again |
| Before send | Cannot persist frozen request | Submission blocked; retain/check recovery; no unsafe alternate send |
| During submit | Network/timeout/RPC error | “Your order could not be confirmed. Recover the previous order…” Frozen same key retained |
| After submit | Missing/malformed success, unknown error, retry-required response | Treat as uncertain; same frozen request/key only |
| After submit | PRICE_CHANGED | “Some item details or prices changed…” Explicit re-review, no silent acceptance |
| After submit | Known validation/business error | Mapped human message; retained validation state; correct/review explicitly |
| After submit | ORDER_SUBMISSION_KEY_CONFLICT | “This request belongs to a different order…” Staff/tracking resolution, no new order |
| After acceptance | Success-modal/storage/remember-details rendering failure | Accepted state locks; fallback “Your order was received…” Never retry as new order |
| Retry | Duplicate clicks or uncertain replay | Busy guard prevents parallel send; replay uses identical submission key/payload |

The authoritative controller messages map ORDER_CART_INVALID, QUANTITY_INVALID, PRODUCT_UNAVAILABLE, SIZE_INVALID, OPTION_INVALID, OPTION_REQUIRED, OPTION_SELECTION_INVALID, CONFIGURATION_INVALID, CLIENT_UPDATE_REQUIRED, CURV_ORDERING_CLOSED and dine-in timing errors. Delivery-only local messages remain outside this incident patch/deployment.

## Browser compatibility limits

Actual tests run in Chromium/Edge with intercepted requests. They exercise denied storage, missing optional ordering-message global, missing crypto.randomUUID/requestIdleCallback/ResizeObserver, and delayed/duplicate execution. Existing optional ordering-message default is already safe. Supabase unavailable is a runtime quote error, not controller initialization failure. crypto.getRandomValues is the secure key-generation fallback; do not replace it with insecure randomness.

The page/controller use optional chaining, nullish coalescing, async functions, URL/URLSearchParams and modern DOM APIs. Old engines unable to parse the page need a supported external browser; no evidence establishes which customer engines are affected. Real iOS Safari, older WebView and Facebook/Messenger device tests have NOT been executed. Third-party Supabase CDN loading remains a separate potential failure: it causes pricing/availability errors, not this missing-controller branch.

## Backend read-only observation

GET /rest/v1/ OpenAPI returned 401; no metadata/ACL conclusion can be drawn from it. POST to the locally reviewed STABLE quote_public_cart with an empty cart returned HTTP 200, ok:false, ORDER_CART_INVALID. This proves current public quote routing/execution, not pricing readiness for every cart. No submit_public_order_v2 invocation was made because that is a mutating RPC. Production submission definition/grants/recent compatibility are therefore not freshly verified. Selective product/default/price drift remains possible for pricing errors, but cannot explain missing controller before RPC.

## Verification

- public-checkout-assets.cjs: 104 assertions (load/release mismatch, pre-registered stale controller, legacy controller, init failures, delay, optional APIs/storage denial, duplicate script, active controller preservation, fallback, pending/cart survival).
- public-submit-resilience.cjs: 139 assertions (normal delivery/pickup/payment/remember/options cases, success-UI failures, transport failure, malformed response, timeout, RPC error, offline quote, same-key replay).
- public-menu-renderers.cjs: 813 assertions.
- public-menu-item-panels.cjs: 45 assertions.
- public-menu-geometry.cjs: 3,450 assertions.
- Total current-worktree assertions: 4,551; all offline/intercepted, no database tests or production orders.
- Two inline scripts and three changed JS/CJS files syntax checked. git diff --check passes (existing line-ending warnings only).
- HEAD-based disposable incident-only tree is tested separately; repeated assertions are not added to the total. Initial temporary extraction failed because of Windows line endings, was corrected, and tests rerun. No source feature was changed to work around that extraction failure.

## Isolation and remaining evidence

Only incident edits in menu/index.html and menu/authoritative-checkout.js, plus tests/public-checkout-assets.cjs, tests/public-submit-resilience.cjs and this report belong to this task. The menu files already contain D1 local work: DO NOT deploy their whole working copies. An incident-only HEAD-based copy passes independently, so these specific hunks are suitable for isolated staging/review. Nothing has been staged/committed/deployed.

Next evidence from an affected device: exact menu URL, browser/OS version, [CURV checkout] stages, checkout asset response status and release. Do not collect names, addresses, phone numbers, cart contents, tokens or request bodies. A failed asset status/init exception will distinguish network blockage/version skew/runtime failure.

Customer workaround while pending: keep the original tab open if Submit was attempted; contact https://m.me/cafecurv and ask staff to check whether an order was received before resending. If no submission was attempted, open the menu in an up-to-date external browser or ask CURV to assist via Messenger. Do not clear browser storage to resolve uncertain submissions.

Verdict: local hardening implemented and suitable for isolated review; the originating failure on affected customer devices is not yet proven. No automatic production deployment is authorized.
