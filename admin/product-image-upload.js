/* Product-image staging only. Product writes remain in the normal Menu Manager save flow. */
(() => {
  const BUCKET = 'menu-images';
  const MAX_BYTES = 5 * 1024 * 1024;
  const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const normalize = value => {
    const url = String(value || '').trim();
    return /^images\//i.test(url) ? '/' + url : url;
  };
  const create = ({ root, getClient, isAuthorized, isEnabled, onChange = () => {} }) => {
    const field = root.querySelector('[name="image_url"]');
    const input = root.querySelector('[data-image-file]');
    const preview = root.querySelector('[data-image-preview]');
    const placeholder = root.querySelector('[data-image-placeholder]');
    const choose = root.querySelector('[data-image-choose]');
    const remove = root.querySelector('[data-image-remove]');
    const status = root.querySelector('[data-image-status]');
    const filename = root.querySelector('[data-image-filename]');
    const progress = root.querySelector('[data-image-progress]');
    const cropper = window.CurvProductImageCrop.create();
    let cropGeneration = 0;
    let cropping = false;
    let revision = 0;
    let file = null;
    let localUrl = '';
    let uploaded = null;
    let inFlight = null;
    let busy = false;
    let message = '';
    const revoke = () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
      localUrl = '';
    };
    // Delete only an object generated here that has never entered a product save.
    const cleanup = async object => {
      if (!object || object.saveAttempted) return;
      try {
        const { error } = await object.storage.remove([object.path]);
        if (error) console.warn('[CURV images] Unattached upload cleanup needs review.', object.path);
      } catch (_) {
        console.warn('[CURV images] Unattached upload cleanup needs review.', object.path);
      }
    };
    const refresh = () => {
      const url = localUrl || normalize(field.value);
      preview.hidden = !url;
      placeholder.hidden = Boolean(url);
      placeholder.textContent = url ? 'Preview unavailable' : 'No image';
      if (url && preview.getAttribute('src') !== url) preview.src = url;
      if (!url) preview.removeAttribute('src');
      choose.textContent = url ? 'Replace Image' : 'Choose Image';
      const disabled = busy || cropping || !isAuthorized() || !isEnabled();
      choose.disabled = disabled;
      input.disabled = disabled;
      remove.disabled = disabled || !url;
      remove.hidden = !url;
      root.setAttribute('aria-busy', String(busy));
      progress.hidden = !busy;
      filename.textContent = file ? file.name : '';
      status.textContent = message;
    };
    const reset = (url = '') => {
      cropGeneration++;
      cropping = false;
      cropper.cancel();
      revision++;
      if (!busy) void cleanup(uploaded);
      uploaded = null;
      inFlight = null;
      busy = false;
      file = null;
      revoke();
      field.value = url || '';
      input.value = '';
      message = '';
      refresh();
    };
    const select = async selected => {
      if (!selected || busy || cropping || !isAuthorized() || !isEnabled()) return;
      if (!Object.prototype.hasOwnProperty.call(TYPES, selected.type)) {
        message = 'Choose a JPG, PNG, or WebP image. The previous image is unchanged.';
        refresh();
        return;
      }
      if (!selected.size || selected.size > MAX_BYTES) {
        message = 'Choose a non-empty image no larger than 5 MB. The previous image is unchanged.';
        refresh();
        return;
      }
      const cropToken = ++cropGeneration;
      cropping = true;
      refresh();
      let cropped;
      try {
        cropped = await cropper.open(selected);
      } catch (_) {
        cropper.cancel();
        if (cropToken === cropGeneration) message = 'Unable to open the crop editor. Please try again.';
      } finally {
        if (cropToken === cropGeneration) { cropping = false; refresh(); }
      }
      if (!cropped || cropToken !== cropGeneration || !isAuthorized() || !isEnabled()) return;
      revision++;
      void cleanup(uploaded);
      uploaded = null;
      file = cropped;
      revoke();
      localUrl = URL.createObjectURL(cropped);
      message = 'Image selected. Save the item to upload it.';
      refresh();
      onChange();
    };
    const prepare = productId => {
      if (!isAuthorized()) return Promise.reject(new Error('Sign in before uploading an image.'));
      if (cropping) return Promise.reject(new Error('Apply or cancel the image crop before saving.'));
      if (inFlight) return inFlight;
      if (!file || uploaded) return Promise.resolve(field.value || null);
      const token = revision;
      const selected = file;
      const storage = getClient().storage.from(BUCKET);
      const folder = productId && /^[0-9a-f-]{36}$/i.test(productId) ? 'products/' + productId : 'drafts/' + crypto.randomUUID();
      const path = folder + '/' + crypto.randomUUID() + '.' + TYPES[selected.type];
      const object = { path, storage, saveAttempted: false };
      busy = true;
      message = 'Uploading image...';
      refresh();
      inFlight = (async () => {
        try {
          const { error } = await storage.upload(path, selected, {
            contentType: selected.type, cacheControl: '3600', upsert: false
          });
          if (error) throw error;
          if (token !== revision || !isAuthorized()) {
            await cleanup(object);
            throw new Error('Image upload cancelled because the editor or session changed.');
          }
          const { data } = storage.getPublicUrl(path);
          if (!data || !/^https?:\/\//i.test(data.publicUrl || '')) throw new Error('Storage did not return an image URL.');
          uploaded = object;
          field.value = data.publicUrl;
          message = 'Image uploaded. Saving item...';
          return data.publicUrl;
        } catch (error) {
          if (token === revision) {
            await cleanup(object);
            message = 'Image upload failed. Your changes are still here. Try again or choose another image. '
              + (error.message || 'Check Storage access with the owner.');
          }
          throw error;
        } finally {
          if (token === revision) {
            busy = false;
            inFlight = null;
            refresh();
          }
        }
      })();
      return inFlight;
    };
    choose.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { select(input.files[0]); input.value = ''; });
    remove.addEventListener('click', () => {
      if (busy || !isAuthorized() || !isEnabled()) return;
      reset('');
      message = 'Image removed from this item. Save to apply.';
      refresh();
      onChange();
    });
    preview.addEventListener('error', () => {
      preview.hidden = true;
      placeholder.hidden = false;
      placeholder.textContent = 'Preview unavailable';
    });
    refresh();
    return {
      reset, refresh, prepare, select,
      get revision() { return revision; },
      markSaveAttempt() { if (uploaded) uploaded.saveAttempted = true; },
      markAttached() {
        uploaded = null;
        file = null;
        revoke();
        message = '';
        refresh();
      }
    };
  };
  window.CurvProductImageUpload = { create, normalize };
})();
