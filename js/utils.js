/* ═══════════════════════════════════════════════════════
   UTILS.JS — Shared utilities
═══════════════════════════════════════════════════════ */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCurrency(amount) {
  const code = (typeof getActiveCurrencyCode === 'function') ? getActiveCurrencyCode() : 'PHP';
  const locale = (typeof CURRENCY_REGISTRY !== 'undefined' && CURRENCY_REGISTRY[code]?.locale) || 'en-PH';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code })
    .format(Number(amount || 0));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Caps any decimal quantity (stock, weight, cost-per-unit, %, etc.) to at
// most 2 decimal places, absorbing floating-point drift (e.g. 4.999999999999998).
function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showNotification(message, type = 'info') {
  let container = document.getElementById('notificationContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    document.body.appendChild(container);
  }

  const n = document.createElement('div');
  n.className = `notification ${type}`;
  n.innerHTML = `<div class="notification-content">${escapeHtml(message)}</div>`;
  container.appendChild(n);

  requestAnimationFrame(() => n.classList.add('show'));
  setTimeout(() => {
    n.classList.remove('show');
    setTimeout(() => n.remove(), 200);
  }, 3000);
}

/* Chart.js is loaded from a CDN (see index.html), so it can simply be absent:
   offline, venue wifi blocking cdn.jsdelivr.net, or a CDN outage. Every chart
   site used to just `return` in that case, leaving a full-size blank panel
   that reads as a broken app rather than a missing library.

   Returns true when charting is unavailable (caller should stop), and leaves a
   short explanation in place of the empty canvas. */
function chartUnavailable(canvas) {
  if (!canvas) return true;
  const holder = canvas.parentElement;
  const existing = holder && holder.querySelector('.chart-unavailable-note');

  if (typeof Chart !== 'undefined') {
    if (existing) existing.remove();          // recovered — clear the notice
    canvas.style.display = '';
    return false;
  }

  canvas.style.display = 'none';
  if (holder && !existing) {
    const note = document.createElement('div');
    note.className = 'chart-unavailable-note';
    note.textContent = 'Chart unavailable offline. Reconnect to load it.';
    holder.appendChild(note);
  }
  return true;
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('active');
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.style.overflow = '';
  }
}

/* On-brand replacement for the native confirm() dialog — same .modal-overlay
   shell as every other modal in the app instead of the browser's unstyled
   popup. Returns a Promise<boolean>.
     title               — modal heading
     message             — plain-text body paragraph (optional)
     lines               — optional array of strings rendered as an
                            itemized list (e.g. per-product stock shortages)
                            instead of one run-on paragraph
     okLabel/cancelLabel — button text
     danger              — true renders the confirm button as .btn-danger */
function customConfirm(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let m = document.getElementById('customConfirmModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'customConfirmModal';
      m.className = 'modal-overlay';
      document.body.appendChild(m);
    }
    const linesHtml = Array.isArray(opts.lines) && opts.lines.length
      ? `<div style="background:var(--gray-50);border:1px solid var(--border);border-radius:var(--radius-md);
           padding:4px 14px;margin-bottom:18px;">` +
          opts.lines.map((l, i) => `<div style="font-size:12.5px;font-weight:700;color:var(--gray-800);
            padding:7px 0;${i < opts.lines.length - 1 ? 'border-bottom:1px solid var(--gray-100);' : ''}">${escapeHtml(l)}</div>`)
            .join('') +
        `</div>`
      : '';
    m.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h3>${escapeHtml(opts.title || 'Confirm')}</h3>
        ${opts.message ? `<div style="font-size:13.5px;color:var(--gray-600);line-height:1.5;
          margin-bottom:${linesHtml ? '14px' : '20px'};">${escapeHtml(opts.message)}</div>` : ''}
        ${linesHtml}
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="customConfirmCancelBtn">${escapeHtml(opts.cancelLabel || 'Cancel')}</button>
          <button class="btn${opts.danger ? ' btn-danger' : ''}" type="button" id="customConfirmOkBtn">${escapeHtml(opts.okLabel || 'Continue')}</button>
        </div>
      </div>`;
    openModal('customConfirmModal');
    const finish = result => { closeModal('customConfirmModal'); resolve(result); };
    document.getElementById('customConfirmCancelBtn').onclick = () => finish(false);
    document.getElementById('customConfirmOkBtn').onclick = () => finish(true);
  });
}

/* On-brand replacement for the native prompt() dialog — same shell as
   customConfirm above. Returns a Promise<string> (empty string if skipped). */
function customPrompt(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let m = document.getElementById('customPromptModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'customPromptModal';
      m.className = 'modal-overlay';
      document.body.appendChild(m);
    }
    m.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h3>${escapeHtml(opts.title || 'Add a note')}</h3>
        ${opts.message ? `<div style="font-size:12.5px;color:var(--gray-500);margin-bottom:10px;">${escapeHtml(opts.message)}</div>` : ''}
        <textarea id="customPromptInput" class="form-input" rows="3"
          placeholder="${escapeHtml(opts.placeholder || '')}" style="width:100%;resize:vertical;"></textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary" type="button" id="customPromptSkipBtn">${escapeHtml(opts.skipLabel || 'Skip')}</button>
          <button class="btn" type="button" id="customPromptOkBtn">${escapeHtml(opts.okLabel || 'Save note')}</button>
        </div>
      </div>`;
    openModal('customPromptModal');
    const finish = value => { closeModal('customPromptModal'); resolve(value); };
    document.getElementById('customPromptSkipBtn').onclick = () => finish('');
    document.getElementById('customPromptOkBtn').onclick = () => finish(document.getElementById('customPromptInput').value || '');
  });
}

function setElementValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getElementValue(id, fallback = '') {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  localStorage.setItem('caflat-theme', next);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.querySelector('.toggle-icon').textContent = next === 'dark' ? '☀' : '☽';
    btn.querySelector('.toggle-label').textContent = next === 'dark' ? 'Light' : 'Dark';
  }
}

window.generateId        = generateId;
window.formatCurrency    = formatCurrency;
window.safeNumber        = safeNumber;
window.sanitizeText      = sanitizeText;
window.escapeHtml        = escapeHtml;
window.showNotification  = showNotification;
window.openModal         = openModal;
window.closeModal        = closeModal;
window.setElementValue   = setElementValue;
window.getElementValue   = getElementValue;
window.downloadTextFile  = downloadTextFile;
window.toggleTheme       = toggleTheme;
