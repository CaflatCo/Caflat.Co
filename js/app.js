/* ═══════════════════════════════════════════════════════
   APP.JS — Bootstrap, render lifecycle, navigation
═══════════════════════════════════════════════════════ */

function _checkHttps() {
  const isSecure = location.protocol === 'https:' ||
                   location.hostname === 'localhost' ||
                   location.hostname === '127.0.0.1';
  if (isSecure) return;
  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:fixed;top:0;left:0;right:0;z-index:99999',
    'background:#dc2626;color:#fff;text-align:center',
    'padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:.02em',
  ].join(';');
  banner.textContent = '⚠ Not secure (HTTP) — license security features are disabled. Use HTTPS.';
  document.body.prepend(banner);
}

async function initializeApp() {
  _checkHttps();
  try {
    if (typeof restorePersistedState === 'function') restorePersistedState();
    // Load license from local storage before first render so applyLicenseTier()
    // sees the correct tier (not null) and doesn't hide pro features.
    if (typeof initializeLicenseFast === 'function') await initializeLicenseFast();
    if (typeof initializeAuth === 'function') initializeAuth();
    if (typeof initializeUIActions === 'function') initializeUIActions();
    if (typeof initializeSales === 'function') initializeSales();
    if (typeof initializeSalesCompatibility === 'function') initializeSalesCompatibility();

    renderEverything();
    bindGlobalEvents();
    bindNavigation();
    bindCheckoutInputs();
    bindModalClose();
    bindSearchFilters();
    setDefaultView();

    // Network validation (Supabase revalidation) runs in background after app is ready
    if (typeof initializeLicense === 'function') initializeLicense();

    // Cloud niceties: silent daily backup + settings widgets
    if (typeof initAutoCloudBackup          === 'function') initAutoCloudBackup();
    if (typeof renderBackupStatusChips      === 'function') renderBackupStatusChips();
    if (typeof renderRemoteDashboardSection === 'function') renderRemoteDashboardSection();

    console.log('Caflat.CORE v1 initialized');
  } catch (error) {
    console.error('Initialization failed', error);
    showNotification('App initialization failed', 'error');
  }
}

function renderEverything() {
  const renderCalls = [
    'renderCategoryTabs',
    'renderOrderTypeTabs',
    'renderProductsTable',
    'renderPOSProducts',
    'renderIngredientsTable',
    'renderInventoryTable',
    'renderFinishedGoodsTable',
    'renderInventoryMovementLog',
    'applyRecipeCatalogToggle',
    'applyShoppingListToggle',
    'applyLicenseTier',
    'renderSalesTable',
    'renderCategories',
    'renderCategoryOptions',
    'renderIngredientDropdowns',
    'renderLowStockAlerts',
    'renderBranding',
    'renderAuditLog',
    'renderIntegrityReport',
    'renderSupplyView',
    'renderClientsList',
    'renderPaymentMethodsList',
    'renderCheckoutPaymentOptions',
    'renderStorageUsage',
    'applySupplierModeToggle',
    'applyCoffeeCartModeToggle',
    'applyEventPickerButton',
    'renderCoffeeCartView',
    'applyProductionModeToggle',
    'renderProductionView',
    'applyProductLabModeToggle',
    'applyRecipeCatalogToggle',
    'applyShoppingListToggle',
    'applyLicenseTier',
    'renderLabDraftsList',
    'renderLabPresetsList',
    'applySupplierCartButton',
    'applyOriginModeToggle',
    'renderOriginDashboard',
    'applyTreasuryModeToggle',
    'applyDailyCloseToggle',
    'applyCurrencyToUI',
    'renderCostLab',
    'renderCart',
    'refreshDashboard',
    'updateNavBadges',
  ];

  renderCalls.forEach(fn => {
    if (typeof window[fn] === 'function') {
      try { window[fn](); }
      catch (e) { console.error(`Failed: ${fn}`, e); }
    }
  });
}

function bindGlobalEvents() {
  const productSearch = document.getElementById('productSearch');
  if (productSearch) {
    productSearch.addEventListener('input', () => {
      if (typeof renderProductsTable === 'function') renderProductsTable();
    });
  }

  const ingredientSearch = document.getElementById('ingredientSearch');
  if (ingredientSearch) {
    ingredientSearch.addEventListener('input', () => {
      if (typeof renderIngredientsTable === 'function') renderIngredientsTable();
    });
  }

  const inventorySearch = document.getElementById('inventorySearch');
  if (inventorySearch) {
    inventorySearch.addEventListener('input', () => {
      if (typeof renderInventoryTable === 'function') renderInventoryTable();
    });
  }

  const receiptUrlInput = document.getElementById('settingsReceiptUrl');
  if (receiptUrlInput) {
    receiptUrlInput.addEventListener('input', () => {
      if (typeof _updateReceiptUrlPreview === 'function') _updateReceiptUrlPreview();
    });
  }

  // Void PIN live dot feedback
  const voidPinInput = document.getElementById('voidPin');
  if (voidPinInput) {
    voidPinInput.addEventListener('input', () => {
      if (typeof renderPinDots === 'function') renderPinDots(voidPinInput.value);
    });
    voidPinInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (typeof confirmVoid === 'function') confirmVoid(); }
    });
  }

  const categoryFilter = document.getElementById('productCategoryFilter');
  if (categoryFilter) {
    categoryFilter.addEventListener('change', () => {
      if (typeof renderProductsTable === 'function') renderProductsTable();
    });
  }
}

function bindSearchFilters() {
  const filters = [
    ['productSearch', 'input'],
    ['productCategoryFilter', 'change']
  ];
  filters.forEach(([id, evt]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(evt, () => {
      if (typeof renderProductsTable === 'function') renderProductsTable();
    });
  });
}

/* Delegated on document, not attached per-overlay: most .modal-overlay
   elements (Order Portal, Origin, Treasury, coffeecart, etc.) are built by
   document.createElement() the first time their modal opens, long after
   this function's one-time querySelectorAll() ran at startup — so a
   per-element listener never reached them and tapping outside did nothing.
   Delegation covers every overlay that exists now or gets created later. */
function bindModalClose() {
  document.addEventListener('click', event => {
    if (!event.target.classList.contains('modal-overlay')) return;
    if (!event.target.classList.contains('active')) return;
    closeModal(event.target.id);
  });
}

function bindCheckoutInputs() {
  const tenderedEl = document.getElementById('checkoutTendered');
  if (tenderedEl) tenderedEl.addEventListener('input', calculateChange);

  const paymentEl = document.getElementById('checkoutPayment');
  if (paymentEl) paymentEl.addEventListener('change', togglePaymentFields);
}

function bindNavigation() {
  document.querySelectorAll('[data-view], [data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view || btn.dataset.page || '';
      if (target) switchPage(target);
    });
  });
}

function normalizeTarget(target) {
  return String(target || '').trim().replace(/^view-/, '');
}

function switchPage(target) {
  const cleanTarget = normalizeTarget(target);
  if (!cleanTarget) return;

  // Tier gate: locked views open the upgrade prompt instead of the screen
  const gate = (typeof TIER_GATED_VIEWS !== 'undefined') ? TIER_GATED_VIEWS[cleanTarget] : null;
  if (gate && typeof requireTier === 'function' && !requireTier(gate[0], gate[1])) return;

  updateState('ui', current => ({ ...current, currentView: cleanTarget }));

  document.querySelectorAll('.view, .page').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('[data-view], [data-page]').forEach(b => b.classList.remove('active'));

  const targetSection =
    document.getElementById(`view-${cleanTarget}`) ||
    document.getElementById(cleanTarget);
  if (targetSection) targetSection.classList.add('active');

  const activeButton =
    document.querySelector(`[data-view="${cleanTarget}"]`) ||
    document.querySelector(`[data-page="${cleanTarget}"]`);
  if (activeButton) activeButton.classList.add('active');

  // Trigger chart re-render on dashboard/reports switch
  if (cleanTarget === 'dashboard' && typeof refreshDashboard  === 'function') refreshDashboard();
  if (cleanTarget === 'foresight' && typeof renderForesight   === 'function') renderForesight();
  if (cleanTarget === 'reports'   && typeof renderReports      === 'function') renderReports();
  if (cleanTarget === 'supply'    && typeof renderSupplyView      === 'function') renderSupplyView();
  if (cleanTarget === 'coffeecart' && typeof renderCoffeeCartView === 'function') renderCoffeeCartView();
  if (cleanTarget === 'lab' && typeof renderLabView === 'function') renderLabView();
  if (cleanTarget === 'recipes') {
    if (typeof renderRecipeCatalog === 'function') renderRecipeCatalog();
    const openRecipesBtn = document.getElementById('openRecipesBtn');
    if (openRecipesBtn) openRecipesBtn.textContent = '← Back to Products';
    // Detail/form are modals now — make sure neither is left open on entry
    if (typeof closeModal === 'function') {
      closeModal('recipeDetailModal');
      closeModal('recipeFormModal');
    }
  }
  if (cleanTarget === 'products') {
    const openRecipesBtn = document.getElementById('openRecipesBtn');
    if (openRecipesBtn) openRecipesBtn.textContent = 'Recipes ↗';
  }
  if (cleanTarget === 'production' && typeof renderProductionView === 'function') renderProductionView();
  if (cleanTarget === 'origin'     && typeof renderOriginView    === 'function') renderOriginView();
  if (cleanTarget === 'treasury'   && typeof renderTreasuryView  === 'function') renderTreasuryView();
  if (cleanTarget === 'costlab'    && typeof renderCostLab        === 'function') renderCostLab();
  if (cleanTarget === 'settings'   && typeof renderCloudBackupList === 'function') renderCloudBackupList();
  if (cleanTarget === 'inventory') {
    if (typeof renderInventoryTable      === 'function') renderInventoryTable();
    if (typeof renderFinishedGoodsTable  === 'function') renderFinishedGoodsTable();
    if (typeof renderInventoryMovementLog=== 'function') renderInventoryMovementLog();
    if (typeof renderLowStockAlerts      === 'function') renderLowStockAlerts();
  }
}

function setDefaultView() {
  const currentView = APP_STATE.ui?.currentView || 'pos';
  switchPage(currentView);
}

document.addEventListener('DOMContentLoaded', initializeApp);

window.initializeApp   = initializeApp;
window.renderEverything= renderEverything;
window.bindGlobalEvents= bindGlobalEvents;
window.bindSearchFilters=bindSearchFilters;
window.bindModalClose  = bindModalClose;
window.bindCheckoutInputs=bindCheckoutInputs;
window.bindNavigation  = bindNavigation;
window.switchPage      = switchPage;
window.switchView      = switchPage;

/* ═══════════════════════════════════════════════════════
   OFFLINE INDICATOR
═══════════════════════════════════════════════════════ */
function _updateOfflineIndicator() {
  const indicator = document.getElementById('offlineIndicator');
  if (!indicator) return;
  indicator.style.display = navigator.onLine ? 'none' : 'flex';
}

window.addEventListener('online',  _updateOfflineIndicator);
window.addEventListener('offline', _updateOfflineIndicator);

// Also check on init
document.addEventListener('DOMContentLoaded', () => {
  _updateOfflineIndicator();
});

/* ── Sidebar ops group visibility ── */
function updateOpsNavGroup() {
  const group = document.getElementById('navOpsGroup');
  if (!group) return;
  const ids = ['navSupply', 'navProduction', 'navCoffeeCart', 'navOrigin', 'navTreasury'];
  const anyVisible = ids.some(id => {
    const el = document.getElementById(id);
    return el && el.style.display !== 'none';
  });
  group.style.display = anyVisible ? '' : 'none';
}
window.updateOpsNavGroup = updateOpsNavGroup;

/* ═══════════════════════════════════════════════════════
   SIDEBAR COLLAPSE
═══════════════════════════════════════════════════════ */
const SIDEBAR_KEY = 'caflat_sidebar_collapsed';

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.toggle('collapsed');
  try { localStorage.setItem(SIDEBAR_KEY, isCollapsed ? '1' : '0'); } catch(e) {}
}

function initSidebarState() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  // On mobile/portrait default to collapsed
  const isMobile = window.innerWidth <= 768;
  const stored   = localStorage.getItem(SIDEBAR_KEY);
  const shouldCollapse = stored !== null ? stored === '1' : isMobile;
  if (shouldCollapse) sidebar.classList.add('collapsed');
}

window.toggleSidebar    = toggleSidebar;
window.initSidebarState = initSidebarState;

// Init on load
document.addEventListener('DOMContentLoaded', initSidebarState);
