/* ═══════════════════════════════════════════════════════
   STATE.JS — Central application state
═══════════════════════════════════════════════════════ */

const APP_STATE = {
  currentUserRole: 'STAFF',

  settings: {
    brandName: 'Caflat.CORE',
    taxRate: 0,
    receiptFooter: 'Thank you for choosing Caflat.CORE',
    currency: 'PHP',
    orderTypes: ['Dine In', 'Take Out', 'Delivery'],
    lowStockThreshold: 5,
    voidPin: '000000',          // Admin void PIN — changeable in Settings
    paymentQRImages: {},        // { gcash, maya, qrph } — base64 images
    supplierModeEnabled: false, // Supplier Mode feature toggle
    treasuryModeEnabled: false  // Treasury feature toggle
  },

  receiptCounter: 0,            // Sequential permanent counter, never resets

  products: [],
  ingredients: [],
  sales: [],
  cart: [],
  heldOrders: [],
  inventoryMovements: [],
  auditLog: [],                 // Immutable audit trail
  supplyOrders: [],             // Supplier order records
  supplierClients: [],          // B2B client list
  supplyInvoiceCounter: 0,      // Sequential invoice counter
  stockReservations: [],        // Soft stock holds for ORDERED supply orders
  categories: ['Cookies', 'Chewy Cookies', 'Drinks'],
  events: [],                   // Coffee Cart events
  eventPackages: [],            // Coffee Cart packages
  leads: [],                    // Coffee Cart leads/CRM
  activeEvent: null,            // Currently active event session

  // Origin Mode
  originLots: [],               // Raw material lots
  originBatches: [],            // Processing batches (roast, ferment, dry)
  originProcessingProfiles: [], // Roast/processing profiles per category
  originOrders: [],             // B2B wholesale orders
  originClients: [],            // Origin Mode client directory
  originOrderCounter: 0,        // Sequential origin order counter

  // Treasury — manual cash/bank tracker, disconnected from inventory
  treasuryAccounts: [],         // { id, name, type: 'cash'|'bank', openingBalance, createdAt }
  treasuryTransactions: [],     // { id, accountId, kind: 'add'|'deduct', amount, reason, date, createdAt }

  // Daily Close — opt-in (Settings → Features), one record per closed local day
  dayCloses: [],                 // { day, revenue, orders, cogs, expenses, expenseRows, profit, margin, cashExpected, cashCounted, variance, expenseTxnIds, closedAt }

  costLabSettings: {
    targetMargin: 60,
    laborCostPerUnit: 0,
    overheadCostPerUnit: 0
  },
  costLabOverrides: {},
  costHistory: [],

  ui: {
    currentView: 'pos',
    activeCategory: 'All',
    orderType: 'Dine In',
    posSearch: ''
  }
};

function updateState(key, updater) {
  const current = APP_STATE[key];
  APP_STATE[key] = typeof updater === 'function' ? updater(current) : updater;
  persistState();
  return APP_STATE[key];
}

function resetState() {
  APP_STATE.products = [];
  APP_STATE.ingredients = [];
  APP_STATE.sales = [];
  APP_STATE.cart = [];
  APP_STATE.heldOrders = [];
  APP_STATE.inventoryMovements = [];
  APP_STATE.auditLog = [];
  APP_STATE.receiptCounter = 0;
  APP_STATE.categories = ['Cookies', 'Chewy Cookies', 'Drinks'];
  APP_STATE.supplyOrders = [];
  APP_STATE.supplierClients = [];
  APP_STATE.supplyInvoiceCounter = 0;
  APP_STATE.stockReservations = [];
  APP_STATE.events = [];
  APP_STATE.eventPackages = [];
  APP_STATE.leads = [];
  APP_STATE.activeEvent = null;
  APP_STATE.originLots = [];
  APP_STATE.originBatches = [];
  APP_STATE.originProcessingProfiles = [];
  APP_STATE.originOrders = [];
  APP_STATE.originClients = [];
  APP_STATE.originOrderCounter = 0;
  APP_STATE.treasuryAccounts = [];
  APP_STATE.treasuryTransactions = [];
  APP_STATE.dayCloses = [];
  // These are persisted by persistState() too — leaving them out meant stock
  // and production data survived a "full factory reset" and got written back
  // to storage on the very next save.
  APP_STATE.finishedGoods = [];
  APP_STATE.fgMovements = [];
  APP_STATE.labDrafts = [];
  APP_STATE.shoppingLists = [];
  APP_STATE.productionJobs = [];
  APP_STATE.productionTemplates = [];
  APP_STATE.costLabOverrides = {};
  APP_STATE.costHistory = [];
  APP_STATE.costLabSettings = { targetMargin: 60, laborCostPerUnit: 0, overheadCostPerUnit: 0 };
  persistState();
}

/* ── Receipt number generator ── */
function generateReceiptNumber() {
  APP_STATE.receiptCounter = Number(APP_STATE.receiptCounter || 0) + 1;
  const year = String(new Date().getFullYear()).slice(-2);  // "25"
  const seq  = String(APP_STATE.receiptCounter).padStart(6, '0'); // "000001"
  persistState();
  return `CF-${year}-${seq}`;  // e.g. CF-25-000001
}

/* ── Supply invoice number generator ── */
function generateInvoiceNumber() {
  APP_STATE.supplyInvoiceCounter = Number(APP_STATE.supplyInvoiceCounter || 0) + 1;
  const year = String(new Date().getFullYear()).slice(-2);
  const seq  = String(APP_STATE.supplyInvoiceCounter).padStart(5, '0');
  persistState();
  return `INV-${year}-${seq}`;  // e.g. INV-25-00001
}

/* ── Origin lot/batch number generators ── */
function generateLotNumber() {
  const year = new Date().getFullYear();
  const count = (APP_STATE.originLots || []).length + 1;
  return `LOT-${year}-${String(count).padStart(3,'0')}`;
}

function generateBatchNumber() {
  const year = new Date().getFullYear();
  const count = (APP_STATE.originBatches || []).length + 1;
  return `BATCH-${year}-${String(count).padStart(3,'0')}`;
}

function generateOriginOrderNumber() {
  APP_STATE.originOrderCounter = Number(APP_STATE.originOrderCounter || 0) + 1;
  const year = String(new Date().getFullYear()).slice(-2);
  const seq  = String(APP_STATE.originOrderCounter).padStart(4,'0');
  persistState();
  return `ORG-${year}-${seq}`;
}

window.generateLotNumber         = generateLotNumber;
window.generateBatchNumber       = generateBatchNumber;
window.generateOriginOrderNumber = generateOriginOrderNumber;

window.APP_STATE             = APP_STATE;
window.updateState           = updateState;
window.resetState            = resetState;
window.generateReceiptNumber = generateReceiptNumber;
window.generateInvoiceNumber = generateInvoiceNumber;
