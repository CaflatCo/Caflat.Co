/* ═══════════════════════════════════════════════════════
   SYNC.JS — Caflat.CORE Cloud Sync Engine
   Tier: CLOUD + ENTERPRISE only
   Strategy:
     • Sales / audit log / inventory movements → append-only, no conflicts
     • Products / ingredients / settings → last-write-wins via updated_at
     • Full snapshot stored in `backups` table (existing)
     • Incremental changes stored in `sync_log` table (new)
     • Push: after every persistState() call
     • Pull: on app load + every 60s when online
═══════════════════════════════════════════════════════ */

const SYNC_VERSION       = 1;
const SYNC_PULL_INTERVAL = 60 * 1000; // 60 seconds
const SYNC_DEBOUNCE_MS   = 2000;      // wait 2s after last change before pushing

let _syncInitialised  = false;
let _syncPushTimer    = null;
let _syncPullTimer    = null;
let _lastSyncAt       = null;
let _syncPending      = false;
let _deviceId         = null;
let _lastSyncError    = null;
let _syncErrorNotified = false; // show toast only on first failure per session

/* ── Entry point called by applyLicenseTier ── */
async function initSyncEngine() {
  if (_syncInitialised) return;
  if (typeof isCloudTier !== 'function' || !isCloudTier()) return;

  _deviceId = typeof _generateDeviceId === 'function'
    ? await _generateDeviceId() : 'unknown';

  _syncInitialised = true;
  console.log('[Sync] Engine initialised — device:', _deviceId?.slice(0,8));

  // Pull latest state from cloud on load
  await syncPull();

  // Start periodic pull
  _syncPullTimer = setInterval(() => {
    if (navigator.onLine) syncPull();
  }, SYNC_PULL_INTERVAL);

  // Update sync indicator
  _updateSyncIndicator('idle');
}

/* ══════════════════════════════════════════════
   PUSH — called after every persistState()
══════════════════════════════════════════════ */
function scheduleSyncPush() {
  if (!_syncInitialised) return;
  if (!navigator.onLine) return;

  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(() => {
    syncPush().then(() => pruneSyncLog());
  }, SYNC_DEBOUNCE_MS);
}

async function syncPush() {
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId || !navigator.onLine) return;

  _syncPending = true;
  _updateSyncIndicator('syncing');

  try {
    const now = new Date().toISOString();

    // Build the sync payload — only the fields that change frequently
    // and need to be shared across devices
    const payload = {
      tenant_id:   tenantId,
      device_id:   _deviceId,
      sync_version: SYNC_VERSION,
      pushed_at:   now,

      // Append-only collections — we send the full array since last sync
      // The server keeps all records (no last-write-wins needed)
      sales:               APP_STATE.sales               || [],
      auditLog:            APP_STATE.auditLog            || [],
      inventoryMovements:  APP_STATE.inventoryMovements  || [],

      // Last-write-wins collections — stamped with updated_at
      products:            (APP_STATE.products     || []).map(_stamp),
      ingredients:         (APP_STATE.ingredients  || []).map(_stamp),
      finishedGoods:       (APP_STATE.finishedGoods || []).map(_stamp),

      // Config
      settings:            { ...(APP_STATE.settings || {}), _updated: now },
      categories:          APP_STATE.categories || [],

      // Supply
      supplyOrders:        (APP_STATE.supplyOrders     || []).map(_stamp),
      supplierClients:     (APP_STATE.supplierClients  || []).map(_stamp),

      // Production
      productionJobs:      (APP_STATE.productionJobs   || []).map(_stamp),
      productionTemplates: (APP_STATE.productionTemplates || []).map(_stamp),

      // Coffee Cart
      events:              (APP_STATE.events        || []).map(_stamp),
      eventPackages:       (APP_STATE.eventPackages || []).map(_stamp),
      leads:               (APP_STATE.leads         || []).map(_stamp),

      // Misc
      recipeCatalog:       (APP_STATE.recipeCatalog || []).map(_stamp),
      labDrafts:           (APP_STATE.labDrafts     || []).map(_stamp),
      receiptCounter:      APP_STATE.receiptCounter || 0,
      supplyInvoiceCounter: APP_STATE.supplyInvoiceCounter || 0,
    };

    const res = await fetch(`${CAFLAT_SB_URL}/rest/v1/sync_log`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 120)}`);
    }

    _lastSyncAt   = now;
    _lastSyncError = null;
    _syncPending  = false;
    _updateSyncIndicator('synced');

  } catch(e) {
    _lastSyncError = e.message;
    _syncPending   = false;
    _updateSyncIndicator('error');
    if (!_syncErrorNotified && typeof showNotification === 'function') {
      _syncErrorNotified = true;
      showNotification('Sync error — ' + e.message.slice(0, 100), 'error');
    }
    return { ok: false, error: e.message };
  }
  _syncErrorNotified = false; // reset so next failure notifies again
  return { ok: true };
}

/* ══════════════════════════════════════════════
   PULL — merge remote state into local
══════════════════════════════════════════════ */
async function syncPull() {
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId || !navigator.onLine) return;

  try {
    // Get the most recent push from ANY other device
    const res = await fetch(
      `${CAFLAT_SB_URL}/rest/v1/sync_log` +
      `?tenant_id=eq.${tenantId}` +
      `&device_id=neq.${_deviceId}` +
      `&order=pushed_at.desc&limit=1`,
      {
        headers: {
          'apikey':        CAFLAT_SB_ANON,
          'Authorization': `Bearer ${CAFLAT_SB_ANON}`
        }
      }
    );

    if (!res.ok) return;
    const rows = await res.json();
    if (!rows.length) return;

    const remote = rows[0];
    const remotePushedAt = new Date(remote.pushed_at);

    // Skip if we already have this or a newer version
    if (_lastSyncAt && new Date(_lastSyncAt) >= remotePushedAt) return;

    console.log('[Sync] Pull: merging from', remote.device_id?.slice(0,8), 'at', remote.pushed_at?.slice(11,19));
    _updateSyncIndicator('syncing');

    _mergeRemote(remote);
    _lastSyncAt = remote.pushed_at;
    _updateSyncIndicator('synced');

    // Re-render everything to show pulled changes
    if (typeof renderEverything === 'function') renderEverything();
    if (typeof refreshDashboard === 'function') refreshDashboard();

  } catch(e) {
    console.warn('[Sync] Pull error:', e.message);
  }
}

/* ══════════════════════════════════════════════
   MERGE — conflict resolution
══════════════════════════════════════════════ */
function _mergeRemote(remote) {
  // Append-only: merge by ID, keep all unique entries
  _mergeAppendOnly('sales',              remote.sales);
  _mergeAppendOnly('auditLog',           remote.auditLog);
  _mergeAppendOnly('inventoryMovements', remote.inventoryMovements);

  // Last-write-wins: keep whichever record has a newer updated_at
  _mergeLastWrite('products',            remote.products);
  _mergeLastWrite('ingredients',         remote.ingredients);
  _mergeLastWrite('finishedGoods',       remote.finishedGoods);
  _mergeLastWrite('supplyOrders',        remote.supplyOrders);
  _mergeLastWrite('supplierClients',     remote.supplierClients);
  _mergeLastWrite('productionJobs',      remote.productionJobs);
  _mergeLastWrite('productionTemplates', remote.productionTemplates);
  _mergeLastWrite('events',              remote.events);
  _mergeLastWrite('eventPackages',       remote.eventPackages);
  _mergeLastWrite('leads',               remote.leads);
  _mergeLastWrite('recipeCatalog',       remote.recipeCatalog);
  _mergeLastWrite('labDrafts',           remote.labDrafts);

  // Settings: remote wins only if it's newer
  if (remote.settings?._updated) {
    const localUpdated = APP_STATE.settings?._updated
      ? new Date(APP_STATE.settings._updated) : new Date(0);
    if (new Date(remote.settings._updated) > localUpdated) {
      APP_STATE.settings = { ...APP_STATE.settings, ...remote.settings };
    }
  }

  // Categories: remote wins (simple override — rarely conflicts)
  if (Array.isArray(remote.categories) && remote.categories.length) {
    APP_STATE.categories = remote.categories;
  }

  // Counters: take the higher value
  if (typeof remote.receiptCounter === 'number') {
    APP_STATE.receiptCounter = Math.max(
      APP_STATE.receiptCounter || 0, remote.receiptCounter
    );
  }
  if (typeof remote.supplyInvoiceCounter === 'number') {
    APP_STATE.supplyInvoiceCounter = Math.max(
      APP_STATE.supplyInvoiceCounter || 0, remote.supplyInvoiceCounter
    );
  }

  // Persist merged state locally (without triggering another push)
  _persistWithoutSync();
}

function _mergeAppendOnly(key, remoteArr) {
  if (!Array.isArray(remoteArr)) return;
  const local = Array.isArray(APP_STATE[key]) ? APP_STATE[key] : [];
  const localIds = new Set(local.map(r => r.id));
  const newEntries = remoteArr.filter(r => r?.id && !localIds.has(r.id));
  if (newEntries.length) {
    APP_STATE[key] = [...local, ...newEntries];
  }
}

function _mergeLastWrite(key, remoteArr) {
  if (!Array.isArray(remoteArr)) return;
  const local = Array.isArray(APP_STATE[key]) ? APP_STATE[key] : [];
  const localMap = new Map(local.map(r => [r.id, r]));

  remoteArr.forEach(remoteItem => {
    if (!remoteItem?.id) return;
    const localItem = localMap.get(remoteItem.id);
    if (!localItem) {
      // New item from remote — add it
      localMap.set(remoteItem.id, remoteItem);
    } else {
      // Conflict — newer updated_at wins
      const remoteTime = new Date(remoteItem.updatedAt || remoteItem.updated_at || 0);
      const localTime  = new Date(localItem.updatedAt  || localItem.updated_at  || 0);
      if (remoteTime > localTime) {
        localMap.set(remoteItem.id, remoteItem);
      }
    }
  });

  APP_STATE[key] = Array.from(localMap.values());
}

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */
function _stamp(item) {
  if (!item) return item;
  if (!item.updatedAt && !item.updated_at) {
    return { ...item, updatedAt: new Date().toISOString() };
  }
  return item;
}

let _skipNextPush = false;

function _persistWithoutSync() {
  _skipNextPush = true;
  if (typeof persistState === 'function') persistState();
}

/* Called by storage.js persistState() */
function onPersistState() {
  if (_skipNextPush) {
    _skipNextPush = false;
    return;
  }
  scheduleSyncPush();
}

/* ── Sync status indicator in header ── */
function _updateSyncIndicator(state) {
  let indicator = document.getElementById('syncIndicator');
  if (!indicator) {
    const header = document.querySelector('header > div');
    if (!header) return;
    indicator = document.createElement('div');
    indicator.id = 'syncIndicator';
    indicator.style.cssText = `display:flex;align-items:center;gap:5px;padding:3px 9px;
      border-radius:999px;font-size:9px;font-weight:800;letter-spacing:.5px;cursor:default;`;
    indicator.title = 'Cloud Sync';
    header.appendChild(indicator);
  }

  const STATES = {
    idle:    { dot:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', text:'SYNCED',   textColor:'#15803d' },
    syncing: { dot:'#2563eb', bg:'#eff6ff', border:'#bfdbfe', text:'SYNCING…', textColor:'#1d4ed8' },
    synced:  { dot:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', text:'SYNCED',   textColor:'#15803d' },
    error:   { dot:'#dc2626', bg:'#fef2f2', border:'#fecaca', text:'SYNC ERR', textColor:'#dc2626' },
    offline: { dot:'#9ca3af', bg:'#f9fafb', border:'#e5e7eb', text:'OFFLINE',  textColor:'#6b7280' },
  };

  const s = STATES[state] || STATES.idle;
  indicator.style.background  = s.bg;
  indicator.style.border      = `1px solid ${s.border}`;
  indicator.style.color       = s.textColor;
  indicator.innerHTML = `
    <div style="width:7px;height:7px;border-radius:50%;background:${s.dot};flex-shrink:0;
      ${state==='syncing'?'animation:offlinePulse 1s ease-in-out infinite;':''}"></div>
    <span>${s.text}</span>`;

  if (state === 'error' && _lastSyncError) {
    indicator.title = _lastSyncError;
  } else if (_lastSyncAt && state === 'synced') {
    const t = new Date(_lastSyncAt).toLocaleTimeString('en-PH',
      {hour:'numeric',minute:'2-digit',hour12:true});
    indicator.title = `Last synced ${t}`;
  }

  // Tap the error indicator to see the full message as a notification
  if (state === 'error') {
    indicator.style.cursor = 'pointer';
    indicator.onclick = () => {
      if (_lastSyncError) showNotification(_lastSyncError, 'error');
    };
  } else {
    indicator.style.cursor = 'default';
    indicator.onclick = null;
  }
}

/* Prune old sync_log entries — keep last 20 per tenant */
async function pruneSyncLog() {
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) return;
  try {
    const listRes = await fetch(
      `${CAFLAT_SB_URL}/rest/v1/sync_log?tenant_id=eq.${tenantId}&select=id,pushed_at&order=pushed_at.desc`,
      { headers: { 'apikey': CAFLAT_SB_ANON, 'Authorization': `Bearer ${CAFLAT_SB_ANON}` } }
    );
    if (!listRes.ok) return;
    const all = await listRes.json();
    const toDelete = all.slice(20); // keep newest 20
    for (const row of toDelete) {
      await fetch(`${CAFLAT_SB_URL}/rest/v1/sync_log?id=eq.${row.id}`, {
        method: 'DELETE',
        headers: { 'apikey': CAFLAT_SB_ANON, 'Authorization': `Bearer ${CAFLAT_SB_ANON}` }
      });
    }
  } catch(e) { /* silent */ }
}

/* Manual sync trigger from Settings */
async function syncNow() {
  if (!_syncInitialised) {
    showNotification('Cloud sync requires a CLOUD or ENTERPRISE license', 'error');
    return;
  }
  const pushResult = await syncPush();
  if (pushResult && !pushResult.ok) {
    showNotification('Sync failed: ' + pushResult.error, 'error');
    return;
  }
  await syncPull();
  pruneSyncLog();
  showNotification('Synced successfully', 'success');
}

/* ── Exports ── */
window.initSyncEngine   = initSyncEngine;
window.syncPush         = syncPush;
window.syncPull         = syncPull;
window.syncNow          = syncNow;
window.onPersistState   = onPersistState;
window.scheduleSyncPush = scheduleSyncPush;
