/* Fixed square crop matches the public menu's square, object-fit: cover thumbnails. */
(() => {
  const SIZE = 768;
  const create = () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'product-image-crop';
    dialog.setAttribute('aria-label', 'Crop product image');
    dialog.innerHTML = `
      <h2>Product Image</h2>
      <canvas width="768" height="768" tabindex="0" aria-label="Image crop. Use arrow keys to reposition."></canvas>
      <p>Drag to reposition the image. This crop matches the menu photo size.</p>
      <label>Zoom <input data-crop-zoom type="range" min="1" max="4" step="0.01" value="1"></label>
      <div class="product-image-crop-actions">
        <button type="button" data-crop-left title="Rotate Left" aria-label="Rotate Left">&#8630;</button>
        <button type="button" data-crop-right title="Rotate Right" aria-label="Rotate Right">&#8631;</button>
        <button type="button" data-crop-cancel>Cancel</button>
        <button type="button" data-crop-apply>Apply Crop</button>
      </div>
      <p data-crop-status role="status" aria-live="polite"></p>`;
    document.body.append(dialog);
    const canvas = dialog.querySelector('canvas');
    const context = canvas.getContext('2d');
    const zoom = dialog.querySelector('[data-crop-zoom]');
    const apply = dialog.querySelector('[data-crop-apply]');
    const status = dialog.querySelector('[data-crop-status]');
    let picture = null, sourceUrl = '', resolve = null, generation = 0;
    let angle = 0, scale = 1, x = 0, y = 0, pointer = null, exporting = false;
    const controls = () => {
      apply.disabled = !picture || exporting;
      zoom.disabled = !picture || exporting;
      dialog.querySelector('[data-crop-left]').disabled = !picture || exporting;
      dialog.querySelector('[data-crop-right]').disabled = !picture || exporting;
    };
    const draw = () => {
      if (!picture) return;
      const swapped = Math.abs(angle % 180) === 90;
      const width = swapped ? picture.naturalHeight : picture.naturalWidth;
      const height = swapped ? picture.naturalWidth : picture.naturalHeight;
      scale = Math.max(SIZE / width, SIZE / height) * Number(zoom.value);
      const limitX = Math.max(0, (width * scale - SIZE) / 2);
      const limitY = Math.max(0, (height * scale - SIZE) / 2);
      x = Math.max(-limitX, Math.min(limitX, x));
      y = Math.max(-limitY, Math.min(limitY, y));
      context.save();
      // Flatten transparent source pixels as well as guarding the crop edges.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, SIZE, SIZE);
      context.translate(SIZE / 2 + x, SIZE / 2 + y);
      context.rotate(angle * Math.PI / 180);
      context.scale(scale, scale);
      context.drawImage(picture, -picture.naturalWidth / 2, -picture.naturalHeight / 2);
      context.restore();
    };
    const cancel = () => {
      generation++;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      sourceUrl = '';
      picture = null;
      pointer = null;
      exporting = false;
      if (dialog.open) dialog.close();
      const done = resolve;
      resolve = null;
      if (done) done(null);
    };
    const open = file => {
      cancel();
      const token = generation;
      const result = new Promise(done => { resolve = done; });
      x = y = angle = 0;
      zoom.value = '1';
      context.clearRect(0, 0, SIZE, SIZE);
      status.textContent = 'Loading image...';
      controls();
      dialog.showModal();
      sourceUrl = URL.createObjectURL(file);
      const image = new Image();
      // Browser image decoding applies JPEG EXIF orientation before canvas drawing.
      image.onload = () => {
        if (token !== generation) return;
        picture = image;
        status.textContent = '';
        draw();
        controls();
        canvas.focus();
      };
      image.onerror = () => {
        if (token !== generation) return;
        status.textContent = 'This image could not be opened. Cancel and choose another image.';
      };
      image.src = sourceUrl;
      return result;
    };
    zoom.addEventListener('input', draw);
    for (const [selector, degrees] of [['[data-crop-left]', -90], ['[data-crop-right]', 90]]) {
      dialog.querySelector(selector).addEventListener('click', () => {
        if (!picture || exporting) return;
        angle = (angle + degrees) % 360;
        x = y = 0;
        draw();
      });
    }
    canvas.addEventListener('pointerdown', event => {
      if (!picture || exporting || pointer) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId || exporting) return;
      const rect = canvas.getBoundingClientRect();
      x += (event.clientX - pointer.x) * SIZE / rect.width;
      y += (event.clientY - pointer.y) * SIZE / rect.height;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      draw();
    });
    const release = () => { pointer = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('keydown', event => {
      if (!picture || exporting || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      x += event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
      y += event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0;
      draw();
    });
    dialog.querySelector('[data-crop-cancel]').addEventListener('click', cancel);
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    apply.addEventListener('click', () => {
      if (!picture || exporting) return;
      const token = generation;
      exporting = true;
      status.textContent = 'Preparing crop...';
      controls();
      canvas.toBlob(blob => {
        if (token !== generation) return;
        if (!blob || blob.size > 5 * 1024 * 1024) {
          exporting = false;
          status.textContent = 'Unable to prepare this crop. Try another image.';
          controls();
          return;
        }
        const cropped = new File([blob], 'product-crop.' + (blob.type === 'image/webp' ? 'webp' : 'png'), { type: blob.type });
        const done = resolve;
        resolve = null;
        cancel();
        if (done) done(cropped);
      }, 'image/webp', 0.92);
    });
    return { open, cancel };
  };
  window.CurvProductImageCrop = { create };
})();
