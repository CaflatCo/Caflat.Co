/* ═══════════════════════════════════════════════════════
   STORAGE.JS — Persistence, import/export
═══════════════════════════════════════════════════════ */

const STORAGE_KEY = 'caflat_pos_v1';

function getPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load persisted state', error);
    return null;
  }
}

function persistState() {
  try {
    // Enforce data caps to prevent localStorage overflow
    if (Array.isArray(APP_STATE.sales) && APP_STATE.sales.length > 500)
      APP_STATE.sales = APP_STATE.sales.slice(-500);
    if (Array.isArray(APP_STATE.auditLog) && APP_STATE.auditLog.length > 1000)
      APP_STATE.auditLog = APP_STATE.auditLog.slice(-1000);
    if (Array.isArray(APP_STATE.inventoryMovements) && APP_STATE.inventoryMovements.length > 1000)
      APP_STATE.inventoryMovements = APP_STATE.inventoryMovements.slice(-1000);
    if (Array.isArray(APP_STATE.fgMovements) && APP_STATE.fgMovements.length > 500)
      APP_STATE.fgMovements = APP_STATE.fgMovements.slice(-500);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings:           APP_STATE.settings,
      receiptCounter:     APP_STATE.receiptCounter,
      products:           APP_STATE.products,
      ingredients:        APP_STATE.ingredients,
      sales:              APP_STATE.sales,
      categories:         APP_STATE.categories,
      finishedGoods:      APP_STATE.finishedGoods,
      fgMovements:        APP_STATE.fgMovements,
      heldOrders:         APP_STATE.heldOrders,
      inventoryMovements: APP_STATE.inventoryMovements,
      auditLog:           APP_STATE.auditLog,
      supplyOrders:        APP_STATE.supplyOrders,
      supplierClients:     APP_STATE.supplierClients,
      supplyInvoiceCounter:APP_STATE.supplyInvoiceCounter,
      stockReservations:   APP_STATE.stockReservations,
      events:              APP_STATE.events,
      activeEvent:         APP_STATE.activeEvent,
      eventPackages:       APP_STATE.eventPackages,
      leads:               APP_STATE.leads,
      labDrafts:           APP_STATE.labDrafts,
      labCategoryPresets:  APP_STATE.labCategoryPresets,
      recipeCatalog:       APP_STATE.recipeCatalog,
      shoppingLists:       APP_STATE.shoppingLists,
      productionJobs:      APP_STATE.productionJobs,
      laborPeople:         APP_STATE.laborPeople,
      productionTemplates: APP_STATE.productionTemplates,
      originLots:               APP_STATE.originLots,
      originBatches:            APP_STATE.originBatches,
      originProcessingProfiles: APP_STATE.originProcessingProfiles,
      originOrders:             APP_STATE.originOrders,
      originClients:            APP_STATE.originClients,
      originOrderCounter:       APP_STATE.originOrderCounter,
      costLabSettings:          APP_STATE.costLabSettings,
      costLabOverrides:         APP_STATE.costLabOverrides,
      costHistory:              APP_STATE.costHistory,
      treasuryAccounts:         APP_STATE.treasuryAccounts,
      treasuryTransactions:     APP_STATE.treasuryTransactions,
      dayCloses:                APP_STATE.dayCloses
    }));
    if (typeof _checkStorageWarning === 'function') _checkStorageWarning();
    // Notify sync engine
    if (typeof onPersistState === 'function') onPersistState();
    // Keep the remote dashboard's daily KPI row fresh (throttled)
    if (typeof scheduleKpiSnapshotPush === 'function') scheduleKpiSnapshotPush();
  } catch (error) {
    console.error('Failed to persist state', error);
    // Quota exhaustion is silent otherwise — the operator keeps trading
    // against state that is no longer being saved, and loses it on reload.
    // Gated so unrelated serialisation errors don't spam them mid-service.
    const quotaHit = error && (error.name === 'QuotaExceededError'
      || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22);
    if (quotaHit && typeof showNotification === 'function') {
      showNotification('Storage full — changes are NOT being saved. Export a backup and archive old data now.', 'error');
    }
  }
}

function restorePersistedState() {
  const persisted = getPersistedState();
  if (!persisted) return;

  // Merge settings carefully so new keys get defaults if missing from older backups
  APP_STATE.settings = Object.assign({
    brandName: 'Caflat.CORE',
    taxRate: 0,
    receiptFooter: 'Thank you for choosing Caflat.CORE',
    currency: 'PHP',
    orderTypes: ['Dine In', 'Take Out', 'Delivery'],
    lowStockThreshold: 5,
    voidPin: '000000',
    supplierModeEnabled:   false,
    coffeeCartModeEnabled: false,
    productionModeEnabled: false,
    productLabModeEnabled: false,
    recipeCatalogEnabled: false,
    shoppingListEnabled: false,
    paymentMethods: [],
    paymentQRImages: {},
    receiptBaseUrl: "",
    originModeEnabled: false,
    treasuryModeEnabled: false
  }, persisted.settings || {});

  APP_STATE.receiptCounter     = Number(persisted.receiptCounter || 0);
  APP_STATE.products           = Array.isArray(persisted.products)           ? persisted.products           : [];
  APP_STATE.ingredients        = Array.isArray(persisted.ingredients)        ? persisted.ingredients        : [];
  APP_STATE.sales              = Array.isArray(persisted.sales)              ? persisted.sales              : [];
  // Migrate categories from strings to objects if needed
  const rawCats = persisted.categories;
  if (Array.isArray(rawCats)) {
    APP_STATE.categories = rawCats.map(c => {
      if (typeof c === 'string') {
        return { id: 'cat-' + c.toLowerCase().replace(/\s+/g,'-'), name: c, inventoryMode: 'direct' };
      }
      return c;
    });
  }
  APP_STATE.finishedGoods      = Array.isArray(persisted.finishedGoods)      ? persisted.finishedGoods      : [];
  APP_STATE.fgMovements        = Array.isArray(persisted.fgMovements)        ? persisted.fgMovements        : [];
  APP_STATE.heldOrders         = Array.isArray(persisted.heldOrders)        ? persisted.heldOrders         : [];
  APP_STATE.inventoryMovements = Array.isArray(persisted.inventoryMovements) ? persisted.inventoryMovements : [];
  APP_STATE.auditLog             = Array.isArray(persisted.auditLog)           ? persisted.auditLog           : [];
  APP_STATE.supplyOrders         = Array.isArray(persisted.supplyOrders)       ? persisted.supplyOrders       : [];
  APP_STATE.supplierClients      = Array.isArray(persisted.supplierClients)    ? persisted.supplierClients    : [];
  APP_STATE.supplyInvoiceCounter = Number(persisted.supplyInvoiceCounter || 0);
  APP_STATE.stockReservations    = Array.isArray(persisted.stockReservations)
    ? persisted.stockReservations : [];
  APP_STATE.events               = Array.isArray(persisted.events)        ? persisted.events        : [];
  APP_STATE.activeEvent          = persisted.activeEvent || null;
  APP_STATE.eventPackages        = Array.isArray(persisted.eventPackages) ? persisted.eventPackages : [];
  APP_STATE.leads                = Array.isArray(persisted.leads)         ? persisted.leads         : [];
  APP_STATE.labDrafts            = Array.isArray(persisted.labDrafts)            ? persisted.labDrafts            : [];
  APP_STATE.labCategoryPresets   = Array.isArray(persisted.labCategoryPresets)   ? persisted.labCategoryPresets   : [];
  APP_STATE.recipeCatalog        = Array.isArray(persisted.recipeCatalog)        ? persisted.recipeCatalog        : [];
  APP_STATE.shoppingLists        = Array.isArray(persisted.shoppingLists)        ? persisted.shoppingLists        : [];
  APP_STATE.productionJobs       = Array.isArray(persisted.productionJobs)       ? persisted.productionJobs       : [];
  APP_STATE.laborPeople          = Array.isArray(persisted.laborPeople)          ? persisted.laborPeople          : [];
  APP_STATE.productionTemplates  = Array.isArray(persisted.productionTemplates)  ? persisted.productionTemplates  : [];
  APP_STATE.originLots               = Array.isArray(persisted.originLots)               ? persisted.originLots               : [];
  APP_STATE.originBatches            = Array.isArray(persisted.originBatches)            ? persisted.originBatches            : [];
  APP_STATE.originProcessingProfiles = Array.isArray(persisted.originProcessingProfiles) ? persisted.originProcessingProfiles : [];
  APP_STATE.originOrders             = Array.isArray(persisted.originOrders)             ? persisted.originOrders             : [];
  APP_STATE.originClients            = Array.isArray(persisted.originClients)            ? persisted.originClients            : [];
  APP_STATE.originOrderCounter       = Number(persisted.originOrderCounter || 0);
  APP_STATE.treasuryAccounts         = Array.isArray(persisted.treasuryAccounts)         ? persisted.treasuryAccounts         : [];
  APP_STATE.treasuryTransactions     = Array.isArray(persisted.treasuryTransactions)     ? persisted.treasuryTransactions     : [];
  APP_STATE.dayCloses                = Array.isArray(persisted.dayCloses)                ? persisted.dayCloses                : [];
  APP_STATE.costLabSettings  = Object.assign(
    { targetMargin: 60, laborCostPerUnit: 0, overheadCostPerUnit: 0 },
    persisted.costLabSettings || {}
  );
  APP_STATE.costLabOverrides = (persisted.costLabOverrides && typeof persisted.costLabOverrides === 'object')
    ? persisted.costLabOverrides : {};
  APP_STATE.costHistory      = Array.isArray(persisted.costHistory) ? persisted.costHistory : [];
}

/* ── Export full backup ── */
function exportAllData() {
  const data = {
    exportedAt: new Date().toISOString(),
    version: 'v1B',
    settings: APP_STATE.settings,
    receiptCounter: APP_STATE.receiptCounter,
    products: APP_STATE.products,
    ingredients: APP_STATE.ingredients,
    sales: APP_STATE.sales,
    categories:    APP_STATE.categories,
    finishedGoods: APP_STATE.finishedGoods,
    fgMovements:   APP_STATE.fgMovements,
    heldOrders: APP_STATE.heldOrders,
    inventoryMovements: APP_STATE.inventoryMovements,
    auditLog: APP_STATE.auditLog,
    supplyOrders: APP_STATE.supplyOrders,
    supplierClients: APP_STATE.supplierClients,
    supplyInvoiceCounter: APP_STATE.supplyInvoiceCounter,
    stockReservations: APP_STATE.stockReservations,
    events:            APP_STATE.events,
    activeEvent:       APP_STATE.activeEvent,
    eventPackages:     APP_STATE.eventPackages,
    leads:             APP_STATE.leads,
    labDrafts:         APP_STATE.labDrafts,
    labCategoryPresets:APP_STATE.labCategoryPresets,
    recipeCatalog:     APP_STATE.recipeCatalog,
    shoppingLists:     APP_STATE.shoppingLists,
    productionJobs:    APP_STATE.productionJobs,
    laborPeople:              APP_STATE.laborPeople,
    productionTemplates:      APP_STATE.productionTemplates,
    originLots:               APP_STATE.originLots,
    originBatches:            APP_STATE.originBatches,
    originProcessingProfiles: APP_STATE.originProcessingProfiles,
    originOrders:             APP_STATE.originOrders,
    originClients:            APP_STATE.originClients,
    originOrderCounter:       APP_STATE.originOrderCounter,
    treasuryAccounts:         APP_STATE.treasuryAccounts,
    treasuryTransactions:     APP_STATE.treasuryTransactions,
    dayCloses:                APP_STATE.dayCloses
  };
  downloadTextFile(`caflat-backup-${Date.now()}.json`, JSON.stringify(data, null, 2));
  showNotification('Backup exported', 'success');
}

/* ── Import backup ── */
function importAllData(file) {
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const data = JSON.parse(event.target.result);
      if (typeof data !== 'object' || data === null) {
        showNotification('Invalid backup file — not a Caflat backup', 'error');
        return;
      }
      // Accept if it has ANY recognisable Caflat field
      const hasRecognisedField = data.products !== undefined
        || data.ingredients !== undefined
        || data.sales !== undefined
        || data.settings !== undefined
        || data.categories !== undefined;
      if (!hasRecognisedField) {
        showNotification('Invalid backup file — not a Caflat backup', 'error');
        return;
      }
      if (!confirm('This will replace all current data. Continue?')) return;

      APP_STATE.settings           = Object.assign({
        brandName: 'Caflat.CORE', taxRate: 0,
        receiptFooter: 'Thank you for choosing Caflat.CORE',
        currency: 'PHP', orderTypes: ['Dine In', 'Take Out', 'Delivery'],
        lowStockThreshold: 5, voidPin: '000000',
        supplierModeEnabled:   false,
        coffeeCartModeEnabled: false,
        productionModeEnabled: false,
        productLabModeEnabled: false,
    recipeCatalogEnabled: false,
    shoppingListEnabled: false,
        paymentMethods: [],
        paymentQRImages: {},
    receiptBaseUrl: "",
    originModeEnabled: false,
    treasuryModeEnabled: false
      }, data.settings || {});
      APP_STATE.receiptCounter     = Number(data.receiptCounter || 0);
      APP_STATE.products           = Array.isArray(data.products)           ? data.products           : [];
      APP_STATE.ingredients        = Array.isArray(data.ingredients)        ? data.ingredients        : [];
      APP_STATE.sales              = Array.isArray(data.sales)              ? data.sales              : [];
      // Migrate imported categories from strings to objects if needed
      if (Array.isArray(data.categories)) {
        APP_STATE.categories = data.categories.map(c => {
          if (typeof c === 'string') {
            return { id: 'cat-' + c.toLowerCase().replace(/\s+/g,'-'), name: c, inventoryMode: 'direct' };
          }
          return c;
        });
      }
      APP_STATE.finishedGoods      = Array.isArray(data.finishedGoods)      ? data.finishedGoods      : [];
      APP_STATE.fgMovements        = Array.isArray(data.fgMovements)        ? data.fgMovements        : [];
      APP_STATE.heldOrders         = Array.isArray(data.heldOrders)         ? data.heldOrders         : [];
      APP_STATE.inventoryMovements = Array.isArray(data.inventoryMovements) ? data.inventoryMovements : [];
      APP_STATE.auditLog             = Array.isArray(data.auditLog)           ? data.auditLog           : [];
      APP_STATE.supplyOrders         = Array.isArray(data.supplyOrders)       ? data.supplyOrders       : [];
      APP_STATE.supplierClients      = Array.isArray(data.supplierClients)    ? data.supplierClients    : [];
      APP_STATE.supplyInvoiceCounter = Number(data.supplyInvoiceCounter || 0);
      APP_STATE.stockReservations    = Array.isArray(data.stockReservations)
        ? data.stockReservations : [];
      APP_STATE.events               = Array.isArray(data.events)              ? data.events              : [];
      APP_STATE.activeEvent          = data.activeEvent || null;
      APP_STATE.eventPackages        = Array.isArray(data.eventPackages)       ? data.eventPackages       : [];
      APP_STATE.leads                = Array.isArray(data.leads)               ? data.leads               : [];
      APP_STATE.labDrafts            = Array.isArray(data.labDrafts)           ? data.labDrafts           : [];
      APP_STATE.labCategoryPresets   = Array.isArray(data.labCategoryPresets)  ? data.labCategoryPresets  : [];
      APP_STATE.recipeCatalog        = Array.isArray(data.recipeCatalog)       ? data.recipeCatalog       : [];
      APP_STATE.shoppingLists        = Array.isArray(data.shoppingLists)       ? data.shoppingLists       : [];
      APP_STATE.productionJobs       = Array.isArray(data.productionJobs)      ? data.productionJobs      : [];
      APP_STATE.laborPeople          = Array.isArray(data.laborPeople)         ? data.laborPeople         : [];
      APP_STATE.originLots               = Array.isArray(data.originLots)               ? data.originLots               : [];
      APP_STATE.originBatches            = Array.isArray(data.originBatches)            ? data.originBatches            : [];
      APP_STATE.originProcessingProfiles = Array.isArray(data.originProcessingProfiles) ? data.originProcessingProfiles : [];
      APP_STATE.originOrders             = Array.isArray(data.originOrders)             ? data.originOrders             : [];
      APP_STATE.originClients            = Array.isArray(data.originClients)            ? data.originClients            : [];
      APP_STATE.originOrderCounter       = Number(data.originOrderCounter || 0);
      APP_STATE.treasuryAccounts         = Array.isArray(data.treasuryAccounts)         ? data.treasuryAccounts         : [];
      APP_STATE.treasuryTransactions     = Array.isArray(data.treasuryTransactions)     ? data.treasuryTransactions     : [];
      APP_STATE.dayCloses                = Array.isArray(data.dayCloses)                ? data.dayCloses                : [];

      persistState();
      if (typeof renderEverything === 'function') renderEverything();
      showNotification('Backup imported successfully', 'success');
    } catch (err) {
      showNotification('Failed to import — invalid file', 'error');
    }
  };
  reader.readAsText(file);
}

/* ── Reset business data ── */

// Standard reset — wipes business data, keeps Lab presets + settings
function resetBusinessData() {
  if (typeof resetState === 'function') resetState();
  // Restore lab presets and settings after wipe (they survive standard reset)
  const preserved = {
    settings:           APP_STATE.settings,
    labCategoryPresets: APP_STATE.labCategoryPresets,
    laborPeople:        APP_STATE.laborPeople,
    recipeCatalog:      APP_STATE.recipeCatalog
  };
  localStorage.removeItem(STORAGE_KEY);
  // Re-apply preserved fields
  APP_STATE.settings           = preserved.settings;
  APP_STATE.labCategoryPresets = preserved.labCategoryPresets;
  APP_STATE.laborPeople        = preserved.laborPeople;
  APP_STATE.recipeCatalog      = preserved.recipeCatalog;
  if (typeof persistState === 'function') persistState();
  if (typeof renderEverything === 'function') renderEverything();
  showNotification('Business data reset — Lab presets and settings preserved', 'info');
}

// Full factory reset — wipes absolutely everything
function fullFactoryReset() {
  if (typeof resetState === 'function') resetState();
  // resetState() spares these so the standard reset can preserve them;
  // a factory reset promises to wipe everything, so drop them here.
  APP_STATE.labCategoryPresets = [];
  APP_STATE.laborPeople = [];
  APP_STATE.recipeCatalog = [];
  APP_STATE.settings = {
    brandName:            'Caflat.CORE',
    taxRate:              0,
    receiptFooter:        'Thank you for choosing Caflat.CORE',
    currency:             'PHP',
    orderTypes:           ['Dine In', 'Take Out', 'Delivery'],
    lowStockThreshold:    5,
    voidPin:              '000000',
    supplierModeEnabled:  false,
    coffeeCartModeEnabled: false,
    productionModeEnabled: false,
    productLabModeEnabled: false,
    recipeCatalogEnabled: false,
    shoppingListEnabled: false,
    paymentMethods: [],
    paymentQRImages: {},
    receiptBaseUrl: "",
    originModeEnabled: false,
    treasuryModeEnabled: false
  };
  localStorage.removeItem(STORAGE_KEY);
  if (typeof renderEverything === 'function') renderEverything();
  showNotification('Full factory reset complete', 'info');
}

window.getPersistedState    = getPersistedState;
window.persistState         = persistState;
window.restorePersistedState= restorePersistedState;
window.exportAllData        = exportAllData;
window.importAllData        = importAllData;
window.resetBusinessData    = resetBusinessData;
window.fullFactoryReset     = fullFactoryReset;

/* ─────────────────────────────────────────────
   STORAGE USAGE INDICATOR
   localStorage has no real quota API across browsers,
   so we use the universal safe baseline of 5MB that
   Safari, Chrome, Firefox, and Edge all guarantee at minimum.
───────────────────────────────────────────── */

const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB baseline
let _lastStorageWarningPct = 0;

function getStorageUsageBytes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Blob([raw]).size : 0;
  } catch (error) {
    return 0;
  }
}

function getStorageUsagePercent() {
  return Math.min(100, Math.round((getStorageUsageBytes() / STORAGE_QUOTA_BYTES) * 100));
}

function renderStorageUsage() {
  const bar   = document.getElementById('storageUsageBar');
  const label = document.getElementById('storageUsageLabel');
  const note  = document.getElementById('storageUsageNote');
  if (!bar || !label) return;

  const pct   = getStorageUsagePercent();
  const bytes = getStorageUsageBytes();
  const mb    = (bytes / (1024 * 1024)).toFixed(2);

  bar.style.width = `${pct}%`;
  label.textContent = `${pct}%`;

  if (pct >= 95) {
    bar.style.background = 'var(--danger)';
    label.style.color = 'var(--danger)';
  } else if (pct >= 80) {
    bar.style.background = 'var(--warning)';
    label.style.color = 'var(--warning)';
  } else {
    bar.style.background = 'var(--success)';
    label.style.color = 'var(--black)';
  }

  if (note) {
    note.textContent = pct >= 80
      ? `${mb} MB used — consider archiving older sales data soon.`
      : `${mb} MB used of ~5 MB available.`;
  }
}

function _checkStorageWarning() {
  const pct = getStorageUsagePercent();
  // Only fire once per threshold crossing per session, not on every save
  if (pct >= 80 && _lastStorageWarningPct < 80) {
    showNotification(`Storage is ${pct}% full — consider archiving data soon`, 'error');
  }
  _lastStorageWarningPct = pct;
  renderStorageUsage();
}

window.getStorageUsageBytes   = getStorageUsageBytes;
window.getStorageUsagePercent = getStorageUsagePercent;
window.renderStorageUsage     = renderStorageUsage;

/* ═══════════════════════════════════════════════════════
   CLOUD BACKUP — Supabase
   Requires: license.js loaded first (getTenantId, CAFLAT_SB_URL, CAFLAT_SB_ANON)
═══════════════════════════════════════════════════════ */

const CLOUD_BACKUP_LIMIT = 3; // keep last 3 cloud backups per tenant

async function cloudBackup(opts = {}) {
  const silent   = !!opts.silent;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  const tier     = typeof getLicenseTier === 'function' ? getLicenseTier() : null;
  const eligible = ['pro', 'cloud', 'enterprise', 'god'].includes(tier);

  if (!tenantId || !eligible) {
    if (!silent) {
      if (typeof requireTier === 'function') requireTier('pro', 'Cloud backup');
      else showNotification('Cloud backup requires a PRO license or higher', 'error');
    }
    return { success: false, error: 'Upgrade to PRO to use cloud backup.' };
  }

  const btn = document.getElementById('cloudBackupBtn');
  if (btn) { btn.textContent = 'Backing up…'; btn.disabled = true; }

  try {
    const snapshot = {
      exportedAt:           new Date().toISOString(),
      version:              'v1B',
      settings:             APP_STATE.settings,
      receiptCounter:       APP_STATE.receiptCounter,
      products:             APP_STATE.products,
      ingredients:          APP_STATE.ingredients,
      sales:                APP_STATE.sales,
      categories:           APP_STATE.categories,
      finishedGoods:        APP_STATE.finishedGoods,
      fgMovements:          APP_STATE.fgMovements,
      heldOrders:           APP_STATE.heldOrders,
      inventoryMovements:   APP_STATE.inventoryMovements,
      auditLog:             APP_STATE.auditLog,
      supplyOrders:         APP_STATE.supplyOrders,
      supplierClients:      APP_STATE.supplierClients,
      supplyInvoiceCounter: APP_STATE.supplyInvoiceCounter,
      stockReservations:    APP_STATE.stockReservations,
      events:               APP_STATE.events,
      activeEvent:          APP_STATE.activeEvent,
      eventPackages:        APP_STATE.eventPackages,
      leads:                APP_STATE.leads,
      labDrafts:            APP_STATE.labDrafts,
      labCategoryPresets:   APP_STATE.labCategoryPresets,
      recipeCatalog:        APP_STATE.recipeCatalog,
      shoppingLists:        APP_STATE.shoppingLists,
      productionJobs:       APP_STATE.productionJobs,
      laborPeople:          APP_STATE.laborPeople,
    };

    const deviceId = typeof _generateDeviceId === 'function'
      ? await _generateDeviceId() : 'unknown';

    // Insert new backup
    const res = await fetch(`${CAFLAT_SB_URL}/rest/v1/backups`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'return=representation',
        'x-tenant-id':  tenantId
      },
      body: JSON.stringify({
        tenant_id:   tenantId,
        snapshot,
        app_version: 'v1B',
        device_id:   deviceId
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase error: ${res.status} — ${err}`);
    }

    // Prune old backups — keep only the latest CLOUD_BACKUP_LIMIT
    const listRes = await fetch(
      `${CAFLAT_SB_URL}/rest/v1/backups?tenant_id=eq.${tenantId}&select=id,created_at&order=created_at.desc`,
      {
        headers: {
          'apikey':        CAFLAT_SB_ANON,
          'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
          'x-tenant-id':  tenantId
        }
      }
    );

    if (listRes.ok) {
      const all = await listRes.json();
      const toDelete = all.slice(CLOUD_BACKUP_LIMIT);
      for (const old of toDelete) {
        await fetch(`${CAFLAT_SB_URL}/rest/v1/backups?id=eq.${old.id}&tenant_id=eq.${tenantId}`, {
          method: 'DELETE',
          headers: {
            'apikey':        CAFLAT_SB_ANON,
            'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
            'x-tenant-id':  tenantId
          }
        });
      }
    }

    APP_STATE.settings.lastCloudBackupAt = new Date().toISOString();
    if (typeof persistState === 'function') persistState();
    renderBackupStatusChips();

    if (!silent) {
      const now = new Date().toLocaleString('en-PH', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      showNotification(`Backed up to cloud — ${now}`, 'success');
      renderCloudBackupList();
    }
    return { success: true };

  } catch (e) {
    console.error('Cloud backup failed:', e);
    if (!silent) showNotification('Cloud backup failed — check connection', 'error');
    renderBackupStatusChips(true);
    return { success: false, error: e.message };
  } finally {
    if (btn) { btn.textContent = 'Backup to Cloud'; btn.disabled = false; }
  }
}

async function cloudRestore(backupId) {
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) return;

  if (!confirm('Restore from this cloud backup? Current data will be replaced.')) return;

  try {
    const res = await fetch(
      `${CAFLAT_SB_URL}/rest/v1/backups?id=eq.${backupId}&tenant_id=eq.${tenantId}&select=snapshot`,
      {
        headers: {
          'apikey':        CAFLAT_SB_ANON,
          'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
          'x-tenant-id':  tenantId
        }
      }
    );

    if (!res.ok) throw new Error('Failed to fetch backup');
    const rows = await res.json();
    if (!rows.length) throw new Error('Backup not found');

    // Re-use the existing importAllData logic by feeding it the snapshot
    const snapshot = rows[0].snapshot;
    if (typeof importAllData === 'function') {
      // Create a fake File-like blob the importer can read
      const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
      const fakeFile = new File([blob], 'cloud-restore.json', { type: 'application/json' });
      importAllData(fakeFile);
    }
  } catch (e) {
    console.error('Cloud restore failed:', e);
    showNotification('Cloud restore failed — check connection', 'error');
  }
}

async function renderCloudBackupList() {
  const container = document.getElementById('cloudBackupList');
  if (!container) return;

  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) {
    container.innerHTML = `<div style="font-size:12px;color:var(--gray-400);">
      Activate a PRO license to enable cloud backups.</div>`;
    return;
  }

  container.innerHTML = `<div style="font-size:12px;color:var(--gray-400);">Loading…</div>`;

  try {
    const res = await fetch(
      `${CAFLAT_SB_URL}/rest/v1/backups?tenant_id=eq.${tenantId}&select=id,created_at,app_version,device_id&order=created_at.desc&limit=3`,
      {
        headers: {
          'apikey':        CAFLAT_SB_ANON,
          'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
          'x-tenant-id':  tenantId
        }
      }
    );

    if (!res.ok) throw new Error('Failed to fetch');
    const backups = await res.json();

    if (!backups.length) {
      container.innerHTML = `<div style="font-size:12px;color:var(--gray-400);">
        No cloud backups yet.</div>`;
      return;
    }

    container.innerHTML = backups.map(b => {
      const date = new Date(b.created_at).toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-lg);
          margin-bottom:8px;background:var(--white);">
          <div>
            <div style="font-size:12px;font-weight:700;">${date}</div>
            <div style="font-size:10px;color:var(--gray-400);">
              ${b.app_version || 'v1'}</div>
          </div>
          <button class="btn btn-sm btn-secondary" type="button"
            onclick="cloudRestore('${b.id}')">Restore</button>
        </div>`;
    }).join('');

  } catch (e) {
    container.innerHTML = `<div style="font-size:12px;color:var(--gray-400);">
      Could not load cloud backups.</div>`;
  }
}

window.cloudBackup           = cloudBackup;
window.cloudRestore          = cloudRestore;
window.renderCloudBackupList = renderCloudBackupList;

/* ═══════════════════════════════════════════════════════
   AUTO CLOUD BACKUP + KPI SNAPSHOTS + REMOTE DASHBOARD
   Silent daily backups, tiny per-day KPI rows for the
   phone-friendly remote page, and revocable share links.
═══════════════════════════════════════════════════════ */

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KPI_PUSH_INTERVAL_MS    = 10 * 60 * 1000;
let _autoBackupTimer = null;
let _lastKpiPush     = 0;
let _kpiPushQueued   = false;

function _cloudEligible() {
  const tier = typeof getLicenseTier === 'function' ? getLicenseTier() : 'free';
  return ['pro', 'cloud', 'enterprise', 'god'].includes(tier) &&
         typeof getTenantId === 'function' && !!getTenantId();
}

/* ── Status chips (Settings + Dashboard) ───────────── */
function renderBackupStatusChips(failed) {
  const chips = [
    document.getElementById('cloudBackupStatus'),
    document.getElementById('dashboardBackupStatus'),
  ].filter(Boolean);
  if (!chips.length) return;

  let text, color, bg;
  const last = Date.parse(APP_STATE.settings?.lastCloudBackupAt || '') || 0;
  if (!_cloudEligible()) {
    text = 'Cloud backup: PRO feature';
    color = 'var(--gray-500)'; bg = 'var(--gray-100)';
  } else if (failed) {
    text = 'Last backup attempt failed — will retry';
    color = '#dc2626'; bg = '#fef2f2';
  } else if (!last) {
    text = 'No cloud backup yet';
    color = '#b45309'; bg = '#fffbeb';
  } else {
    const ageMs = Date.now() - last;
    if (ageMs < 26 * 60 * 60 * 1000) {
      const h = Math.floor(ageMs / 3600000);
      const ago = h < 1 ? 'under an hour ago' : h === 1 ? '1 hour ago' : `${h} hours ago`;
      text = `Backed up ${ago} ✓`;
      color = '#15803d'; bg = '#f0fdf4';
    } else {
      text = 'Backup overdue';
      color = '#b45309'; bg = '#fffbeb';
    }
  }

  chips.forEach(el => {
    el.textContent = text;
    el.style.cssText += `;display:inline-block;font-size:10px;font-weight:700;
      padding:3px 10px;border-radius:999px;color:${color};background:${bg};`;
  });
}

/* ── Silent daily backup ───────────────────────────── */
async function maybeAutoCloudBackup() {
  try {
    if (!_cloudEligible()) { renderBackupStatusChips(); return; }
    const last = Date.parse(APP_STATE.settings?.lastCloudBackupAt || '') || 0;
    if (Date.now() - last < AUTO_BACKUP_INTERVAL_MS) { renderBackupStatusChips(); return; }
    const res = await cloudBackup({ silent: true });
    renderBackupStatusChips(!res?.success);
  } catch (e) {
    renderBackupStatusChips(true);
  }
}

function initAutoCloudBackup() {
  setTimeout(maybeAutoCloudBackup, 5000);
  if (!_autoBackupTimer) {
    _autoBackupTimer = setInterval(maybeAutoCloudBackup, 60 * 60 * 1000);
  }
}

/* ── KPI snapshot push (one tiny row per day) ──────── */
function _todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function _localDayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function pushKpiSnapshot() {
  if (!_cloudEligible()) return { success: false };
  if (typeof getRevenue !== 'function') return { success: false };
  const from = _todayStart();
  const kpi  = typeof getKPISummary === 'function' ? getKPISummary() : {};
  const top  = (typeof getTopProducts === 'function' ? getTopProducts(1, from) : [])[0];

  const row = {
    tenant_id:      getTenantId(),
    day:            _localDayString(),
    brand:          APP_STATE.settings?.brandName || 'Caflat.CORE',
    revenue:        Number(getRevenue(from).toFixed(2)),
    orders:         getOrderCount(from),
    items:          getItemsSold(from),
    avg_ticket:     Number((getAverageTicket(from) || 0).toFixed(2)),
    low_stock:      kpi.lowStockCount || 0,
    pending_orders: kpi.pendingOrders || 0,
    top_product:    top?.name || null,
    updated_at:     new Date().toISOString(),
  };

  const res = await fetch(
    `${CAFLAT_SB_URL}/rest/v1/kpi_snapshots?on_conflict=tenant_id,day`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    }
  );
  return { success: res.ok };
}

// Piggybacks on persistState: at most one push per 10 minutes, and only
// when a remote link exists (no link = nobody is watching).
function scheduleKpiSnapshotPush() {
  if (!_cloudEligible()) return;
  if (!APP_STATE.settings?.remoteDashboard) return;
  if (_kpiPushQueued) return;
  if (Date.now() - _lastKpiPush < KPI_PUSH_INTERVAL_MS) return;
  _kpiPushQueued = true;
  setTimeout(async () => {
    _kpiPushQueued = false;
    _lastKpiPush   = Date.now();
    try { await pushKpiSnapshot(); } catch (e) { /* silent — next save retries */ }
  }, 4000);
}

/* ── Remote dashboard share links ──────────────────── */
async function _sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function generateRemoteDashboardLink() {
  if (typeof requireTier === 'function' && !requireTier('pro', 'The Remote Dashboard')) return;
  const tenantId = getTenantId();
  if (!tenantId) { showNotification('No tenant on this license', 'error'); return; }

  const token = ((crypto.randomUUID?.() || '') + (crypto.randomUUID?.() || '')).replace(/-/g, '');
  const hash  = await _sha256Hex(token);

  const res = await fetch(`${CAFLAT_SB_URL}/rest/v1/remote_tokens`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        CAFLAT_SB_ANON,
      'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({ tenant_id: tenantId, token_hash: hash, label: 'Owner link' }),
  });
  if (!res.ok) {
    showNotification('Could not create remote link — run migration 011 in Supabase', 'error');
    return;
  }

  APP_STATE.settings.remoteDashboard = { token, hash, createdAt: new Date().toISOString() };
  persistState();
  try { await pushKpiSnapshot(); } catch (e) {}
  renderRemoteDashboardSection();
  showNotification('Remote Dashboard link created — open it on your phone', 'success');
}

async function revokeRemoteDashboardLink() {
  const rd = APP_STATE.settings?.remoteDashboard;
  if (!rd) return;
  try {
    await fetch(`${CAFLAT_SB_URL}/rest/v1/remote_tokens?token_hash=eq.${rd.hash}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ revoked: true }),
    });
  } catch (e) { /* revoke best-effort; local removal below always happens */ }
  delete APP_STATE.settings.remoteDashboard;
  persistState();
  renderRemoteDashboardSection();
  showNotification('Remote link revoked', 'success');
}

function getRemoteDashboardUrl() {
  const rd = APP_STATE.settings?.remoteDashboard;
  return rd ? `${location.origin}/remote.html#${rd.token}` : null;
}

function copyRemoteDashboardLink() {
  const url = getRemoteDashboardUrl();
  if (!url) return;
  navigator.clipboard?.writeText(url)
    .then(() => showNotification('Remote Dashboard link copied', 'success'))
    .catch(() => showNotification(url, 'info'));
}

function renderRemoteDashboardSection() {
  const box = document.getElementById('remoteDashboardBody');
  if (!box) return;
  const rd = APP_STATE.settings?.remoteDashboard;
  if (rd) {
    const url = getRemoteDashboardUrl();
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <code style="flex:1;min-width:180px;font-size:11px;background:var(--white);
          border:1.5px solid var(--border);border-radius:var(--radius-md);
          padding:8px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${url}</code>
        <button class="btn btn-secondary btn-sm" type="button" onclick="copyRemoteDashboardLink()">Copy</button>
        <button class="btn btn-secondary btn-sm" type="button"
          style="border-color:#fca5a5;color:#dc2626;" onclick="revokeRemoteDashboardLink()">Revoke</button>
      </div>
      <div style="font-size:10.5px;color:var(--gray-500);margin-top:8px;">
        Anyone with this link sees today's numbers (read-only). Revoke it anytime.
      </div>`;
  } else {
    const locked = typeof isProTier === 'function' && !isProTier();
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="font-size:11px;color:var(--gray-500);max-width:420px;">
          Check today's revenue, orders, and low stock from your phone — anywhere.
          Creates a private, revocable link. No login needed on the phone.
        </div>
        <button class="btn btn-secondary" type="button" onclick="generateRemoteDashboardLink()">
          Generate Link${locked ? ' <span style="font-size:8px;font-weight:900;padding:1px 6px;border-radius:999px;background:var(--black);color:#fff;letter-spacing:1px;vertical-align:middle;">PRO</span>' : ''}
        </button>
      </div>`;
  }
}

window.maybeAutoCloudBackup        = maybeAutoCloudBackup;
window.initAutoCloudBackup         = initAutoCloudBackup;
window.renderBackupStatusChips     = renderBackupStatusChips;
window.pushKpiSnapshot             = pushKpiSnapshot;
window.scheduleKpiSnapshotPush     = scheduleKpiSnapshotPush;
window.generateRemoteDashboardLink = generateRemoteDashboardLink;
window.revokeRemoteDashboardLink   = revokeRemoteDashboardLink;
window.copyRemoteDashboardLink     = copyRemoteDashboardLink;
window.getRemoteDashboardUrl       = getRemoteDashboardUrl;
window.renderRemoteDashboardSection = renderRemoteDashboardSection;
