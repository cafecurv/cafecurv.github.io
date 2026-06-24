# Option / Add-on Groups Architecture Draft

This is a draft architecture note. Do not implement until reviewed again, ideally by Claude/architecture review.

## 1. Current Foundation

CURV Control already has a working Supabase-backed menu foundation:

- Admin-managed categories, products, and product variants/prices.
- Product publish/unpublish controls.
- Draft product creation, editing, and deletion.
- Display order drag/save/reset using `products.sort_order`.
- Public-safe menu views for customer reads.
- Customer menu fallback protection in `menu.html`.
- Existing hardcoded customer menu options and add-ons still active in `menu.html`.

The next phase should follow the same safety pattern: build admin/backend support first, then add inert customer fetching, then render one category only with hardcoded fallback preserved.

## 2. Recommended Minimal Tables

### `option_groups`

Reusable option group definitions, such as Milk, Syrup, Sauce, Extra Shot, Add-ons, Temperature, Sweetener, or Item Note.

Recommended fields:

- `id`
- `name`
- `label`
- `selection_type`
- `is_required`
- `min_select`
- `max_select`
- `is_active`
- `is_published`
- `sort_order`
- `notes`
- `created_at`
- `updated_at`

### `option_choices`

Choices belonging to an option group, such as Full Cream, Oat, Vanilla, Caramel, Tempura Sauce, or Garlic Aioli.

Recommended fields:

- `id`
- `option_group_id`
- `label`
- `price_delta`
- `is_available`
- `sort_order`
- `notes`
- `created_at`

### `product_option_groups`

Junction table that attaches reusable option groups to specific products.

Recommended fields:

- `id`
- `product_id`
- `option_group_id`
- `is_enabled`
- `is_required_override`
- `min_select_override`
- `max_select_override`
- `sort_order`

### `product_option_defaults`

Product-specific default choices. This is needed because defaults can differ per product, especially for sauce defaults.

Recommended fields:

- `id`
- `product_option_group_id`
- `option_choice_id`

## 3. Modeling Rules

- Keep variants and base prices in `product_sizes`; do not move Regular/Large or piece sizes into options yet.
- Use `selection_type` for option behavior:
  - `single`
  - `multiple`
  - `note`
- Required/optional behavior should live on `option_groups`, with product-level overrides in `product_option_groups`.
- Use `min_select` and `max_select` for multi-select limits.
- Use `option_choices.price_delta` for add-on pricing.
- Use `sort_order` on groups, choices, and product assignments.
- Use `product_option_defaults` for product-specific defaults.
- Keep internal admin notes private.
- Keep Takoyaki dynamic cheese pricing hardcoded for now.

## 4. Public Read / View Strategy

Customer reads should use public-safe views only, not raw option tables.

Future public views may include:

- `public_menu_option_groups`
- `public_menu_option_choices`
- possibly `public_menu_option_defaults`

Public views should expose only customer-safe display fields:

- product id
- option group assignment id
- option group label/name
- selection type
- required/min/max settings
- choice label
- price delta
- default marker
- sort order

Public views must not expose:

- internal notes
- cost fields
- admin profile data
- timestamps
- unpublished/inactive option records

Public filtering should require:

- parent product is published and available
- option group is active and published
- product option assignment is enabled
- option choice is available

## 5. Admin RLS Assumptions

Use the existing CURV Control admin access pattern:

- `public.is_admin()` remains the owner-only gate.
- Owner/admin can read and write option groups, choices, product assignments, and defaults.
- Anonymous users should not write to any option table.
- Anonymous users should not read raw private option tables directly unless column-level grants and RLS are intentionally reviewed.
- Public customer reads should go through public-safe views.

## 6. Suggested Rollout Phases

### Phase A: SQL / Schema Only

Create option tables, constraints, indexes, owner-only RLS policies, and beginner-friendly comments.

Do not connect admin UI yet.
Do not connect customer menu yet.
Do not seed live customer options yet.

### Phase B: Admin Option Group Manager

Add a simple admin UI for creating and editing reusable option groups and choices.

No customer rendering.
No product attachment yet.

### Phase C: Attach Groups To Products

Add product-level option group attachment inside Menu Manager.

Support:

- attaching reusable groups
- setting required/optional overrides
- setting min/max overrides
- choosing product-specific defaults
- arranging option group order

### Phase D: Inert Customer Fetch

Fetch public-safe option views in `menu.html`, shape the data, and log or inspect it without rendering.

Hardcoded customer options remain active.

### Phase E: One-Category Rendering Test

Render backend-managed options for one safe category only.

Use all-or-nothing fallback:

- if Supabase option data is valid, render backend options
- if missing or unsafe, keep hardcoded options

## 7. Safest First Test Category

Start with Savory sauce defaults.

Suggested initial products:

- Shrimp Tempura -> Tempura Sauce
- Chicken Karaage -> Sweet Chili Sauce
- Cream Dory Fillet -> Garlic Aioli

Savory is safer than Espresso, Matcha, or Takoyaki because it has simpler option behavior and fewer layered paid add-ons.

## 8. What Not To Touch Yet

Do not touch:

- customer cart/order logic
- existing hardcoded customer options
- Takoyaki cheese pricing logic
- Espresso complex drink options
- Matcha/Hojicha complex drink options
- CURV Picks
- POS
- inventory
- orders
- recipes
- service-role keys or secret keys
- live customer option rendering

## 9. Main Risks

- Group-level defaults are not enough; some defaults must be product-specific.
- Required groups with no available choices could block ordering.
- Multi-select min/max validation must match between admin and customer UI.
- Price modifiers affect cart totals, cart keys, and order message formatting.
- Takoyaki cheese pricing depends on piece-size behavior and should stay hardcoded temporarily.
- Public views must not expose internal notes, costs, admin fields, or timestamps.
- Product and option labels changing in admin can affect customer-facing order messages.
- Customer rollout should remain category-by-category with hardcoded fallback.

## 10. Proposed First Future Implementation Patch

The first future implementation patch should be SQL schema draft only.

Recommended file:

`admin/MENU_MANAGER_PHASE4_OPTIONS_SCHEMA.sql`

That file should include:

- the four option tables
- constraints and indexes
- owner-only RLS policies using `public.is_admin()`
- comments explaining intended use
- no SQL execution by Codex
- no customer menu connection
- no public option rendering
- no seed data unless reviewed separately
