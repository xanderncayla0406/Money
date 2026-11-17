// Customer quote flow: photos -> (contact) -> estimate -> booking request.
(() => {
  const data = JSON.parse(document.getElementById('pq-data').textContent);
  const $ = (selector) => document.querySelector(selector);
  const STEPS = ['photos', 'loading', 'unusable', 'result', 'book', 'done'];
  const MAX_SIDE = 1280;

  const photos = []; // { url, base64 }
  let leadId = null;
  let contact = null;
  let lastResult = null;
  let chosenDay = null;
  let chosenWindow = null;

  // ------------------------------------------------------------ helpers

  function show(step) {
    for (const name of STEPS) {
      const el = document.getElementById(`step-${name}`);
      if (el) el.hidden = name !== step;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const errorBox = $('#q-error');
  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
    if (message) errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const priceRange = (low, high) => (low === high ? money(low) : `${money(low)}–${money(high)}`);
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ------------------------------------------------------------ photos

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not load image'));
      };
      img.src = url;
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Shrink to max 1280px JPEG: faster upload, plenty of detail for the estimate.
  async function processImage(file) {
    let source;
    let width;
    let height;
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      width = source.width;
      height = source.height;
    } catch {
      source = await loadImage(file);
      width = source.naturalWidth;
      height = source.naturalHeight;
    }
    if (!width || !height) throw new Error('Empty image');
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === 'function') source.close();
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode'))), 'image/jpeg', 0.82),
    );
    return { url: URL.createObjectURL(blob), base64: await blobToBase64(blob) };
  }

  const input = $('#photo-input');
  const thumbs = $('#thumbs');
  const priceButton = $('#get-price');
  const dropzone = $('#dropzone');

  function renderThumbs() {
    thumbs.replaceChildren();
    photos.forEach((photo, index) => {
      const item = el('div', 'thumb');
      const img = el('img');
      img.src = photo.url;
      img.alt = `Photo ${index + 1}`;
      const remove = el('button', 'thumb-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove photo ${index + 1}`);
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(photo.url);
        photos.splice(index, 1);
        renderThumbs();
      });
      item.append(img, remove);
      thumbs.append(item);
    });
    if (photos.length && photos.length < data.maxPhotos) {
      const add = el('label', 'thumb thumb-add', '+ Add');
      add.htmlFor = 'photo-input';
      thumbs.append(add);
    }
    dropzone.hidden = photos.length > 0;
    priceButton.disabled = photos.length === 0;
  }

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    showError('');
    if (!files.length) return;
    priceButton.disabled = true;
    const before = priceButton.textContent;
    priceButton.textContent = 'Preparing photos…';
    let failed = 0;
    for (const file of files) {
      if (photos.length >= data.maxPhotos) {
        showError(`Up to ${data.maxPhotos} photos, please.`);
        break;
      }
      try {
        photos.push(await processImage(file));
      } catch {
        failed += 1;
      }
    }
    priceButton.textContent = before;
    if (failed) showError(`${failed === 1 ? 'One photo' : `${failed} photos`} couldn't be read. Try a regular JPG photo.`);
    renderThumbs();
  });

  // ------------------------------------------------------------ estimate

  const loadingText = $('#loading-text');
  const loadingLines = [
    'Looking at your photos…',
    'Spotting the items…',
    'Measuring truck space…',
    'Checking prices…',
    'Almost done…',
  ];
  let loadingTimer = null;
  function startLoading() {
    let i = 0;
    loadingText.textContent = loadingLines[0];
    loadingTimer = setInterval(() => {
      i = Math.min(i + 1, loadingLines.length - 1);
      loadingText.textContent = loadingLines[i];
    }, 4000);
  }
  function stopLoading() {
    clearInterval(loadingTimer);
  }

  $('#photo-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    if (!photos.length) return showError('Add at least one photo.');
    if (data.requireContact) {
      contact = {
        name: $('#c-name').value.trim(),
        phone: $('#c-phone').value.trim(),
        email: $('#c-email').value.trim(),
      };
      if (!contact.name) return showError('Please enter your name.');
      if (digits(contact.phone).length < 10) return showError('Please enter a valid mobile number.');
    }

    show('loading');
    startLoading();
    try {
      const res = await fetch(`/api/q/${encodeURIComponent(data.slug)}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: photos.map((p) => p.base64), notes: $('#notes').value.trim(), contact }),
      });
      const body = await res.json().catch(() => ({}));
      stopLoading();
      if (!res.ok) {
        show('photos');
        return showError(body.error || 'Something went wrong. Please try again.');
      }
      leadId = body.leadId;
      lastResult = body;
      if (!body.estimate.usable) {
        $('#u-reason').textContent = body.estimate.unusableReason;
        $('#u-tip').textContent = body.estimate.photoTips || 'Try a well-lit photo that shows the whole pile.';
        show('unusable');
        return;
      }
      renderResult(body);
      show('result');
    } catch {
      stopLoading();
      show('photos');
      showError('Connection problem. Check your signal and try again.');
    }
  });

  const SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }

  function truck(lowFill, highFill) {
    const inner = 196;
    const root = svg('svg', { class: 'truck', viewBox: '0 0 320 132', role: 'img', 'aria-label': `Truck about ${Math.round(highFill * 100)}% full` });
    root.append(
      svg('rect', { x: 8, y: 8, width: 210, height: 92, rx: 8, class: 'truck-box' }),
      svg('rect', { x: 15, y: 15, width: Math.round(inner * Math.min(1, highFill)), height: 78, rx: 4, class: 'truck-fill-high' }),
      svg('rect', { x: 15, y: 15, width: Math.round(inner * Math.min(1, lowFill)), height: 78, rx: 4, class: 'truck-fill' }),
      svg('path', { d: 'M224 38h50l30 34v28h-80z', class: 'truck-cab' }),
      svg('path', { d: 'M234 46h36l20 24h-56z', class: 'truck-window' }),
    );
    for (const cx of [62, 176, 268]) {
      root.append(svg('circle', { cx, cy: 108, r: 16, class: 'truck-wheel' }), svg('circle', { cx, cy: 108, r: 6, class: 'truck-hub' }));
    }
    return root;
  }

  function renderResult({ estimate, price }) {
    $('#r-price').textContent = priceRange(price.low, price.high);
    $('#r-size').textContent = price.sizeLabel;
    $('#r-yards').textContent = `Roughly ${estimate.volumeLow}–${estimate.volumeHigh} cubic yards`;
    $('#r-truck').replaceChildren(truck(price.lowFill, price.highFill));
    $('#r-summary').textContent = estimate.customerSummary || '';

    const flags = $('#r-flags');
    flags.replaceChildren();
    if (estimate.heavyMaterials) {
      flags.append(el('div', 'flag', `Heavy materials like concrete, dirt or shingles are often priced by weight, so ${data.name} may adjust this price.`));
    }
    if (estimate.notAccepted && estimate.notAccepted.length) {
      flags.append(el('div', 'flag', `${data.name} may not be able to take: ${estimate.notAccepted.join(', ')}.`));
    }

    const feesByKey = Object.fromEntries((price.fees || []).map((f) => [f.key, f]));
    const list = $('#r-items');
    list.replaceChildren();
    for (const item of estimate.items) {
      const li = el('li');
      li.append(el('span', '', item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name));
      const fee = feesByKey[item.feeType];
      if (fee) li.append(el('span', 'fee-badge', `+${money(fee.each)} each`));
      list.append(li);
    }
    if (!estimate.items.length) list.append(el('li', '', 'Items in your photos'));

    const tip = $('#r-tip');
    tip.textContent = estimate.photoTips ? `Tip: ${estimate.photoTips}` : '';
    tip.hidden = !estimate.photoTips;
  }

  function restart() {
    for (const p of photos) URL.revokeObjectURL(p.url);
    photos.length = 0;
    renderThumbs();
    showError('');
    show('photos');
  }
  $('#retake').addEventListener('click', restart);
  $('#u-retry').addEventListener('click', restart);

  // ------------------------------------------------------------ booking

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function chip(label, pressed, onClick) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b.addEventListener('click', () => {
      for (const other of b.parentElement.querySelectorAll('.chip')) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onClick();
    });
    return b;
  }

  function renderBooking() {
    const days = $('#day-chips');
    days.replaceChildren();
    const open = new Set(data.openDays && data.openDays.length ? data.openDays : [0, 1, 2, 3, 4, 5, 6]);
    const today = new Date();
    let shown = 0;
    for (let i = 0; i < 21 && shown < 8; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      if (!open.has(d.getDay())) continue;
      const label =
        i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const value = ymd(d);
      days.append(chip(label, value === chosenDay?.value, () => (chosenDay = { value, label })));
      shown += 1;
    }
    const windows = $('#window-chips');
    windows.replaceChildren();
    for (const w of data.windows) windows.append(chip(w, w === chosenWindow, () => (chosenWindow = w)));

    if (contact) {
      if (!$('#b-name').value) $('#b-name').value = contact.name || '';
      if (!$('#b-phone').value) $('#b-phone').value = contact.phone || '';
      if (!$('#b-email').value) $('#b-email').value = contact.email || '';
    }
  }

  $('#go-book').addEventListener('click', () => {
    renderBooking();
    showError('');
    show('book');
  });
  $('#book-back').addEventListener('click', () => {
    showError('');
    show('result');
  });

  $('#book-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const body = {
      name: $('#b-name').value.trim(),
      phone: $('#b-phone').value.trim(),
      email: $('#b-email').value.trim(),
      address: $('#b-address').value.trim(),
      notes: $('#b-notes').value.trim(),
      date: chosenDay?.value,
      window: chosenWindow,
    };
    if (!body.date) return showError('Please pick a day.');
    if (!body.window) return showError('Please pick a time.');
    if (body.address.length < 5) return showError('Please enter the pickup address.');
    if (!body.name) return showError('Please enter your name.');
    if (digits(body.phone).length < 10) return showError('Please enter a valid mobile number.');

    const button = $('#book-submit');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return showError(out.error || 'Something went wrong. Please try again.');
      const price = lastResult?.price;
      $('#d-text').textContent =
        `${data.name} got your request for ${chosenDay.label.toLowerCase() === 'today' || chosenDay.label.toLowerCase() === 'tomorrow' ? chosenDay.label.toLowerCase() : chosenDay.label}, ${chosenWindow}. ` +
        `They'll call or text ${body.phone} to confirm.` +
        (price ? ` Your estimate: ${priceRange(price.low, price.high)}.` : '');
      show('done');
    } catch {
      showError('Connection problem. Check your signal and try again.');
    } finally {
      button.disabled = false;
      button.textContent = 'Request pickup';
    }
  });

  renderThumbs();
})();
