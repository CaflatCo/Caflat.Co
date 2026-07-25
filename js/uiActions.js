/* ═══════════════════════════════════════════════════════
   UIACTIONS.JS — Single event system, all UI actions
═══════════════════════════════════════════════════════ */

function initializeUIActions() {
  bindPrimaryButtons();
  bindModalButtons();
  bindImportExport();
  bindVariantBuilder();
  bindRecipeBuilder();
  bindDelegatedActions();
  bindPOSSearch();
  bindSupplyFilters();
  if (typeof bindLeadFilters         === 'function') bindLeadFilters();
  if (typeof bindProductionFilters   === 'function') bindProductionFilters();
  if (typeof bindRecipeCatalogFilters=== 'function') bindRecipeCatalogFilters();
  if (typeof applyEventPickerButton  === 'function') applyEventPickerButton();
  _bindLabInputs();
  bindSupplyDiscountInputs();
  if (typeof renderCategoryTabs === 'function') renderCategoryTabs();
}

function bindPrimaryButtons() {
  const bindings = [
    ['addProductBtn',     () => openProductModal()],
    ['addIngredientBtn',  () => openIngredientModal()],
    ['addCategoryBtn',    () => addCategory()],
    ['saveProductBtn',    () => saveProduct()],
    ['saveIngredientBtn', () => saveIngredient()],
    ['saveSettingsBtn',   () => saveSettings()],
    ['saveFeaturesBtn',   () => saveFeatureSettings()],
    ['factoryResetBtn',   () => factoryReset()],
    ['resetDataBtn',      () => archiveAndReset()],
    ['logoutBtn',         () => logout()],
    ['loadDemoBtn',       () => loadDemoData()],
    ['loadDemoBtnProducts', () => loadDemoData()],
    ['exportSalesBtn',    () => exportSalesReport()],
    ['checkoutBtn',       () => openCheckoutModal()],
    ['clearCartBtn',      () => clearCart()],
    ['heldOrdersBtn',     () => openHeldOrdersModal()],
    ['holdOrderBtn',      () => holdOrder()],
    ['exportDataBtn',     () => exportAllData()],
    ['addSupplyOrderBtn',    () => openSupplyOrderModal()],
    ['supplierOrderBtn',     () => openSupplierOrderPrompt()],
    ['exportSupplyBtn',   () => exportSupplyCSV()],
    ['addClientBtn',      () => openClientModal()],
    ['saveSupplyOrderBtn',  () => saveSupplyOrder()],
    ['saveEventBtn',        () => saveEvent()],
    ['addEventBtn',         () => openEventModal()],
    ['labNewSessionBtn',       () => startNewLabSession()],
    ['addProdJobBtn',          () => openProductionJobModal()],
    ['endOfDayBtn',            () => openEndOfDaySummary()],
    ['shoppingListBtn',        () => openShoppingListModal()],
    ['rcNewRecipeBtn',         () => openRecipeForm()],
    ['rcSaveFormBtn',          () => saveRecipeForm()],
    ['rcCancelFormBtn',        () => closeRecipeForm()],
    ['rcCloseDetailBtn',       () => closeRecipeDetail()],
    ['slSaveBtn',              () => saveShoppingList()],
    ['slShareBtn',             () => shareShoppingList()],
    ['eodShareBtn',            () => shareEndOfDay()],
    ['saveProdJobBtn',         () => saveProductionJob()],
    ['saveBatchTrackingBtn',   () => saveBatchTracking()],
    ['addLaborPersonBtn',      () => openLaborPersonModal()],
    ['saveLaborPersonBtn',     () => saveLaborPersonFromForm()],
    ['labSaveDraftBtn',     () => saveLabDraft()],
    ['labConvertBtn',       () => openLabConvertModal()],
    ['labConfirmConvertBtn',() => confirmLabConvert()],
    ['labSavePresetBtn',    () => saveLabPresetFromForm()],
    ['labAddTempIngBtn',    () => addLabTempIngredient()],
    ['eventPickerBtn',      () => openEventPickerModal()],
    ['savePackageBtn',      () => savePackage()],
    ['addPackageBtn',       () => openPackageModal()],
    ['addPackageItemBtn',   () => addPackageItemRow()],
    ['saveLeadBtn',         () => saveLead()],
    ['addLeadBtn',          () => openLeadModal()],
    ['saveClientBtn',     () => saveSupplierClient()],
    ['exportDataBtn',     () => exportAllData()],
    ['exportDataBtnProducts', () => exportAllData()],
    ['addPaymentMethodBtn', () => openPaymentMethodModal(null)],
    ['archiveLocalBtn',   () => { closeModal('archiveResetChoiceModal'); archiveAndResetLocal(); }],
    ['archiveEmailBtn',   () => { closeModal('archiveResetChoiceModal'); archiveAndResetEmail(); }],
    ['archiveResetBtn',   () => openModal('archiveResetChoiceModal')],
    ['openReceiptUrlBtn', () => openReceiptUrlPopup()],
    ['saveReceiptUrlBtn', () => saveReceiptUrlFromPopup()],
    ['openVoidPinBtn',    () => openVoidPinPopup()],
    ['saveVoidPinBtn',    () => saveVoidPinFromPopup()],
  ];

  bindings.forEach(([id, handler]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
  });
}

function bindModalButtons() {
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.closeModal;
      if (target) closeModal(target);
    });
  });
}

function bindImportExport() {
  const importInput = document.getElementById('importDataInput');
  if (importInput) {
    importInput.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      importAllData(file);
      event.target.value = '';
    });
  }
}

function bindVariantBuilder() {
  const btn = document.getElementById('addVariantBtn');
  if (btn) btn.addEventListener('click', () => addVariantRow());
}

function bindRecipeBuilder() {
  const btn = document.getElementById('addRecipeBtn');
  if (btn) btn.addEventListener('click', () => addRecipeRow());

  const pkgBtn = document.getElementById('addPackagingBtn');
  if (pkgBtn) pkgBtn.addEventListener('click', () => addPackagingRow());

  // Live cost preview on price / recipe mode / yield change
  ['productPrice','recipeMode','batchYield'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
    });
    document.getElementById(id)?.addEventListener('change', () => {
      if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
    });
  });

  // Template hints when category changes
  document.getElementById('productCategory')?.addEventListener('change', () => {
    if (typeof renderProductTemplates === 'function') renderProductTemplates();
  });
}

function bindSupplyDiscountInputs() {
  ['supplyDiscountValue','supplyDiscountType'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input',  () => { if(typeof updateSupplyOrderTotal==='function') updateSupplyOrderTotal(); });
      el.addEventListener('change', () => { if(typeof updateSupplyOrderTotal==='function') updateSupplyOrderTotal(); });
    }
  });
}

function bindLeadFilters() {
  const f = document.getElementById('leadStatusFilter');
  if (f) f.addEventListener('change', () => {
    if (typeof renderLeadsTable === 'function') renderLeadsTable();
  });
}

function bindRecipeCatalogFilters() {
  const rs = document.getElementById('recipeSearch');
  const rc = document.getElementById('recipeCatFilter');
  if (rs) rs.addEventListener('input',  () => { if (typeof renderRecipeCatalog==='function') renderRecipeCatalog(); });
  if (rc) rc.addEventListener('change', () => { if (typeof renderRecipeCatalog==='function') renderRecipeCatalog(); });
}

function bindProductionFilters() {
  const sf = document.getElementById('prodStatusFilter');
  if (sf) sf.addEventListener('change', () => {
    if (typeof renderProductionBoard === 'function') renderProductionBoard();
  });
  const ls = document.getElementById('prodJobLaborSelect');
  if (ls) ls.addEventListener('change', e => {
    if (e.target.value && typeof addLaborToJob === 'function') {
      addLaborToJob(e.target.value);
    }
  });
}

function _bindLabInputs() {
  // Use event delegation on the lab view container for ALL lab inputs
  // This survives innerHTML replacements and works regardless of render order
  const labView = document.getElementById('view-lab');
  if (!labView || labView._labBound) return; // bind once only
  labView._labBound = true;

  // ── Delegated: change events ──
  labView.addEventListener('change', e => {
    if (!window.LAB_SESSION) return;
    const t = e.target;

    // Category select
    if (t.id === 'labCategorySelect') {
      window.LAB_SESSION.category = t.value;
      if (t.value && typeof applyLabPreset === 'function') applyLabPreset(t.value);
      return;
    }

    // Ingredient from catalog
    if (t.id === 'labIngFromCatalog') {
      if (!t.value) return;
      if (typeof addLabIngredientFromCatalog === 'function') {
        addLabIngredientFromCatalog(t.value);
      }
      t.value = '';
      return;
    }

    // Packaging toggle
    if (t.id === 'labPackagingToggle') {
      window.LAB_SESSION.packagingEnabled = t.checked;
      const sec = document.getElementById('labPackagingSection');
      if (sec) sec.style.display = t.checked ? 'block' : 'none';
      if (typeof renderLabPricing          === 'function') renderLabPricing();
      if (typeof renderLabSupplyAssessment === 'function') renderLabSupplyAssessment();
      if (typeof renderLabCharts           === 'function') renderLabCharts();
      return;
    }

    // Strategic toggle
    if (t.id === 'labStrategicToggle') {
      window.LAB_SESSION.strategicEnabled = t.checked;
      const sec = document.getElementById('labStrategicSection');
      if (sec) sec.style.display = t.checked ? 'block' : 'none';
      return;
    }

    // Launch toggle
    if (t.id === 'labLaunchToggle') {
      window.LAB_SESSION.launchEnabled = t.checked;
      const sec = document.getElementById('labLaunchSection');
      if (sec) sec.style.display = t.checked ? 'block' : 'none';
      return;
    }

    // Ingredient scarcity dropdowns
    if (t.classList.contains('lab-ing-scarcity')) {
      const idx = Number(t.dataset.idx);
      if (window.LAB_SESSION.ingredients[idx]) {
        window.LAB_SESSION.ingredients[idx].scarcity = t.value;
        if (typeof renderLabSupplyAssessment === 'function') renderLabSupplyAssessment();
        if (typeof renderLabCharts           === 'function') renderLabCharts();
      }
      return;
    }

    // Batch size — 'change' fires on iOS Safari when user taps away from number input
    if (t.id === 'labBatchSize') {
      const val = Number(t.value || 0);
      if (val > 0) {
        window.LAB_SESSION.batchSize = val;
        if (typeof _renderLabIngredientRows  === 'function') _renderLabIngredientRows();
        if (typeof renderLabPricing          === 'function') renderLabPricing();
        if (typeof renderLabSupplyAssessment === 'function') renderLabSupplyAssessment();
        if (typeof renderLabCharts           === 'function') renderLabCharts();
      }
      return;
    }
  });

  // ── Delegated: input events ──
  labView.addEventListener('input', e => {
    if (!window.LAB_SESSION) return;
    const t = e.target;

    // Batch size — set editing flag so _syncBatchSizeInput won't overwrite
    if (t.id === 'labBatchSize') {
      t.dataset.userEditing = '1';
      const val = Number(t.value || 0);
      if (val > 0) {
        window.LAB_SESSION.batchSize = val;
        // Re-render ingredient rows so per-cookie costs update immediately
        if (typeof _renderLabIngredientRows  === 'function') _renderLabIngredientRows();
        if (typeof renderLabPricing          === 'function') renderLabPricing();
        if (typeof renderLabSupplyAssessment === 'function') renderLabSupplyAssessment();
        if (typeof renderLabCharts           === 'function') renderLabCharts();
      }
      return;
    }

    // Waste slider
    if (t.id === 'labWasteSlider') {
      window.LAB_SESSION.wastePercent = Number(t.value || 0);
      const disp = document.getElementById('labWasteDisplay');
      if (disp) disp.textContent = t.value + '%';
      if (typeof renderLabPricing === 'function') renderLabPricing();
      if (typeof renderLabCharts  === 'function') renderLabCharts();
      return;
    }

    // Ingredient qty
    if (t.classList.contains('lab-ing-qty')) {
      const idx = Number(t.dataset.idx);
      if (window.LAB_SESSION.ingredients[idx]) {
        window.LAB_SESSION.ingredients[idx].qty = Number(t.value || 0);
        if (typeof _refreshLabCalcs === 'function') _refreshLabCalcs();
      }
      return;
    }

    // Ingredient cost
    if (t.classList.contains('lab-ing-cost')) {
      const idx = Number(t.dataset.idx);
      if (window.LAB_SESSION.ingredients[idx]) {
        window.LAB_SESSION.ingredients[idx].costPerUnit = Number(t.value || 0);
        if (typeof _refreshLabCalcs === 'function') _refreshLabCalcs();
      }
      return;
    }

    // Packaging name
    if (t.classList.contains('lab-pkg-name')) {
      const idx = Number(t.dataset.idx);
      if (window.LAB_SESSION.packaging[idx]) {
        window.LAB_SESSION.packaging[idx].name = t.value;
      }
      return;
    }

    // Packaging cost
    if (t.classList.contains('lab-pkg-cost')) {
      const idx = Number(t.dataset.idx);
      if (window.LAB_SESSION.packaging[idx]) {
        window.LAB_SESSION.packaging[idx].cost = Number(t.value || 0);
        if (typeof _refreshLabCalcs === 'function') _refreshLabCalcs();
      }
      return;
    }

    // Margin input
    if (t.classList.contains('lab-margin-input')) {
      const i = Number(t.dataset.scenario);
      window.LAB_SESSION.marginTargets[i] = Number(t.value || 0);
      if (typeof _refreshLabCalcs === 'function') _refreshLabCalcs();
      return;
    }

    // Price input (reverse: price → margin)
    if (t.classList.contains('lab-price-input')) {
      const i     = Number(t.dataset.scenario);
      const price = Number(t.value || 0);
      if (price > 0 && typeof labCalcCostPerUnit === 'function') {
        const cost   = labCalcCostPerUnit();
        const margin = cost > 0 ? ((price - cost) / price) * 100 : 0;
        window.LAB_SESSION.marginTargets[i] = Math.max(0, parseFloat(margin.toFixed(2)));
      }
      if (typeof _refreshLabCalcs === 'function') _refreshLabCalcs();
      return;
    }
  });

  // ── Delegated: click events ──
  labView.addEventListener('click', e => {
    if (!window.LAB_SESSION) return;
    const t = e.target.closest('button, [data-action]');
    if (!t) return;

    // Batch presets
    if (t.classList.contains('lab-batch-preset')) {
      window.LAB_SESSION.batchSize = Number(t.dataset.size);
      const inp = document.getElementById('labBatchSize');
      if (inp) { inp.value = window.LAB_SESSION.batchSize; inp.dataset.userEditing = '0'; }
      // Re-render rows so per-cookie costs update
      if (typeof _renderLabIngredientRows  === 'function') _renderLabIngredientRows();
      if (typeof renderLabPricing          === 'function') renderLabPricing();
      if (typeof renderLabSupplyAssessment === 'function') renderLabSupplyAssessment();
      if (typeof renderLabCharts           === 'function') renderLabCharts();
      return;
    }

    // Remove ingredient
    if (t.classList.contains('lab-remove-ing')) {
      const idx = Number(t.dataset.idx);
      window.LAB_SESSION.ingredients.splice(idx, 1);
      if (typeof _renderLabIngredientRows === 'function') _renderLabIngredientRows();
      if (typeof _refreshLabCalcs         === 'function') _refreshLabCalcs();
      return;
    }

    // Remove packaging
    if (t.classList.contains('lab-remove-pkg')) {
      const idx = Number(t.dataset.idx);
      window.LAB_SESSION.packaging.splice(idx, 1);
      if (typeof _renderLabPackagingRows === 'function') _renderLabPackagingRows();
      if (typeof _refreshLabCalcs        === 'function') _refreshLabCalcs();
      return;
    }

    // Select scenario
    if (t.classList.contains('lab-select-scenario')) {
      window.LAB_SESSION.selectedScenario = Number(t.dataset.scenario);
      if (typeof renderLabPricing === 'function') renderLabPricing();
      if (typeof renderLabCharts  === 'function') renderLabCharts();
      return;
    }
  });

  // Clear editing flag on batch size blur — commit final value
  labView.addEventListener('blur', e => {
    if (e.target.id === 'labBatchSize') {
      e.target.dataset.userEditing = '0';
      const val = Number(e.target.value || 0);
      if (val > 0 && window.LAB_SESSION) {
        window.LAB_SESSION.batchSize = val;
        if (typeof _renderLabIngredientRows  === 'function') _renderLabIngredientRows();
        if (typeof renderLabPricing          === 'function') renderLabPricing();
        if (typeof renderLabSupplyAssessment === 'function') renderLabSupplyAssessment();
        if (typeof renderLabCharts           === 'function') renderLabCharts();
      }
    }
  }, true);

  // Waste slider also needs 'change' for iOS Safari (fires on release)
  labView.addEventListener('change', e => {
    if (e.target.id === 'labWasteSlider' && window.LAB_SESSION) {
      window.LAB_SESSION.wastePercent = Number(e.target.value || 0);
      const disp = document.getElementById('labWasteDisplay');
      if (disp) disp.textContent = e.target.value + '%';
      if (typeof renderLabPricing === 'function') renderLabPricing();
      if (typeof renderLabCharts  === 'function') renderLabCharts();
    }
  });

}

function bindSupplyFilters() {
  ['supplyStatusFilter','supplyClientFilter','supplyFromDate','supplyToDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (typeof renderSupplyTable === 'function') renderSupplyTable();
    });
  });
}

function bindPOSSearch() {
  const input = document.getElementById('posSearch');
  if (input) {
    input.addEventListener('input', () => {
      updateState('ui', current => ({ ...current, posSearch: input.value || '' }));
      renderPOSProducts();
    });
  }
}

function bindDelegatedActions() {
  // Handle checkbox + input change events
  document.addEventListener('change', event => {
    const t = event.target;
    // Category mode toggle
    if (t.dataset && t.dataset.action === 'toggle-category-mode' && t.dataset.id) {
      if (typeof toggleCategoryMode === 'function') toggleCategoryMode(t.dataset.id);
    }
    // Category rename
    if (t.dataset && t.dataset.catRenameId) {
      if (typeof renameCategory === 'function') renameCategory(t.dataset.catRenameId, t.value);
    }
  });

  // Category rename on blur too
  document.addEventListener('blur', event => {
    const t = event.target;
    if (t.dataset && t.dataset.catRenameId) {
      if (typeof renameCategory === 'function') renameCategory(t.dataset.catRenameId, t.value);
    }
  }, true);

  // Category rename on Enter key
  document.addEventListener('keydown', event => {
    const t = event.target;
    if (event.key === 'Enter' && t.dataset && t.dataset.catRenameId) {
      t.blur();
    }
  });

  document.addEventListener('click', event => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    switch (action) {
      case 'export-data':           exportAllData(); break;
      case 'edit-product':          openProductModal(actionEl.dataset.id || ''); break;
      case 'delete-product':        deleteProduct(actionEl.dataset.id || ''); break;
      case 'clone-product':         cloneProduct(actionEl.dataset.id || ''); break;
      case 'edit-ingredient':       openIngredientModal(actionEl.dataset.id || ''); break;
      case 'delete-ingredient':     deleteIngredient(actionEl.dataset.id || ''); break;
      case 'add-to-cart':           addToCart(actionEl.dataset.id || ''); break;
      case 'increase-qty':          increaseQty(actionEl.dataset.id || ''); break;
      case 'decrease-qty':          decreaseQty(actionEl.dataset.id || ''); break;
      case 'remove-from-cart':      removeFromCart(actionEl.dataset.id || ''); break;
      case 'add-to-cart-variant': {
        const productId  = actionEl.dataset.productId || '';
        const variantId  = actionEl.dataset.variantId || '';
        const product    = getProducts().find(p => String(p.id) === String(productId));
        const variant    = product?.variants?.find(v => String(v.id) === String(variantId)) || null;
        if (product) addToCart(productId, variant);
        closeModal('variantModal');
        break;
      }
      case 'filter-category':       if (typeof setActiveCategory === 'function') setActiveCategory(actionEl.dataset.category || 'All'); break;
      case 'set-order-type':        if (typeof setOrderType === 'function') setOrderType(actionEl.dataset.type || 'Dine In'); break;
      case 'complete-sale':         completeSale(); break;
      case 'complete-sale-pending': completeSale('pending'); break;
      case 'clear-cart':            clearCart(); break;
      case 'hold-order':            holdOrder(); break;
      case 'open-checkout':         openCheckoutModal(); break;
      case 'export-sales':          exportSalesReport(); break;
      case 'load-demo':             loadDemoData(); break;
      case 'save-settings':         saveSettings(); break;
      case 'add-category':          addCategory(); break;
      case 'restock-ingredient':    openRestockModal(actionEl.dataset.id || ''); break;
      case 'save-restock':          saveRestockMovement(); break;
      case 'cancel-restock':        closeModal('restockModal'); break;
      case 'refresh-reports':       if (typeof renderReports === 'function') renderReports(); break;
      case 'report-preset':         if (typeof _applyReportPreset === 'function') _applyReportPreset(actionEl.dataset.preset || 'today'); break;
      case 'print-supply-invoice':  printSupplyInvoice(actionEl.dataset.id || ''); break;
      case 'print-receipt':         printReceipt(); break;
      case 'complete-pending-sale': completePendingSale(actionEl.dataset.id || ''); break;
      case 'cancel-pending-sale':   cancelPendingSale(actionEl.dataset.id || ''); break;
      case 'open-sale-receipt':     openSaleReceipt(actionEl.dataset.id || ''); break;
      case 'open-void-modal':         openVoidModal(actionEl.dataset.id || ''); break;
      case 'confirm-standard-reset':
        if (typeof resetBusinessData === 'function') {
          closeModal('resetDataModal');
          resetBusinessData();
        }
        break;
      case 'confirm-factory-reset':
        if (typeof fullFactoryReset === 'function') {
          closeModal('resetDataModal');
          fullFactoryReset();
        }
        break;
      // Coffee Cart Mode actions
      case 'add-event':               openEventModal(); break;
      case 'edit-event':              openEventModal(actionEl.dataset.id || ''); break;
      case 'delete-event':            deleteEvent(actionEl.dataset.id || ''); break;
      case 'save-event':              saveEvent(); break;
      case 'activate-event':          activateEvent(actionEl.dataset.id || ''); break;
      case 'add-planned-item':        if(typeof addPlannedItemRow==='function') addPlannedItemRow(); break;
      case 'event-leftover-save':     if(typeof saveEventLeftovers==='function') saveEventLeftovers(actionEl.dataset.id || ''); break;
      case 'event-leftover-skip':     if(typeof skipEventLeftovers==='function') skipEventLeftovers(); break;
      case 'end-event-session':       endEventSession(); break;
      case 'open-event-picker':       openEventPickerModal(); break;
      // Production Mode
      case 'add-prod-job':              openProductionJobModal(); break;
      case 'edit-prod-job':             openProductionJobModal(actionEl.dataset.id||''); break;
      case 'delete-prod-job':           deleteProductionJob(actionEl.dataset.id||''); break;
      case 'save-prod-job':             saveProductionJob(); break;
      case 'open-prod-line-status':     openProductLineStatusModal(actionEl.dataset.jobId||'', actionEl.dataset.lineId||''); break;
      case 'set-product-line-status':   setProductLineStatus(actionEl.dataset.jobId||'', actionEl.dataset.lineId||'', actionEl.dataset.status||''); break;
      case 'open-batch-tracking':       openBatchTrackingModal(actionEl.dataset.jobId||'', actionEl.dataset.lineId||''); break;
      case 'save-batch-tracking':       saveBatchTracking(); break;
      // Labor Roster
      case 'add-labor-person':          openLaborPersonModal(); break;
      case 'edit-labor-person':         openLaborPersonModal(actionEl.dataset.id||''); break;
      case 'delete-labor-person':       deleteLaborPerson(actionEl.dataset.id||''); break;
      case 'save-labor-person':         saveLaborPersonFromForm(); break;
      // Product Lab
      case 'start-lab-session':        startNewLabSession(); break;
      case 'load-lab-draft':           loadLabDraft(actionEl.dataset.id||''); break;
      case 'delete-lab-draft':         deleteLabDraft(actionEl.dataset.id||''); break;
      case 'save-lab-draft':           saveLabDraft(); break;
      case 'open-lab-convert':         openLabConvertModal(); break;
      case 'confirm-lab-convert':      confirmLabConvert(); break;
      case 'edit-lab-preset':          openLabPresetModal(actionEl.dataset.id||''); break;
      case 'delete-lab-preset':        deleteLabCategoryPreset(actionEl.dataset.id||''); break;
      case 'save-lab-preset':          saveLabPresetFromForm(); break;
      case 'add-lab-preset':           openLabPresetModal(); break;
      case 'open-lab-temp-ing':        openModal('labTempIngModal'); break;
      case 'open-lab-ing-picker':       if(typeof openLabIngPickerModal==='function') openLabIngPickerModal(); break;
      case 'add-lab-temp-ing':         addLabTempIngredient(); break;
      case 'add-lab-packaging':        addLabPackagingItem(); break;
      case 'set-channel':             setActiveChannel(actionEl.dataset.channel || 'Dine In'); break;
      // Phase 2 — Event Profitability
      case 'open-event-profitability': openEventProfitabilityModal(actionEl.dataset.id || ''); break;
      case 'add-event-expense':        addExpenseFromForm(actionEl.dataset.eventId || ''); break;
      case 'delete-event-expense':     deleteEventExpense(actionEl.dataset.eventId || '', actionEl.dataset.expenseId || ''); break;
      // Phase 2 — Package Builder
      case 'add-package':              openPackageModal(); break;
      case 'edit-package':             openPackageModal(actionEl.dataset.id || ''); break;
      case 'delete-package':           deletePackage(actionEl.dataset.id || ''); break;
      case 'save-package':             savePackage(); break;
      case 'add-package-item':         addPackageItemRow(); break;
      // Phase 2 — Lead Tracker
      case 'add-lead':                 openLeadModal(); break;
      case 'edit-lead':                openLeadModal(actionEl.dataset.id || ''); break;
      case 'delete-lead':              deleteLead(actionEl.dataset.id || ''); break;
      case 'save-lead':                saveLead(); break;
      case 'open-refund-modal':           if(typeof openRefundModal==='function') openRefundModal(actionEl.dataset.id||''); break;
      case 'confirm-refund':              if(typeof confirmRefund==='function') confirmRefund(); break;
      case 'clone-product':               if(typeof cloneProduct==='function') cloneProduct(actionEl.dataset.id||''); break;
      case 'run-integrity-check':         if(typeof renderIntegrityReport==='function') renderIntegrityReport(); break;
      case 'refresh-inventory-movements': if(typeof renderInventoryMovementHistory==='function') renderInventoryMovementHistory(); break;
      case 'view-transaction-timeline':   if(typeof renderTransactionTimeline==='function') renderTransactionTimeline(actionEl.dataset.id||''); break;
      case 'add-packaging-row':           addPackagingRow(); break;
      case 'confirm-void':                if(typeof confirmVoid==='function') confirmVoid(); break;

      // Supply actions
      case 'open-supplier-order-prompt': openSupplierOrderPrompt(); break;
      case 'confirm-supplier-order':     confirmSupplierOrder(); break;
      case 'add-supply-order':           openSupplyOrderModal(); break;
      case 'view-supply-order':      openSupplyOrderView(actionEl.dataset.id || ''); break;
      case 'edit-supply-order':      openSupplyOrderModal(actionEl.dataset.id || ''); break;
      case 'delete-supply-order':    deleteSupplyOrder(actionEl.dataset.id || ''); break;
      case 'advance-supply-status':    advanceSupplyStatus(actionEl.dataset.id || ''); break;
      case 'open-status-picker':       openStatusPickerModal(actionEl.dataset.id || ''); break;
      case 'set-supply-status':        setSupplyStatus(actionEl.dataset.orderId || '', actionEl.dataset.status || ''); break;
      case 'cancel-supply-order':    cancelSupplyOrder(actionEl.dataset.id || ''); break;
      case 'toggle-supply-row-menu': if(typeof toggleSupplyRowMenu==='function') toggleSupplyRowMenu(actionEl.dataset.id || '', 'order'); break;
      case 'toggle-client-row-menu': if(typeof toggleSupplyRowMenu==='function') toggleSupplyRowMenu(actionEl.dataset.id || '', 'client'); break;
      case 'push-to-production':     if(typeof pushSupplyOrderToProduction==='function') pushSupplyOrderToProduction(actionEl.dataset.id || ''); break;
      case 'view-production-job':    if(typeof viewSupplyOrderProductionJob==='function') viewSupplyOrderProductionJob(actionEl.dataset.id || ''); break;
      case 'confirm-supply-checkout': if(typeof confirmSupplyCheckout==='function') confirmSupplyCheckout(actionEl.dataset.id || ''); break;
      case 'open-supply-checkout':    if(typeof openSupplyCheckoutModal==='function') openSupplyCheckoutModal(actionEl.dataset.id || ''); break;
      case 'save-supply-order':      saveSupplyOrder(); break;
      case 'export-supply-csv':      exportSupplyCSV(); break;
      case 'add-supply-line':        addSupplyLineItemRow(); break;
      case 'add-client':             openClientModal(); break;
      case 'edit-client':            openClientModal(actionEl.dataset.id || ''); break;
      case 'delete-client':          deleteSupplierClient(actionEl.dataset.id || ''); break;
      case 'client-portal':          if(typeof openClientPortalModal==='function') openClientPortalModal(actionEl.dataset.id || ''); break;
      case 'client-statement':       if(typeof openClientStatementModal==='function') openClientStatementModal(actionEl.dataset.id || ''); break;
      case 'stmt-share':             if(typeof shareClientStatement==='function') shareClientStatement(actionEl.dataset.id || document.getElementById('stmtClientId')?.value || ''); break;
      case 'stmt-revoke':            if(typeof revokeClientStatementLink==='function') revokeClientStatementLink(actionEl.dataset.id || document.getElementById('stmtClientId')?.value || ''); break;
      case 'stmt-print':             if(typeof printClientStatement==='function') printClientStatement(actionEl.dataset.id || document.getElementById('stmtClientId')?.value || ''); break;
      case 'stmt-copy-link':         if(typeof copyClientStatementLink==='function') copyClientStatementLink(document.getElementById('stmtClientId')?.value || ''); break;
      case 'accept-portal-report':   if(typeof acceptPortalReport==='function') acceptPortalReport(actionEl.dataset.id || ''); break;
      case 'consignment-ledger':     if(typeof openConsignmentLedger==='function') openConsignmentLedger(actionEl.dataset.id || ''); break;
      case 'portal-save':            if(typeof saveAndSyncClientPortal==='function') saveAndSyncClientPortal(); break;
      case 'portal-share':           if(typeof shareClientPortal==='function') shareClientPortal(); break;
      case 'portal-revoke':          if(typeof revokeClientPortal==='function') revokeClientPortal(); break;
      case 'portal-copy-link':       if(typeof copyPortalLink==='function') copyPortalLink(); break;
      case 'save-client':            saveSupplierClient(); break;
      case 'delete-category':       deleteCategory(actionEl.dataset.id || actionEl.dataset.category || ''); break;
      case 'toggle-category-mode':   toggleCategoryMode(actionEl.dataset.id || ''); break;
      case 'open-recipe-detail':     openRecipeDetail(actionEl.dataset.id || ''); break;
      case 'edit-recipe':            openRecipeForm(actionEl.dataset.id || ''); break;
      case 'delete-recipe':          deleteRecipe(actionEl.dataset.id || ''); break;
      case 'open-change-pin':        if(typeof openChangePinModal==='function') openChangePinModal(); break;
      case 'save-new-pin':           if(typeof saveNewPin==='function') saveNewPin(); break;
      // Finished Goods
      case 'open-fg-adjustment':     if(typeof openFGAdjustmentModal==='function') openFGAdjustmentModal(actionEl.dataset.id||''); break;
      case 'save-fg-adjustment':     if(typeof saveFGAdjustment==='function') saveFGAdjustment(); break;
      case 'quick-amount':          setQuickAmount(Number(actionEl.dataset.amount)); break;
      default: break;
    }
  });
}

window.initializeUIActions  = initializeUIActions;
window.bindSupplyFilters     = bindSupplyFilters;
