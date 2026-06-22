-- CURV Control Menu Manager - Phase 3 menu seed draft
-- Review before running in Supabase SQL Editor.
-- Draft seed only: products are inserted as unpublished and unavailable.
-- Publish and enable availability later through CURV Control after checking names, prices, photos, and variants.
-- This file inserts products and product_sizes only; it does not create categories, policies, views, or public menu code.
-- CURV Picks is not inserted as a category. Real products that are clearly featured in CURV Picks use is_curv_pick = true.
-- Internal notes and variant costs are seeded as null.
--
-- Seeded product count by category:
--   Espresso: 14
--   Matcha & Hojicha: 14
--   Curvccino: 5
--   Refreshers: 5
--   Bites: 6
--   Savory: 3
--   Salad Bar: 5
--   Pastries & Desserts: 0 priced products seeded; coming-soon items have no current prices.

do $$
declare
  product_row record;
  size_row record;
  target_category_id uuid;
  target_product_id uuid;
begin
  create temp table if not exists curv_seed_products (
    seed_key text primary key,
    category_name text not null,
    product_name text not null,
    product_description text,
    image_url text,
    variant_group_name text,
    menu_group text,
    is_curv_pick boolean not null default false,
    is_seasonal boolean not null default false,
    sort_order integer not null default 0
  ) on commit drop;

  create temp table if not exists curv_seed_product_sizes (
    seed_key text not null,
    label text not null,
    price numeric not null,
    sort_order integer not null default 0
  ) on commit drop;

  truncate table curv_seed_products;
  truncate table curv_seed_product_sizes;

  insert into curv_seed_products (
    seed_key, category_name, product_name, product_description, image_url,
    variant_group_name, menu_group, is_curv_pick, is_seasonal, sort_order
  )
  values
  ('espresso-000-curv-latte', 'Espresso', 'Curv Latte', 'double espresso · full cream milk · a whisper of sweetness. the one that started it all.', 'images/menu/espresso/curv-latte.jpg', 'Size', 'Espresso', false, false, 0),
  ('espresso-001-einspanner-latte', 'Espresso', 'Einspanner Latte', 'double espresso · full cream milk · crowned with thick sweet cream.', 'images/menu/espresso/einspanner-latte.jpg', 'Size', 'Espresso', false, false, 1),
  ('espresso-002-spanish-latte', 'Espresso', 'Spanish Latte', 'double espresso · vanilla bean syrup · condensed milk · full cream milk.', null, 'Size', 'Espresso', true, false, 2),
  ('espresso-003-caramel-macchiato', 'Espresso', 'Caramel Macchiato', 'double espresso · caramel syrup · full cream milk · drizzled in caramel sauce.', 'images/menu/espresso/caramel-macchiato.jpg', 'Size', 'Espresso', false, false, 3),
  ('espresso-004-vanilla-latte', 'Espresso', 'Vanilla Latte', 'double espresso · vanilla bean syrup · full cream milk.', null, 'Size', 'Espresso', false, false, 4),
  ('espresso-005-white-chocolate-mocha', 'Espresso', 'White Chocolate Mocha', 'double espresso · white chocolate · white chocolate sauce · full cream milk · whipped cream on top.', 'images/menu/espresso/white-chocolate-mocha.jpg', 'Size', 'Espresso', true, false, 5),
  ('espresso-006-caff-mocha', 'Espresso', 'Caffè Mocha', 'double espresso · 60% dark chocolate · dark chocolate sauce · full cream milk · whipped cream on top.', 'images/menu/espresso/mocha-latte.jpg', 'Size', 'Espresso', false, false, 6),
  ('espresso-007-americano', 'Espresso', 'Americano', 'double espresso · water · nothing more, nothing less. brewed with Varese beans — 100% arabica, clean and sharp.', null, 'Size', 'Espresso', false, false, 7),
  ('espresso-008-cloud-spanish-oat-latte', 'Espresso', 'Cloud Spanish Oat Latte', 'double espresso · condensed milk · oat milk · salted cold foam on top.', 'images/menu/espresso/cloud-spanish-oat-latte.jpg', 'Size', 'Espresso', true, true, 8),
  ('espresso-009-cocoa-caramel-latte', 'Espresso', 'Cocoa Caramel Latte', 'triple espresso · dark chocolate dust · breve · whipped cream · drizzled in caramel sauce. this one hits. hard.', 'images/menu/espresso/cocoa-caramel-latte.jpg', 'Size', 'Espresso', false, true, 9),
  ('espresso-010-white-ube-latte', 'Espresso', 'White Ube Latte', 'double espresso · white chocolate · ube · full cream milk.', null, 'Size', 'Espresso', false, true, 10),
  ('espresso-011-curv-chocolate', 'Espresso', 'Curv Chocolate', '60% dark chocolate · dark chocolate dust · whole milk. for the days when only chocolate will do.', null, 'Each', 'Non-Espresso', false, false, 11),
  ('espresso-012-ube-cloud-latte', 'Espresso', 'Ube Cloud Latte', 'ube cold foam · whole milk · dusted in ube powder.', null, 'Size', 'Non-Espresso', false, false, 12),
  ('espresso-013-berry-cloud-latte', 'Espresso', 'Berry Cloud Latte', 'strawberry cold foam · strawberry purée · whole milk · dried strawberries on top.', null, 'Size', 'Non-Espresso', false, false, 13),
  ('matcha-hojicha-000-einspanner-matcha', 'Matcha & Hojicha', 'Einspanner Matcha', 'thick sweet cream · ceremonial matcha · milk', null, 'Each', null, false, false, 0),
  ('matcha-hojicha-001-kagoshima-matcha-cream', 'Matcha & Hojicha', 'Kagoshima Matcha Cream', 'ceremonial matcha ice cream · ceremonial matcha · milk', 'images/menu/matcha/kagoshima-matcha-cream.jpg', 'Each', null, true, false, 1),
  ('matcha-hojicha-002-banana-fudge-matcha-latte', 'Matcha & Hojicha', 'Banana Fudge Matcha Latte', 'banana fudge pudding · ceremonial matcha · milk', null, 'Each', null, false, false, 2),
  ('matcha-hojicha-003-cookie-crumb-matcha-latte', 'Matcha & Hojicha', 'Cookie Crumb Matcha Latte', 'matcha cookie · ceremonial matcha · milk', null, 'Each', null, false, false, 3),
  ('matcha-hojicha-004-sea-salt-cream-matcha-latte', 'Matcha & Hojicha', 'Sea Salt Cream Matcha Latte', 'sea salt cream · ceremonial matcha · milk · agave syrup', 'images/menu/matcha/sea-salt-cream-matcha-latte.jpg', 'Each', null, false, false, 4),
  ('matcha-hojicha-005-cs-matcha-oat-latte', 'Matcha & Hojicha', 'CS Matcha Oat Latte', 'ceremonial matcha · oat milk · agave syrup', 'images/menu/matcha/cs-matcha-oat-latte.jpg', 'Each', null, false, false, 5),
  ('matcha-hojicha-006-strawberry-matcha-latte', 'Matcha & Hojicha', 'Strawberry Matcha Latte', 'strawberry purée · ceremonial matcha · milk', 'images/menu/matcha/strawberry-matcha-latte.jpg', 'Each', null, true, false, 6),
  ('matcha-hojicha-007-pure-usucha', 'Matcha & Hojicha', 'Pure Usucha', 'ceremonial matcha · water · that''s all.', 'images/menu/matcha/pure-usucha.jpg', 'Each', null, false, false, 7),
  ('matcha-hojicha-008-matcha-ube-latte', 'Matcha & Hojicha', 'Matcha Ube Latte', 'ube cold foam · ceremonial matcha · milk', 'images/menu/matcha/matcha-ube-latte.jpg', 'Each', null, false, true, 8),
  ('matcha-hojicha-009-double-matcha-cloud', 'Matcha & Hojicha', 'Double Matcha Cloud', 'ceremonial matcha cold whisk · matcha cold foam · agave', 'images/menu/matcha/double-matcha-cloud.jpg', 'Each', null, false, true, 9),
  ('matcha-hojicha-010-matcha-sunrise', 'Matcha & Hojicha', 'Matcha Sunrise', 'ceremonial matcha · coconut milk · mango and strawberry purée', null, 'Each', null, false, true, 10),
  ('matcha-hojicha-011-hojicha-latte', 'Matcha & Hojicha', 'Hojicha Latte', 'dark roast hojicha · milk', 'images/menu/matcha/hojicha-latte.jpg', 'Each', null, false, false, 11),
  ('matcha-hojicha-012-sea-salt-cream-hojicha', 'Matcha & Hojicha', 'Sea Salt Cream Hojicha', 'dark roast hojicha · salted cream · milk', null, 'Each', null, true, false, 12),
  ('matcha-hojicha-013-pink-hojicha-latte', 'Matcha & Hojicha', 'Pink Hojicha Latte', 'strawberry cold foam · dark roast hojicha · milk · strawberry purée', null, 'Each', null, false, false, 13),
  ('curvccino-000-double-chocolate-chip-cream', 'Curvccino', 'Double Chocolate Chip Cream', null, 'images/menu/frappe/double-chocolate-chip-cream.jpg', 'Size', null, false, false, 0),
  ('curvccino-001-javachip-brownie-curvccino', 'Curvccino', 'Javachip Brownie Curvccino', null, 'images/menu/frappe/javachip-brownies-curvccino.jpg', 'Size', null, true, false, 1),
  ('curvccino-002-javachip-jelly-curvccino', 'Curvccino', 'Javachip Jelly Curvccino', null, null, 'Size', null, false, false, 2),
  ('curvccino-003-strawberries-cream', 'Curvccino', 'Strawberries & Cream', null, 'images/menu/frappe/strawberries-and-cream.jpg', 'Size', null, true, false, 3),
  ('curvccino-004-white-caramel-curvccino', 'Curvccino', 'White Caramel Curvccino', null, 'images/menu/frappe/white-caramel-curvccino.jpg', 'Size', null, false, false, 4),
  ('refreshers-000-dragon-dreams', 'Refreshers', 'Dragon Dreams', 'dragon fruit · sweet cream · milk', 'images/menu/refreshers/dragon-dreams.jpg', 'Size', null, true, false, 0),
  ('refreshers-001-tropic-kiss', 'Refreshers', 'Tropic Kiss', 'strawberry lemonade · mango juice · mango bits', 'images/menu/refreshers/tropic-kiss.jpg', 'Size', null, true, false, 1),
  ('refreshers-002-tokyo-sunrise', 'Refreshers', 'Tokyo Sunrise', 'mango purée · coconut milk · soft cream', 'images/menu/refreshers/tokyo-sunrise.jpg', 'Size', null, false, false, 2),
  ('refreshers-003-hibiscus-cream-tea', 'Refreshers', 'Hibiscus Cream Tea', 'hibiscus tea · soft sweet cream on top', 'images/menu/refreshers/hibiscus-cream-tea.jpg', 'Size', null, true, false, 3),
  ('refreshers-004-lime-cucumber', 'Refreshers', 'Lime Cucumber', 'fresh cucumber · sparkling lemon lime fizz', null, 'Size', null, false, false, 4),
  ('bites-000-og-takoyaki', 'Bites', 'OG Takoyaki', 'octobits · veggies · Japanese mayo · signature sauce · katsuoboshi · tenkasu · aonori · togarashi', 'images/menu/bites/og-takoyaki.jpg', 'Pieces', null, true, false, 0),
  ('bites-001-aburi-salmon', 'Bites', 'Aburi Salmon', 'flamed salmon · veggies · sriracha mayo · Japanese mayo · signature sauce · premium floss · katsuoboshi · tenkasu · aonori · togarashi', null, 'Pieces', null, false, false, 1),
  ('bites-002-oozie-cheese', 'Bites', 'Oozie Cheese', 'cheese filling · veggies · melted cheese · Japanese mayo · signature sauce · tenkasu · aonori · togarashi', null, 'Pieces', null, true, false, 2),
  ('bites-003-lava-melt', 'Bites', 'Lava Melt', 'cheese filling · veggies · melted cheese · sriracha Japanese mayo · signature sauce · tenkasu · aonori · togarashi', null, 'Pieces', null, false, false, 3),
  ('bites-004-classic-veggie', 'Bites', 'Classic Veggie', 'veggies · signature sauce · Japanese mayo · tenkasu · aonori · togarashi', null, 'Pieces', null, false, false, 4),
  ('bites-005-salted-egg', 'Bites', 'Salted Egg', 'salted egg · signature sauce · Japanese mayo · katsuoboshi · meat floss · tenkasu · aonori · togarashi', null, 'Pieces', null, false, false, 5),
  ('savory-000-shrimp-tempura', 'Savory', 'Shrimp Tempura', 'shrimp tempura · side w/ chips or veggies · tempura sauce', null, 'Each', null, false, false, 0),
  ('savory-001-chicken-karaage', 'Savory', 'Chicken Karaage', 'chicken karaage · side w/ chips or veggies · sweet chili sauce', 'images/menu/savory-bites/chicken-karaage.jpg', 'Each', null, true, false, 1),
  ('savory-002-cream-dory-fillet', 'Savory', 'Cream Dory Fillet', 'cream dory · side w/ chips or veggies · garlic aioli', 'images/menu/savory-bites/cream-dory-fillet.jpg', 'Each', null, false, false, 2),
  ('salad-bar-000-curv-salad', 'Salad Bar', 'Curv Salad', 'croutons · lettuce · cucumber · carrots · tomatoes · mangoes · parmesan cheese · salad dressing', null, 'Each', null, false, false, 0),
  ('salad-bar-001-chicken-salad', 'Salad Bar', 'Chicken Salad', 'chicken breast · lettuce · cucumber · tomatoes · croutons · parmesan cheese · dressing', 'images/menu/salads/chicken-salad.jpg', 'Each', null, false, false, 1),
  ('salad-bar-002-coastal-salad', 'Salad Bar', 'Coastal Salad', 'crab mix · lettuce · cucumber · carrots · mangoes · sesame seeds · salad dressing · chuka wakame currently unavailable', 'images/menu/salads/coastal-salad.jpg', 'Each', null, false, false, 2),
  ('salad-bar-003-chukawakame-salad', 'Salad Bar', 'Chukawakame Salad', '100g serving', null, 'Each', null, false, false, 3),
  ('salad-bar-004-spring-rolls', 'Salad Bar', 'Spring Rolls', 'crab mix · lettuce · cucumber · carrots · sesame sauce · Japanese mayo', 'images/menu/salads/spring-rolls.jpg', 'Pieces', null, true, false, 4);

  insert into curv_seed_product_sizes (seed_key, label, price, sort_order)
  values
  ('espresso-000-curv-latte', 'Regular', 130, 0),
  ('espresso-000-curv-latte', 'Large', 145, 1),
  ('espresso-001-einspanner-latte', 'Regular', 150, 0),
  ('espresso-001-einspanner-latte', 'Large', 160, 1),
  ('espresso-002-spanish-latte', 'Regular', 140, 0),
  ('espresso-002-spanish-latte', 'Large', 150, 1),
  ('espresso-003-caramel-macchiato', 'Regular', 160, 0),
  ('espresso-003-caramel-macchiato', 'Large', 175, 1),
  ('espresso-004-vanilla-latte', 'Regular', 140, 0),
  ('espresso-004-vanilla-latte', 'Large', 150, 1),
  ('espresso-005-white-chocolate-mocha', 'Regular', 150, 0),
  ('espresso-005-white-chocolate-mocha', 'Large', 160, 1),
  ('espresso-006-caff-mocha', 'Regular', 150, 0),
  ('espresso-006-caff-mocha', 'Large', 160, 1),
  ('espresso-007-americano', 'Regular', 120, 0),
  ('espresso-007-americano', 'Large', 125, 1),
  ('espresso-008-cloud-spanish-oat-latte', 'Regular', 160, 0),
  ('espresso-008-cloud-spanish-oat-latte', 'Large', 170, 1),
  ('espresso-009-cocoa-caramel-latte', 'Regular', 160, 0),
  ('espresso-009-cocoa-caramel-latte', 'Large', 170, 1),
  ('espresso-010-white-ube-latte', 'Regular', 160, 0),
  ('espresso-010-white-ube-latte', 'Large', 170, 1),
  ('espresso-011-curv-chocolate', 'Regular', 150, 0),
  ('espresso-012-ube-cloud-latte', 'Regular', 150, 0),
  ('espresso-012-ube-cloud-latte', 'Large', 160, 1),
  ('espresso-013-berry-cloud-latte', 'Regular', 150, 0),
  ('espresso-013-berry-cloud-latte', 'Large', 160, 1),
  ('matcha-hojicha-000-einspanner-matcha', 'Regular', 205, 0),
  ('matcha-hojicha-001-kagoshima-matcha-cream', 'Regular', 220, 0),
  ('matcha-hojicha-002-banana-fudge-matcha-latte', 'Regular', 220, 0),
  ('matcha-hojicha-003-cookie-crumb-matcha-latte', 'Regular', 220, 0),
  ('matcha-hojicha-004-sea-salt-cream-matcha-latte', 'Regular', 205, 0),
  ('matcha-hojicha-005-cs-matcha-oat-latte', 'Regular', 195, 0),
  ('matcha-hojicha-006-strawberry-matcha-latte', 'Regular', 205, 0),
  ('matcha-hojicha-007-pure-usucha', 'Regular', 170, 0),
  ('matcha-hojicha-008-matcha-ube-latte', 'Regular', 220, 0),
  ('matcha-hojicha-009-double-matcha-cloud', 'Regular', 220, 0),
  ('matcha-hojicha-010-matcha-sunrise', 'Regular', 220, 0),
  ('matcha-hojicha-011-hojicha-latte', 'Regular', 175, 0),
  ('matcha-hojicha-012-sea-salt-cream-hojicha', 'Regular', 195, 0),
  ('matcha-hojicha-013-pink-hojicha-latte', 'Regular', 205, 0),
  ('curvccino-000-double-chocolate-chip-cream', 'Regular', 160, 0),
  ('curvccino-000-double-chocolate-chip-cream', 'Large', 175, 1),
  ('curvccino-001-javachip-brownie-curvccino', 'Regular', 160, 0),
  ('curvccino-001-javachip-brownie-curvccino', 'Large', 175, 1),
  ('curvccino-002-javachip-jelly-curvccino', 'Regular', 160, 0),
  ('curvccino-002-javachip-jelly-curvccino', 'Large', 175, 1),
  ('curvccino-003-strawberries-cream', 'Regular', 155, 0),
  ('curvccino-003-strawberries-cream', 'Large', 170, 1),
  ('curvccino-004-white-caramel-curvccino', 'Regular', 160, 0),
  ('curvccino-004-white-caramel-curvccino', 'Large', 175, 1),
  ('refreshers-000-dragon-dreams', 'Regular', 160, 0),
  ('refreshers-000-dragon-dreams', 'Large', 170, 1),
  ('refreshers-001-tropic-kiss', 'Regular', 150, 0),
  ('refreshers-001-tropic-kiss', 'Large', 165, 1),
  ('refreshers-002-tokyo-sunrise', 'Regular', 160, 0),
  ('refreshers-002-tokyo-sunrise', 'Large', 170, 1),
  ('refreshers-003-hibiscus-cream-tea', 'Regular', 150, 0),
  ('refreshers-003-hibiscus-cream-tea', 'Large', 160, 1),
  ('refreshers-004-lime-cucumber', 'Regular', 150, 0),
  ('refreshers-004-lime-cucumber', 'Large', 160, 1),
  ('bites-000-og-takoyaki', '4pcs', 90, 0),
  ('bites-000-og-takoyaki', '8pcs', 150, 1),
  ('bites-000-og-takoyaki', '12pcs', 220, 2),
  ('bites-001-aburi-salmon', '4pcs', 105, 0),
  ('bites-001-aburi-salmon', '8pcs', 200, 1),
  ('bites-001-aburi-salmon', '12pcs', 300, 2),
  ('bites-002-oozie-cheese', '4pcs', 90, 0),
  ('bites-002-oozie-cheese', '8pcs', 150, 1),
  ('bites-002-oozie-cheese', '12pcs', 220, 2),
  ('bites-003-lava-melt', '4pcs', 95, 0),
  ('bites-003-lava-melt', '8pcs', 165, 1),
  ('bites-003-lava-melt', '12pcs', 230, 2),
  ('bites-004-classic-veggie', '8pcs', 140, 0),
  ('bites-004-classic-veggie', '12pcs', 200, 1),
  ('bites-005-salted-egg', '8pcs', 165, 0),
  ('bites-005-salted-egg', '12pcs', 230, 1),
  ('savory-000-shrimp-tempura', 'Regular', 180, 0),
  ('savory-001-chicken-karaage', 'Regular', 170, 0),
  ('savory-002-cream-dory-fillet', 'Regular', 170, 0),
  ('salad-bar-000-curv-salad', 'Regular', 160, 0),
  ('salad-bar-001-chicken-salad', 'Regular', 210, 0),
  ('salad-bar-002-coastal-salad', 'Regular', 180, 0),
  ('salad-bar-003-chukawakame-salad', 'Regular', 110, 0),
  ('salad-bar-004-spring-rolls', '4 pcs', 150, 0),
  ('salad-bar-004-spring-rolls', '8 pcs', 298, 1);

  for product_row in
    select * from curv_seed_products order by category_name, sort_order, product_name
  loop
    select id
      into target_category_id
      from public.categories
      where name = product_row.category_name
      limit 1;

    if target_category_id is null then
      raise notice 'Skipping %, category % was not found.', product_row.product_name, product_row.category_name;
      continue;
    end if;

    select id
      into target_product_id
      from public.products
      where category_id = target_category_id
        and name = product_row.product_name
      order by id
      limit 1;

    if target_product_id is null then
      insert into public.products (
        category_id, name, description, image_url, is_available, is_published,
        is_curv_pick, is_seasonal, sort_order, notes, variant_group_name, menu_group
      )
      values (
        target_category_id, product_row.product_name, product_row.product_description,
        product_row.image_url, false, false, product_row.is_curv_pick,
        product_row.is_seasonal, product_row.sort_order, null, product_row.variant_group_name, product_row.menu_group
      )
      returning id into target_product_id;
    else
      update public.products
        set description = product_row.product_description,
            image_url = product_row.image_url,
            is_available = false,
            is_published = false,
            is_curv_pick = product_row.is_curv_pick,
            is_seasonal = product_row.is_seasonal,
            sort_order = product_row.sort_order,
            notes = null,
            variant_group_name = product_row.variant_group_name,
            menu_group = product_row.menu_group
        where id = target_product_id;
    end if;

    delete from public.product_sizes
      where product_id = target_product_id;

    for size_row in
      select *
        from curv_seed_product_sizes
        where seed_key = product_row.seed_key
        order by sort_order, label
    loop
      insert into public.product_sizes (product_id, label, price, sort_order, cost)
      values (target_product_id, size_row.label, size_row.price, size_row.sort_order, null);
    end loop;
  end loop;
end $$;


