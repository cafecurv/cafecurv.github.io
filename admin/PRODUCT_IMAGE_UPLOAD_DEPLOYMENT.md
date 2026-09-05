# Product Image Upload Deployment

1. Review and manually run MENU_PRODUCT_IMAGES_STORAGE.sql. It is transaction-wrapped.
   It aborts if an existing menu-images bucket has unexpected settings.
2. Run MENU_PRODUCT_IMAGES_STORAGE_VERIFY.sql manually. Review its policy output.
   Test Storage API access using owner, non-admin and anonymous sessions.
3. Deploy menu-manager.html, admin.js, admin.css, product-image-crop.js and
   product-image-upload.js together.
4. Upload JPG, PNG and WebP on an existing and new product; save, reopen, then
   inspect the public menu, CURV Picks and search destination on a phone.
5. Test removal, upload failure, retry, cancel/editor switching and signout.

The existing products.image_url field is unchanged. Selection previews are local;
selection opens a fixed square crop, matching the 76px standard, 88px salad and
72px pastry menu thumbnails. Apply Crop stages a 768px square WebP (quality 0.92),
with PNG fallback when the browser cannot encode WebP. Browser decoding handles
EXIF orientation. Transparent pixels are flattened onto white. Cancel keeps the
previous saved/pending image. Existing images are not automatically recropped.
The crop feature needs no additional SQL beyond the original upload configuration.
Test wide/tall photos, zoom, quarter-turn rotation, touch drag and crop cancellation.

upload occurs on Save before the normal product write. Existing products use
products/{uuid}/{unique-uuid}.{extension}. New products use
drafts/{unique-uuid}/{unique-uuid}.{extension}; the saved product references that URL
without an extra move/copy. Objects are unique and never overwritten.

Storage upload and product/size saves are not one database transaction. Upload
failure prevents product mutation. The existing product/size partial-save behavior
is unchanged. No new product is created merely by selecting an image.

Only known unattached uploads from the current editor can be cleaned up automatically.
Once a product save has been attempted, its object is retained even on an uncertain
response. Replacing/removing a saved image clears/replaces its URL but does not
delete the previous object: another product may share it. Network loss, tab closure,
or lost authentication can leave an unattached upload. Review references before any
manual cleanup; do not delete all drafts/ objects (saved new products use that path).

Legacy images/..., /images/..., absolute URLs and data/blob previews remain supported.
No service-role key, GitHub writes, live Supabase connection, or production SQL
execution is part of the local implementation/tests.
