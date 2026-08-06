/* ═══════════════════════════════════════════════════════
   QR.JS — Caflat.CORE QR Code Generator
   Full implementation with correct multi-block RS encoding.
═══════════════════════════════════════════════════════ */
(function(root) {
  'use strict';

  /* ── Reed-Solomon GF(256) ── */
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function(){
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x; GF_LOG[x] = i;
      x = x << 1; if (x & 0x100) x ^= 0x11D;
    }
    for (var i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (!a || !b) return 0;
    return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
  }

  function rsGenerator(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        ng[j]   ^= g[j];
        ng[j+1] ^= gfMul(g[j], GF_EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, nEC) {
    var gen = rsGenerator(nEC);
    var msg = data.slice();
    for (var i = 0; i < nEC; i++) msg.push(0);
    for (var i = 0; i < data.length; i++) {
      var coef = msg[i];
      if (coef) for (var j = 1; j < gen.length; j++) msg[i+j] ^= gfMul(gen[j], coef);
    }
    return msg.slice(data.length);
  }

  /* ── Version/capacity tables (EC level M) ──
     g1/g2: block groups. k=data CW per block, ec=EC CW per block, c=count of blocks.
     From ISO/IEC 18004:2015 Table 9.                                              */
  var VERSIONS_M = [
    null,
    { g1:{k:16, ec:10, c:1}                       }, // v1
    { g1:{k:28, ec:16, c:1}                       }, // v2
    { g1:{k:22, ec:13, c:2}                       }, // v3: 2×22 data + 2×13 EC = 44+26
    { g1:{k:32, ec:18, c:2}                       }, // v4: 2×32 data + 2×18 EC = 64+36
    { g1:{k:22, ec:11, c:2}, g2:{k:23,ec:11,c:2} }, // v5: (2×22+2×23) data
    { g1:{k:27, ec:16, c:4}                       }, // v6: 4×27 data + 4×16 EC
    { g1:{k:16, ec:9,  c:4}, g2:{k:17,ec:9, c:1} }, // v7
    { g1:{k:19, ec:11, c:2}, g2:{k:20,ec:11,c:4} }, // v8
    { g1:{k:20, ec:12, c:3}, g2:{k:21,ec:12,c:2} }, // v9
    { g1:{k:20, ec:12, c:4}, g2:{k:21,ec:12,c:2} }, // v10 (simplified)
  ];

  /* Total data CW per version */
  var BYTE_CAP_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213]; // byte capacity per ISO 18004 Table 7

  function selectVersion(byteLen) {
    for (var v = 1; v <= 10; v++) {
      if (byteLen <= BYTE_CAP_M[v]) return v;
    }
    return 10;
  }

  /* ── UTF-8 encoding ── */
  function toBytes(text) {
    /* Sanitize non-printable / problematic chars, keep ASCII clean */
    var sym = (typeof getCurrencySymbol === 'function') ? getCurrencySymbol() : '₱';
    var code = (typeof getActiveCurrencyCode === 'function') ? getActiveCurrencyCode() : 'PHP';
    var clean = (sym ? text.split(sym).join(code) : text).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
    var b = [];
    for (var i = 0; i < clean.length; i++) b.push(clean.charCodeAt(i) & 0xFF);
    return b;
  }

  /* ── Data codeword stream ── */
  function buildDataCW(bytes, version) {
    var ver = VERSIONS_M[version];
    /* Total data capacity = sum of (k × c) across all groups */
    var totalDC = ver.g1.k * ver.g1.c;
    if (ver.g2 && ver.g2.c) totalDC += ver.g2.k * ver.g2.c;
    var bits = [];
    function push(v, n) { for (var i=n-1;i>=0;i--) bits.push((v>>i)&1); }

    push(0x4, 4);           // byte mode
    push(bytes.length, 8);  // char count (8 bits for v1-9)
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    push(0, 4);             // terminator
    while (bits.length % 8) bits.push(0);

    var cw = [];
    for (var i = 0; i < bits.length; i+=8) {
      var b = 0; for (var j=0;j<8;j++) b=(b<<1)|(bits[i+j]||0); cw.push(b);
    }
    var pad = [0xEC, 0x11], pi = 0;
    while (cw.length < totalDC) cw.push(pad[pi++ % 2]);
    return cw;
  }

  /* ── Multi-block RS encoding + interleaving ── */
  function buildMessage(dataCW, version) {
    var ver = VERSIONS_M[version];

    /* Split data into blocks per group */
    var blocks = [];
    var pos = 0;
    function addGroup(g) {
      for (var i = 0; i < g.c; i++) {
        blocks.push({ data: dataCW.slice(pos, pos + g.k), ec: g.ec });
        pos += g.k;
      }
    }
    addGroup(ver.g1);
    if (ver.g2 && ver.g2.c) addGroup(ver.g2);

    /* RS-encode each block using its own EC count */
    var ecBlocks = blocks.map(function(b) { return rsEncode(b.data, b.ec); });

    /* Interleave data codewords */
    var maxDC = Math.max.apply(null, blocks.map(function(b){return b.data.length;}));
    var result = [];
    for (var i = 0; i < maxDC; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i < blocks[j].data.length) result.push(blocks[j].data[i]);
      }
    }

    /* Interleave EC codewords */
    var maxEC = Math.max.apply(null, blocks.map(function(b){return b.ec;}));
    for (var i = 0; i < maxEC; i++) {
      for (var j = 0; j < ecBlocks.length; j++) {
        if (i < ecBlocks[j].length) result.push(ecBlocks[j][i]);
      }
    }

    return result;
  }

  /* ── Matrix construction ── */
  function makeMatrix(n) {
    var m = [];
    for (var i=0;i<n;i++){m.push([]);for(var j=0;j<n;j++)m[i].push(null);}
    return m;
  }

  function placeFinder(m, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row+r, cc = col+c;
        if (rr<0||cc<0||rr>=m.length||cc>=m.length) continue;
        if (r===-1||r===7||c===-1||c===7) {
          m[rr][cc] = 0; // separator — always white
        } else {
          var border = r===0||r===6||c===0||c===6;
          var center = r>=2&&r<=4&&c>=2&&c<=4;
          m[rr][cc] = (border||center) ? 1 : 0;
        }
      }
    }
  }

  function placeTiming(m) {
    var n = m.length;
    for (var i=8;i<n-8;i++) {
      if (m[6][i]===null) m[6][i] = i%2===0?1:0;
      if (m[i][6]===null) m[i][6] = i%2===0?1:0;
    }
  }

  function buildReservedMap(n) {
    var res = [];
    for (var i=0;i<n;i++){res.push([]);for(var j=0;j<n;j++)res[i].push(false);}
    function mF(r,c){for(var dr=-1;dr<=7;dr++)for(var dc=-1;dc<=7;dc++){var rr=r+dr,cc=c+dc;if(rr>=0&&rr<n&&cc>=0&&cc<n)res[rr][cc]=true;}}
    mF(0,0);mF(0,n-7);mF(n-7,0);
    for(var i=0;i<n;i++){res[6][i]=true;res[i][6]=true;}
    for(var i=0;i<=8;i++){res[8][i]=true;res[i][8]=true;}
    for(var i=0;i<8;i++){res[n-1-i][8]=true;res[8][n-1-i]=true;}
    return res;
  }

  function placeData(m, msg, reserved) {
    var n=m.length, bit=0, col=n-1;
    while(col>0){
      if(col===6)col--;
      for(var row=0;row<n;row++){
        var r=(Math.floor((n-1-col)/2)%2===0)?(n-1-row):row;
        for(var i=0;i<2;i++){
          var c=col-i;
          if(m[r][c]!==null||reserved[r][c])continue;
          var by=Math.floor(bit/8), bi=7-(bit%8);
          m[r][c]=by<msg.length?(msg[by]>>bi)&1:0;
          bit++;
        }
      }
      col-=2;
    }
  }

  /* Format info sequences for EC=M, masks 0-7 (pre-computed from spec) */
  var FMT_M = [0x5412,0x5125,0x5E7C,0x5B4B,0x45F9,0x40CE,0x4F97,0x4AA0];

  function placeFormatInfo(m, maskIdx) {
    var n=m.length, data=FMT_M[maskIdx], seq=[];
    for(var i=14;i>=0;i--) seq.push((data>>i)&1);
    var pos=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
             [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for(var i=0;i<15;i++) m[pos[i][0]][pos[i][1]]=seq[i];
    for(var i=0;i<8;i++) m[8][n-1-i]=seq[i];
    for(var i=8;i<15;i++) m[n-15+i][8]=seq[i];
    m[n-8][8]=1; // dark module
  }

  var MASK_FNS=[
    function(r,c){return(r+c)%2===0;},
    function(r,c){return r%2===0;},
    function(r,c){return c%3===0;},
    function(r,c){return(r+c)%3===0;},
    function(r,c){return(Math.floor(r/2)+Math.floor(c/3))%2===0;},
    function(r,c){return(r*c)%2+(r*c)%3===0;},
    function(r,c){return((r*c)%2+(r*c)%3)%2===0;},
    function(r,c){return((r+c)%2+(r*c)%3)%2===0;},
  ];

  function applyMask(m, mi, reserved) {
    var fn=MASK_FNS[mi],n=m.length;
    var cp=m.map(function(r){return r.slice();});
    for(var r=0;r<n;r++)for(var c=0;c<n;c++)
      if(!reserved[r][c]&&cp[r][c]!==null&&fn(r,c))cp[r][c]^=1;
    return cp;
  }

  function penalty(m) {
    var n=m.length,p=0;
    for(var r=0;r<n;r++){for(var c=0;c<n-4;c++){var v=m[r][c];if(m[r][c+1]===v&&m[r][c+2]===v&&m[r][c+3]===v&&m[r][c+4]===v){p+=3;var k=c+5;while(k<n&&m[r][k]===v){p++;k++;}}}}
    for(var c=0;c<n;c++){for(var r=0;r<n-4;r++){var v=m[r][c];if(m[r+1][c]===v&&m[r+2][c]===v&&m[r+3][c]===v&&m[r+4][c]===v){p+=3;var k=r+5;while(k<n&&m[k][c]===v){p++;k++;}}}}
    for(var r=0;r<n-1;r++)for(var c=0;c<n-1;c++){var v=m[r][c];if(m[r][c+1]===v&&m[r+1][c]===v&&m[r+1][c+1]===v)p+=3;}
    return p;
  }

  /* ── Main ── */
  function generateSVG(text, options) {
    options = options || {};
    var size = options.size || 200;

    var bytes   = toBytes(text || '');
    var version = selectVersion(bytes.length);
    var n       = 4*version+17;

    var m = makeMatrix(n);
    placeFinder(m,0,0); placeFinder(m,0,n-7); placeFinder(m,n-7,0);
    placeTiming(m);
    m[4*version+9][8] = 1; // dark module

    var reserved = buildReservedMap(n);
    var dataCW   = buildDataCW(bytes, version);
    var msg      = buildMessage(dataCW, version);

    var dm = m.map(function(r){return r.slice();});
    placeData(dm, msg, reserved);

    var best=0, bestP=Infinity;
    for(var mi=0;mi<8;mi++){
      var msk=applyMask(dm,mi,reserved);
      placeFormatInfo(msk,mi);
      var p=penalty(msk);
      if(p<bestP){bestP=p;best=mi;}
    }

    var final=applyMask(dm,best,reserved);
    placeFormatInfo(final,best);

    /* Render — integer module sizes, 4-module quiet zone */
    var qz      = 4;
    var total   = n + 2*qz;
    var ms      = Math.max(4, Math.floor(size/total));
    var sz      = total*ms;
    var off     = qz*ms;

    var rects=[];
    for(var r=0;r<n;r++) for(var c=0;c<n;c++) {
      if(final[r][c]===1)
        rects.push('<rect x="'+(off+c*ms)+'" y="'+(off+r*ms)+'" width="'+ms+'" height="'+ms+'"/>');
    }

    return '<svg xmlns="http://www.w3.org/2000/svg"'
      +' viewBox="0 0 '+sz+' '+sz+'"'
      +' width="'+sz+'" height="'+sz+'"'
      +' shape-rendering="crispEdges">'
      +'<rect width="'+sz+'" height="'+sz+'" fill="#fff"/>'
      +'<g fill="#000">'+rects.join('')+'</g>'
      +'</svg>';
  }

  root.CaflatQR = { generateSVG: generateSVG };

})(typeof window !== 'undefined' ? window : global);

window.salesTableLimit=20;
/* ═══════════════════════════════════════════════════════
   SALES.JS — Cart management, checkout, receipts
═══════════════════════════════════════════════════════ */

function initializeSales() {
  bindSalesLifecycle();
  renderCart();
  updateCartSummary();
  renderSalesTable();
  renderHeldOrdersBadge();
}

function bindSalesLifecycle() {
  const ids = ['discountValue', 'discountType', 'checkoutPayment',
               'checkoutTendered', 'salesFromDate', 'salesToDate', 'salesPaymentFilter',
               'salesStatusFilter', 'salesSearch', 'salesCategoryFilter', 'salesChannelFilter'];
  const handlers = {
    'discountValue':       ['input',  updateCartSummary],
    'discountType':        ['change', updateCartSummary],
    'checkoutPayment':     ['change', togglePaymentFields],
    'checkoutTendered':    ['input',  calculateChange],
    'salesFromDate':       ['change', () => { _clearTimePillActive(); renderSalesTable(); }],
    'salesToDate':         ['change', () => { _clearTimePillActive(); renderSalesTable(); }],
    'salesPaymentFilter':  ['change', renderSalesTable],
    'salesStatusFilter':   ['change', renderSalesTable],
    'salesSearch':         ['input',  renderSalesTable],
    'salesCategoryFilter': ['change', renderSalesTable],
    'salesChannelFilter':  ['change', renderSalesTable],
  };
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && handlers[id]) el.addEventListener(handlers[id][0], handlers[id][1]);
  });

  // Time preset pills
  document.getElementById('salesTimePills')?.addEventListener('click', e => {
    const btn = e.target.closest('.time-pill');
    if (btn) applyTimePill(btn.dataset.preset);
  });
}

function _clearTimePillActive() {
  document.querySelectorAll('#salesTimePills .time-pill').forEach(b => b.classList.remove('time-pill-active'));
}

function applyTimePill(preset) {
  document.querySelectorAll('#salesTimePills .time-pill').forEach(b =>
    b.classList.toggle('time-pill-active', b.dataset.preset === preset));
  const fromEl = document.getElementById('salesFromDate');
  const toEl   = document.getElementById('salesToDate');
  if (!fromEl || !toEl) return;
  const toISO = d => localDayKey(d);
  const now = new Date();
  switch (preset) {
    case 'today': {
      const d = toISO(now); fromEl.value = d; toEl.value = d; break;
    }
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const d = toISO(y); fromEl.value = d; toEl.value = d; break;
    }
    case 'week': {
      const day = now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      fromEl.value = toISO(mon); toEl.value = toISO(now); break;
    }
    case 'month': {
      fromEl.value = toISO(new Date(now.getFullYear(), now.getMonth(), 1));
      toEl.value = toISO(now); break;
    }
    case 'all': {
      fromEl.value = ''; toEl.value = ''; break;
    }
  }
  renderSalesTable();
}

function populateSalesCategoryFilter() {
  const select = document.getElementById('salesCategoryFilter');
  if (!select) return;
  const cats = [...new Set((APP_STATE.products || []).map(p => p.category).filter(Boolean))].sort();
  const current = select.value;
  select.innerHTML = `<option value="">All Categories</option>`
    + cats.map(c => `<option value="${escapeHtml(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

/* ── Cart helpers ── */
function getCart() {
  return Array.isArray(APP_STATE.cart) ? APP_STATE.cart : [];
}

function setCart(cart) {
  updateState('cart', () => Array.isArray(cart) ? cart : []);
  renderCart();
  updateCartSummary();
  renderPOSProducts(); // refresh in-cart qty badges
}

function getProductById(productId) {
  return (APP_STATE.products || []).find(p => String(p.id) === String(productId));
}

function getIngredientById(ingredientId) {
  return (APP_STATE.ingredients || []).find(i => String(i.id) === String(ingredientId));
}

function getCartQuantityForProduct(productId) {
  return getCart()
    .filter(i => String(i.productId) === String(productId))
    .reduce((s, i) => s + Number(i.quantity || 0), 0);
}

function getCartUnitsForProduct(productId) {
  return getCart()
    .filter(i => String(i.productId) === String(productId))
    .reduce((s, i) => s + Number(i.quantity || 0) * Number(i.multiplier || 1), 0);
}

/* ── Cart render ── */
function renderCart() {
  const container = document.getElementById('cartItems');
  const itemCountEl = document.getElementById('cartItemCount');
  if (!container) return;

  const cart = getCart();
  const totalQty = cart.reduce((s, i) => s + Number(i.quantity || 0), 0);
  if (itemCountEl) itemCountEl.textContent = totalQty;

  if (!cart.length) {
    container.innerHTML = `
      <div class="empty-cart-state">
        <div class="empty-cart-icon">🛒</div>
        <div class="empty-cart-title">Cart is empty</div>
        <div class="empty-cart-subtitle">Tap a product to add it</div>
      </div>`;
    return;
  }

  container.innerHTML = '';
  cart.forEach(item => {
    const row = document.createElement('div');
    row.className = 'cart-line-item';
    row.innerHTML = `
      <div class="cart-line-info">
        <div class="cart-line-name">${escapeHtml(item.name)}</div>
        <div class="cart-line-price">${formatCurrency(item.price)} each</div>
      </div>
      <div class="cart-line-controls">
        <button type="button" data-action="decrease-qty" data-id="${item.id}">−</button>
        <span>${item.quantity}</span>
        <button type="button" data-action="increase-qty" data-id="${item.id}">+</button>
        <button type="button" class="cart-remove-btn" data-action="remove-from-cart" data-id="${item.id}">×</button>
      </div>
      <div class="cart-line-total">${formatCurrency(Number(item.price || 0) * Number(item.quantity || 0))}</div>`;
    container.appendChild(row);
  });
}

/* ── Money helpers ── */
function getElementByIds(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function parseMoney(value) {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').replace(/[^0-9.-]/g, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getDiscountState() {
  const valEl = getElementByIds(['discountValue']);
  const typeEl = getElementByIds(['discountType']);
  return { value: Number(valEl?.value || 0), type: typeEl?.value || 'percent' };
}

function calculateCartSubtotal() {
  return getCart().reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0);
}

function calculateCartDiscount() {
  const subtotal = calculateCartSubtotal();
  const { value, type } = getDiscountState();
  if (!value || value <= 0) return 0;
  const discount = type === 'percent' ? subtotal * (value / 100) : value;
  return round2(Math.max(0, Math.min(discount, subtotal)));
}

function calculateCartTax() {
  const taxRate = Number(APP_STATE.settings?.taxRate || 0);
  return round2(Math.max(0, (calculateCartSubtotal() - calculateCartDiscount()) * (taxRate / 100)));
}

function calculateCartTotal() {
  return round2(Math.max(0, calculateCartSubtotal() - calculateCartDiscount() + calculateCartTax()));
}

function updateCartSummary() {
  const subtotal = calculateCartSubtotal();
  const discount = calculateCartDiscount();
  const tax = calculateCartTax();
  const total = calculateCartTotal();

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

  set('cartSubtotal', formatCurrency(subtotal));
  set('cartDiscount', formatCurrency(discount));
  set('cartTax', formatCurrency(tax));
  set('cartTotal', formatCurrency(total));
  setVal('checkoutTotal', formatCurrency(total));

  calculateChange();
  return { subtotal, discount, tax, total };
}

function calculateChange() {
  const total = calculateCartTotal();
  const tenderedEl = getElementByIds(['checkoutTendered']);
  const changeEl = getElementByIds(['checkoutChange']);
  if (!tenderedEl || !changeEl) return 0;
  const tendered = parseMoney(tenderedEl.value);
  const change = Math.max(0, tendered - total);
  changeEl.value = formatCurrency(change);
  return change;
}

/* ── Add / remove / qty ── */
function addToCart(productId, variant = null) {
  const product = getProductById(productId);
  if (!product) { showNotification('Product not found', 'error'); return; }

  const stock = typeof getEffectiveStock === 'function'
    ? getEffectiveStock(product) : Number(product.stock || 0);
  if (stock <= 0) { showNotification('Out of stock', 'error'); return; }

  const cart = getCart();
  const variantId = variant?.id || '';
  const existing = cart.find(
    i => String(i.productId) === String(productId) && String(i.variantId || '') === String(variantId)
  );

  const unitsToAdd = Number(variant?.multiplier || 1);
  if ((getCartUnitsForProduct(productId) + unitsToAdd) > stock) {
    showNotification('Insufficient stock', 'error');
    return;
  }

  if (existing) {
    existing.quantity += 1;
  } else {
    const lineName = variant?.name ? `${product.name} (${variant.name})` : product.name;
    const linePrice = Number(variant?.price ?? product.price ?? 0);
    cart.push({
      id: generateId(), productId, variantId, name: lineName, price: linePrice,
      quantity: 1, recipe: Array.isArray(product.recipe) ? product.recipe : [],
      recipeMode: product.recipeMode || 'unit', batchYield: Number(product.batchYield || 1),
      multiplier: Number(variant?.multiplier || 1)
    });
  }
  setCart(cart);
}

function removeFromCart(id) {
  setCart(getCart().filter(i => String(i.id) !== String(id)));
}

function increaseQty(id) {
  const cart = getCart();
  const item = cart.find(x => String(x.id) === String(id));
  if (!item) return;
  const product = getProductById(item.productId);
  if (!product) return;
  const availableStock = typeof getEffectiveStock === 'function'
    ? getEffectiveStock(product) : Number(product.stock || 0);
  if ((getCartUnitsForProduct(item.productId) + Number(item.multiplier || 1)) > availableStock) {
    showNotification('Insufficient stock', 'error');
    return;
  }
  item.quantity += 1;
  setCart(cart);
}

function decreaseQty(id) {
  const cart = getCart();
  const item = cart.find(x => String(x.id) === String(id));
  if (!item) return;
  item.quantity -= 1;
  if (item.quantity <= 0) { removeFromCart(id); return; }
  setCart(cart);
}

function clearCart(skipConfirm = false) {
  if (!skipConfirm && getCart().length) {
    if (!confirm('Clear current cart?')) return;
  }
  setCart([]);
  const dvEl = document.getElementById('discountValue');
  if (dvEl) dvEl.value = '';
  showNotification('Cart cleared', 'info');
}

/* ── Hold orders ── */
function holdOrder() {
  const cart = getCart();
  if (!cart.length) { showNotification('Cart is empty', 'error'); return; }

  const heldOrders = Array.isArray(APP_STATE.heldOrders) ? APP_STATE.heldOrders : [];
  const customerName = (() => {
    const existing = getCheckoutCustomerName();
    const entered = window.prompt('Customer name (optional):', existing || '');
    return String(entered || existing || 'Walk-in Customer').trim();
  })();

  const snapshot = buildTransactionSnapshot({
    status: 'HELD', paymentStatus: 'PENDING',
    paymentMethod: getSelectedPaymentMethod(),
    tendered: 0, change: 0, referenceNumber: '', customerName, cartOverride: cart
  });

  heldOrders.push(snapshot);
  updateState('heldOrders', () => heldOrders);
  clearCart(true);
  renderHeldOrdersBadge();
  showNotification(`Order held for ${customerName}`, 'success');
}

function renderHeldOrdersBadge() {
  const badge = document.getElementById('heldOrdersBadge');
  if (!badge) return;
  badge.textContent = String(Array.isArray(APP_STATE.heldOrders) ? APP_STATE.heldOrders.length : 0);
}

/* ── Payment helpers ── */
function getSelectedPaymentMethod() {
  const el = getElementByIds(['checkoutPayment']);
  return String(el?.value || 'cash').toLowerCase();
}

function getCheckoutCustomerName() {
  const el = getElementByIds(['checkoutCustomer']);
  return String(el?.value || '').trim();
}

function getPaymentReference() {
  const el = getElementByIds(['paymentReference']);
  return String(el?.value || '').trim();
}

/* ── Checkout modal ── */
function openCheckoutModal() {
  if (!getCart().length) { showNotification('Cart is empty', 'error'); return; }

  // Reset customer name and tendered each time checkout opens
  const nameEl     = document.getElementById('checkoutCustomer');
  const tenderedEl = getElementByIds(['checkoutTendered']);
  const refEl      = document.getElementById('paymentReference');
  const notesEl    = document.getElementById('checkoutOrderNotes');
  if (nameEl)     nameEl.value     = '';
  if (tenderedEl) tenderedEl.value = '';
  if (refEl)      refEl.value      = '';
  if (notesEl)    notesEl.value    = '';

  // Reset payment to cash
  const payEl = document.getElementById('checkoutPayment');
  if (payEl) payEl.value = 'cash';

  // Reset split payment
  _resetSplitPayment();

  updateCartSummary();
  togglePaymentFields();
  calculateChange();
  openModal('checkoutModal');
}

function togglePaymentFields() {
  const method = getSelectedPaymentMethod();
  const qrphSection   = document.getElementById('qrphSection');
  const referenceWrap = document.getElementById('referenceWrap');
  const tenderedWrap  = document.getElementById('tenderedWrap');
  const quickAmounts  = document.getElementById('quickAmounts');

  const isCash = method === 'cash';

  // Look up the matching custom payment method by its generated value
  const methods = APP_STATE.settings?.paymentMethods || [];
  const matched = methods.find(m => m.name.toLowerCase().replace(/\s+/g, '_') === method);

  const methodType = matched ? matched.type : (isCash ? 'cash' : null);
  const isDigital  = !isCash && methodType !== 'cash';
  const showQR     = methodType === 'qr' && matched?.qrImage;

  if (tenderedWrap)  tenderedWrap.style.display  = isCash    ? 'block' : 'none';
  if (quickAmounts)  quickAmounts.style.display   = isCash    ? 'flex'  : 'none';
  if (referenceWrap) referenceWrap.style.display  = isDigital ? 'block' : 'none';
  if (qrphSection)   qrphSection.style.display    = showQR    ? 'block' : 'none';

  if (showQR && qrphSection) {
    const badge = qrphSection.querySelector('.payment-badge');
    if (badge) badge.textContent = (matched?.name || 'QR').toUpperCase() + ' PAYMENT';

    const img      = document.getElementById('paymentQRImage');
    const fallback = document.getElementById('paymentQRFallback');

    if (matched?.qrImage && img) {
      img.src           = matched.qrImage;
      img.style.display = 'block';
      if (fallback) fallback.style.display = 'none';
    } else {
      if (img)     img.style.display     = 'none';
      if (fallback) fallback.style.display = 'flex';
    }
  }

  calculateChange();
}

/* ── Transaction builder ── */
function buildTransactionSnapshot({ status, paymentStatus, paymentMethod, tendered, change,
    referenceNumber, customerName, orderNotes, cartOverride = null }) {
  const cart = Array.isArray(cartOverride) ? cartOverride : getCart();
  const items = cart.map(item => ({
    id: item.id, productId: item.productId, variantId: item.variantId || '',
    multiplier: Number(item.multiplier || 1), name: item.name,
    quantity: Number(item.quantity || 0), price: Number(item.price || 0),
    total: Number(item.price || 0) * Number(item.quantity || 0),
    recipe: Array.isArray(item.recipe) ? item.recipe : [],
    recipeMode: item.recipeMode || 'unit', batchYield: Number(item.batchYield || 1)
  }));

  const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
  const discount = calculateCartDiscount();
  const tax = calculateCartTax();
  const total = round2(Math.max(0, subtotal - discount + tax));
  const timestamp = new Date().toISOString();
  const receiptNumber = generateReceiptNumber();
  const orderType = APP_STATE.ui?.orderType || 'Dine In';

  return {
    id: generateId(), receiptNumber, status, paymentStatus, orderType,
    // Stamped while an event session is running so the event's revenue and
    // break-even progress can be attributed. Null during normal trading.
    eventId: (typeof getActiveEvent === 'function' ? getActiveEvent()?.id : null) || null,
    notes: orderNotes || '',
    customer: { name: customerName || 'Walk-in Customer' },
    payment: {
      method: paymentMethod, tendered: Number(tendered || 0),
      change: Number(change || 0), referenceNumber: referenceNumber || ''
    },
    totals: { subtotal, discount, tax, total },
    items,
    audit: {
      createdAt: timestamp,
      completedAt: status === 'COMPLETED' ? timestamp : null,
      completedBy: APP_STATE.currentUserRole || 'STAFF'
    },
    // Legacy flat fields for compatibility
    customerName: customerName || 'Walk-in Customer',
    paymentMethod, subtotal, discount, tax, total,
    tendered: Number(tendered || 0), change: Number(change || 0),
    referenceNumber: referenceNumber || '', createdAt: timestamp,
    completedAt: status === 'COMPLETED' ? timestamp : null
  };
}

/* ── Inventory deduction ── */
function deductInventoryForCart(cart) {
  const ingredientDeltas = new Map();
  cart.forEach(line => {
    const product = getProductById(line.productId);
    if (!product) return;
    const recipeItems = Array.isArray(product.recipe) ? product.recipe : [];
    const batchYield = Math.max(1, Number(product.batchYield || 1));
    const recipeMode = String(product.recipeMode || 'unit');
    recipeItems.forEach(recipeItem => {
      const ingredient = getIngredientById(recipeItem.ingredientId);
      if (!ingredient) return;
      const perProduct = Number(recipeItem.quantity || 0);
      const usagePerUnit = recipeMode === 'batch' ? perProduct / batchYield : perProduct;
      const totalUsage = usagePerUnit * Number(line.quantity || 0);
      ingredientDeltas.set(ingredient.id, (ingredientDeltas.get(ingredient.id) || 0) + totalUsage);
    });
  });

  if (!ingredientDeltas.size) return;

  // Capture previous stocks before update so movement log is accurate
  const previousStocks = new Map();
  getIngredients().forEach(ing => {
    if (ingredientDeltas.has(ing.id)) previousStocks.set(ing.id, Number(ing.stock || 0));
  });

  const updatedIngredients = getIngredients().map(ingredient => {
    if (!ingredientDeltas.has(ingredient.id)) return ingredient;
    return { ...ingredient, stock: Math.max(0, Number(ingredient.stock || 0) - ingredientDeltas.get(ingredient.id)) };
  });
  if (typeof setIngredients === 'function') setIngredients(updatedIngredients);

  const movements = Array.isArray(APP_STATE.inventoryMovements) ? APP_STATE.inventoryMovements : [];
  ingredientDeltas.forEach((usedQty, ingredientId) => {
    const ingredient = getIngredientById(ingredientId);
    if (!ingredient) return;
    const prevStock = previousStocks.get(ingredientId) ?? Number(ingredient.stock || 0) + usedQty;
    movements.push({
      id: generateId(), ingredientId, ingredientName: ingredient.name,
      type: 'sale-deduction', quantityAdded: 0, quantityUsed: usedQty,
      reason: 'Sale deduction', previousStock: prevStock,
      newStock: Number(ingredient.stock || 0),
      createdAt: new Date().toISOString(), createdBy: APP_STATE.currentUserRole || 'STAFF'
    });
  });
  if (typeof setInventoryMovements === 'function') setInventoryMovements(movements);
  else updateState('inventoryMovements', () => movements);
}

function deductProductStockForCart(cart) {
  const updatedProducts = getProducts().map(product => {
    // Finished-goods products track stock in the separate FG ledger —
    // never touch product.stock for these, or the field drifts with
    // no relationship to actual availability.
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      return product;
    }
    const quantitySold = cart.reduce((sum, line) => {
      if (String(line.productId) !== String(product.id)) return sum;
      return sum + Number(line.quantity || 0) * Number(line.multiplier || 1);
    }, 0);
    if (!quantitySold) return product;
    return { ...product, stock: Math.max(0, Number(product.stock || 0) - quantitySold) };
  });
  if (typeof setProducts === 'function') setProducts(updatedProducts);
  else updateState('products', () => updatedProducts);
}

/* ── Complete sale ── */
function pushSale(transaction) {
  const sales = Array.isArray(APP_STATE.sales) ? APP_STATE.sales : [];
  sales.push(transaction);
  updateState('sales', () => sales);
  if (typeof refreshDashboard === 'function') refreshDashboard();
}

async function completeSale(forceStatus = 'COMPLETED') {
  const cart = getCart();
  if (!cart.length) { showNotification('Cart is empty', 'error'); return; }

  const method = getSelectedPaymentMethod();
  const customerName = getCheckoutCustomerName();
  const referenceNumber = getPaymentReference();
  const orderNotes = document.getElementById('checkoutOrderNotes')?.value?.trim() || '';
  const total = calculateCartTotal();
  const isPending = String(forceStatus).toUpperCase() === 'PENDING';
  const paymentStatus = isPending ? 'PENDING' : 'PAID';

  // Determine if this method behaves like cash (no reference number needed)
  const _methods = APP_STATE.settings?.paymentMethods || [];
  const _matched = _methods.find(m => m.name.toLowerCase().replace(/\s+/g, '_') === method);
  const isCashLike = method === 'cash' || _matched?.type === 'cash';

  let tendered = 0, change = 0;

  if (!isPending && isCashLike) {
    const tenderedEl = getElementByIds(['checkoutTendered']);
    tendered = parseMoney(tenderedEl?.value);
    if (tendered <= 0) tendered = total;
    if (tendered < total) { showNotification('Amount tendered is not enough', 'error'); return; }
    change = tendered - total;
  } else if (!isPending) {
    tendered = total;
  }

  // Validate split payment
  if (!isPending && typeof isSplitActive === 'function' && isSplitActive()) {
    const split = getSplitPaymentData();
    if (!split || split.amount <= 0) {
      showNotification('Enter the split payment amount', 'error'); return;
    }
    if (split.amount >= total) {
      showNotification('Split amount must be less than the total', 'error'); return;
    }
  }

  // Stock validation
  for (const product of getProducts()) {
    const requiredUnits = cart.reduce((sum, line) => {
      if (String(line.productId) !== String(product.id)) return sum;
      return sum + Number(line.quantity || 0) * Number(line.multiplier || 1);
    }, 0);
    if (!requiredUnits) continue;
    const availableUnits = typeof getEffectiveStock === 'function'
      ? getEffectiveStock(product) : Number(product.stock || 0);
    if (requiredUnits > availableUnits) {
      showNotification(`${product.name}: insufficient stock`, 'error');
      return;
    }
  }

  const transaction = buildTransactionSnapshot({
    status: isPending ? 'PENDING' : 'COMPLETED',
    paymentStatus, paymentMethod: method,
    tendered, change, referenceNumber, customerName, orderNotes, cartOverride: cart
  });

  // Attach split payment info if active
  if (!isPending && typeof isSplitActive === 'function' && isSplitActive()) {
    const split = getSplitPaymentData();
    if (split && split.amount > 0) {
      transaction.payment.splitMethod    = split.method;
      transaction.payment.splitAmount    = split.amount;
      transaction.payment.splitReference = split.reference || '';
      // Annotate the display method string
      transaction.payment.method = `${method} + ${split.method}`;
    }
  }

  if (isPending) {
    transaction.audit = transaction.audit || {};
    transaction.audit.inventoryDeducted = true;
  }

  // Seal BEFORE pushing — await ensures hash is present when persisted
  if (typeof sealTransaction === 'function') {
    await sealTransaction(transaction);
  }

  pushSale(transaction);
  deductProductStockForCart(cart);

  // Route deduction by category mode:
  // - Finished Goods products: deduct from finishedGoods stock
  // - Direct products: deduct ingredients via recipe
  const fgCart     = cart.filter(line => {
    const prod = (APP_STATE.products||[]).find(p => String(p.id) === String(line.productId));
    return typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(prod);
  });
  const directCart = cart.filter(line => {
    const prod = (APP_STATE.products||[]).find(p => String(p.id) === String(line.productId));
    return !(typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(prod));
  });

  if (directCart.length) deductInventoryForCart(directCart);
  if (fgCart.length && typeof deductFGForCart === 'function') deductFGForCart(fgCart);

  // Audit trail entry for this sale
  if (typeof pushAuditEntry === 'function') {
    pushAuditEntry({
      action:        isPending ? 'SALE_PENDING' : 'SALE_COMPLETED',
      saleId:        transaction.id,
      receiptNumber: transaction.receiptNumber,
      total:         transaction.totals?.total ?? transaction.total ?? 0,
      outcome:       'SUCCESS',
      note:          `${isPending ? 'Pending order' : 'Sale'} · ${method} · ${formatCurrency(transaction.totals?.total ?? transaction.total ?? 0)}`
    });
  }

  clearCart(true);
  closeModal('checkoutModal');
  renderReceipt(transaction);
  openModal('receiptModal');
  showNotification(isPending ? 'Order marked pending' : 'Sale completed! 🎉', 'success');
  renderSalesTable();
  renderHeldOrdersBadge();
  // Event break-even moves with every sale
  if (typeof refreshEventBreakEven === 'function') refreshEventBreakEven();
}

/* ── Receipt ── */
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderReceipt(transaction) {
  const body = document.getElementById('receiptBody');
  if (!body) return;

  const brand = APP_STATE.settings?.brandName || 'Caflat.CORE';
  const footer = APP_STATE.settings?.receiptFooter || '';
  const dateText = new Date(transaction.audit?.completedAt || transaction.audit?.createdAt).toLocaleString();
  const orderType = transaction.orderType || '';

  const itemsHtml = transaction.items.map(item => `
    <div class="receipt-line">
      <span>${escapeHtml(item.name)} ×${item.quantity}</span>
      <span>${formatCurrency(item.total)}</span>
    </div>`).join('');

  const referenceLine = transaction.payment?.referenceNumber
    ? `<div class="receipt-line"><span>Reference</span><span>${escapeHtml(transaction.payment.referenceNumber)}</span></div>` : '';

  const orderTypeLine = orderType
    ? `<div class="receipt-line"><span>Order Type</span><span>${escapeHtml(orderType)}</span></div>` : '';

  body.innerHTML = `
    <div class="receipt-header">
      ${APP_STATE.settings?.receiptLogo ? `
        <div style="text-align:center;margin-bottom:8px;">
          <img src="${APP_STATE.settings.receiptLogo}" alt=""
            style="max-height:48px;max-width:120px;object-fit:contain;" />
        </div>` : ''}
      <div class="receipt-brand">${escapeHtml(brand)}</div>
      <div>${dateText}</div>
      <div>${escapeHtml(transaction.receiptNumber)}</div>
      <div style="font-size:10px;opacity:.6;">${escapeHtml(transaction.status)}</div>
    </div>
    <div class="receipt-line"><span>Customer</span><span>${escapeHtml(transaction.customer?.name || 'Walk-in')}</span></div>
    ${transaction.notes ? `
    <div class="receipt-line" style="color:var(--gray-500);font-style:italic;">
      <span>Notes</span><span style="max-width:180px;text-align:right;">${escapeHtml(transaction.notes)}</span>
    </div>` : ''}
    ${orderTypeLine}
    <div class="receipt-line"><span>Payment</span><span>${escapeHtml(transaction.payment?.method || 'cash').toUpperCase()}</span></div>
    ${referenceLine}
    <div class="receipt-divider"></div>
    ${itemsHtml}
    <div class="receipt-divider"></div>
    <div class="receipt-line"><span>Subtotal</span><span>${formatCurrency(transaction.totals.subtotal)}</span></div>
    ${Number(transaction.totals.discount) > 0 ? `<div class="receipt-line"><span>Discount</span><span>-${formatCurrency(transaction.totals.discount)}</span></div>` : ''}
    ${Number(transaction.totals.tax) > 0 ? `<div class="receipt-line"><span>Tax</span><span>${formatCurrency(transaction.totals.tax)}</span></div>` : ''}
    <div class="receipt-line receipt-total"><span>TOTAL</span><span>${formatCurrency(transaction.totals.total)}</span></div>
    ${Number(transaction.payment?.tendered) > 0 ? `<div class="receipt-line"><span>Tendered</span><span>${formatCurrency(transaction.payment.tendered)}</span></div>` : ''}
    ${Number(transaction.payment?.change) > 0 ? `<div class="receipt-line"><span>Change</span><span>${formatCurrency(transaction.payment.change)}</span></div>` : ''}
    ${footer ? `<div class="receipt-divider"></div><div style="text-align:center;font-size:10px;padding:4px 0;">${escapeHtml(footer)}</div>` : ''}
    <div class="receipt-divider"></div>
    <div id="receiptQRContainer" style="text-align:center;padding:8px 0;">
      <div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;
        color:#999;margin-bottom:8px;">Scan for digital copy</div>
      <div id="receiptQRDiv"
        style="display:inline-block;padding:8px;background:#fff;
          border:1px solid #e8e8e8;border-radius:8px;"></div>
    </div>
  `;

  // Generate QR after DOM renders
  setTimeout(() => _generateReceiptQR(transaction), 80);
}

function _generateReceiptQR(transaction) {
  const qrDiv = document.getElementById('receiptQRDiv');
  if (!qrDiv) return;
  qrDiv.innerHTML = '';

  const brand    = APP_STATE.settings?.brandName || 'Caflat.CORE';
  const items    = Array.isArray(transaction.items) ? transaction.items : [];
  const itemsStr = items.map(i =>
    [i.name || i.productName || 'Item', i.quantity || 1, i.price || 0,
     i.lineTotal ?? i.total ?? (Number(i.price || 0) * Number(i.quantity || 1))].join('~')
  ).join('|');

  const saleDate = new Date(transaction.audit?.completedAt || transaction.createdAt || Date.now());
  const dt = saleDate.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

  // Build receipt.html URL — use configured base or auto-detect from current page
  const configuredBase = String(APP_STATE.settings?.receiptBaseUrl || '').trim().replace(/\/+$/, '');
  const autoBase = window.location.href.split('?')[0].replace(/\/[^/]*$/, '');
  const receiptPage = (configuredBase || autoBase) + '/receipt.html';

  const params = new URLSearchParams({
    b:    brand,
    r:    transaction.receiptNumber || transaction.id || '',
    s:    transaction.status || 'COMPLETED',
    dt,
    c:    transaction.customer?.name || transaction.customerName || '',
    ot:   transaction.orderType || '',
    pm:   (transaction.payment?.method || transaction.paymentMethod || '').toUpperCase(),
    ref:  transaction.payment?.referenceNumber || transaction.referenceNumber || '',
    sub:  String(transaction.totals?.subtotal ?? transaction.subtotal ?? 0),
    disc: String(transaction.totals?.discount ?? transaction.discount ?? 0),
    tx:   String(transaction.totals?.tax       ?? transaction.tax      ?? 0),
    tot:  String(transaction.totals?.total     ?? transaction.total    ?? 0),
    tnd:  String(transaction.payment?.tendered ?? transaction.tendered ?? 0),
    chg:  String(transaction.payment?.change   ?? transaction.change   ?? 0),
    ft:   APP_STATE.settings?.receiptFooter || '',
    i:    itemsStr,
  });
  // Strip empty params to keep URL shorter
  for (const [k, v] of [...params.entries()]) {
    if (!v || v === '0') params.delete(k);
  }
  const url = `${receiptPage}?${params.toString()}`;

  if (typeof QRCode !== 'undefined') {
    try {
      qrDiv.style.width  = '220px';
      qrDiv.style.height = '220px';
      new QRCode(qrDiv, {
        text:         url,
        width:        220,
        height:       220,
        colorDark:    '#000000',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      return;
    } catch(e) {
      console.warn('QRCode generation failed:', e);
    }
  }

  qrDiv.textContent = url;
}

function _receiptQRFallback(container, text) {
  // Legacy fallback — kept for safety
  if (!container) return;
  container.innerHTML = `<pre style="font-size:8px;text-align:left;background:#f4f4f4;
    padding:8px;border-radius:4px;max-height:100px;overflow:auto;
    white-space:pre-wrap;word-break:break-all;">${escapeHtml(text)}</pre>`;
}

function openSaleReceipt(saleId) {
  const sale = getSales().find(s => String(s.id) === String(saleId));
  if (!sale) return;
  renderReceipt(sale);
  openModal('receiptModal');
}

/* ── Sales table ── */
function getSales() {
  return Array.isArray(APP_STATE.sales) ? APP_STATE.sales : [];
}

function renderSalesTable() {
  const tableBody = document.querySelector('#salesTable tbody');
  if (!tableBody) return;

  populateSalesCategoryFilter();

  const fromDate       = document.getElementById('salesFromDate')?.value ? new Date(`${document.getElementById('salesFromDate').value}T00:00:00`) : null;
  const toDate         = document.getElementById('salesToDate')?.value ? new Date(`${document.getElementById('salesToDate').value}T23:59:59`) : null;
  const paymentFilter  = String(document.getElementById('salesPaymentFilter')?.value  || '').toLowerCase();
  const statusFilter   = String(document.getElementById('salesStatusFilter')?.value   || '').toUpperCase();
  const categoryFilter = String(document.getElementById('salesCategoryFilter')?.value || '');
  const channelFilter  = String(document.getElementById('salesChannelFilter')?.value  || '').toUpperCase();
  const searchQuery    = String(document.getElementById('salesSearch')?.value || '').toLowerCase().trim();

  const sales = getSales().filter(sale => {
    const saleDate = new Date(sale.audit?.completedAt || sale.completedAt || sale.createdAt || Date.now());
    const matchesFrom     = !fromDate       || saleDate >= fromDate;
    const matchesTo       = !toDate         || saleDate <= toDate;
    const matchesPayment  = !paymentFilter  || paymentFilter === 'all' || String(sale.payment?.method || sale.paymentMethod || '').toLowerCase() === paymentFilter;
    const matchesStatus   = !statusFilter   || String(sale.status || '').toUpperCase() === statusFilter;
    const matchesChannel  = !channelFilter  || String(sale.channel || 'POS').toUpperCase() === channelFilter;
    const matchesCategory = !categoryFilter || (sale.items || []).some(item => {
      const prod = getProductById(item.productId);
      return prod && prod.category === categoryFilter;
    });
    const matchesSearch   = !searchQuery || [
      sale.receiptNumber || '',
      sale.customer?.name || sale.customerName || '',
      sale.payment?.method || sale.paymentMethod || '',
      String(sale.totals?.total ?? sale.total ?? ''),
      ...(sale.items || []).map(i => i.name || i.productName || '')
    ].some(field => field.toLowerCase().includes(searchQuery));
    return matchesFrom && matchesTo && matchesPayment && matchesStatus && matchesChannel && matchesCategory && matchesSearch;
  });

  // Filter summary
  const summaryEl = document.getElementById('salesFilterSummary');
  if (summaryEl) {
    const total = getSales().length;
    const active = [fromDate, toDate, paymentFilter, statusFilter, categoryFilter, channelFilter, searchQuery].some(Boolean);
    if (active && total > 0) {
      summaryEl.style.display = '';
      summaryEl.textContent = `Showing ${sales.length} of ${total} sale${total !== 1 ? 's' : ''}`;
    } else {
      summaryEl.style.display = 'none';
    }
  }

  tableBody.innerHTML = '';

  if (!sales.length) {
    tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No sales found</td></tr>`;
    return;
  }


  const limit = window.salesTableLimit || 20;
  const paged = sales.slice().reverse().slice(0, limit);

  paged.forEach(sale => {
    const saleDate   = new Date(sale.audit?.completedAt || sale.completedAt || sale.createdAt || Date.now());
    const saleStatus = (sale.status || '').toUpperCase();
    const statusClass = saleStatus === 'PENDING'  ? 'badge-pending'
                      : saleStatus === 'REFUNDED' ? 'badge-refunded'
                      : saleStatus === 'VOIDED'   ? 'badge-voided'
                      : 'badge-ok';

    const items      = Array.isArray(sale.items) ? sale.items : [];
    const itemsShow  = items.slice(0, 10);
    const itemsMore  = items.length - 10;
    const expandId   = 'sitems-' + sale.id;

    const itemRowsHTML = itemsShow.map(i => {
      const nm  = escapeHtml(i.name || i.productName || 'Product');
      const qty = i.quantity || i.qty || 0;
      const tot = i.lineTotal || i.total || 0;
      return '<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:11px;">'
        + '<span>' + nm + ' <span style="color:var(--gray-400);">×' + qty + '</span></span>'
        + '<span style="font-weight:700;">' + formatCurrency(tot) + '</span></div>';
    }).join('');

    const moreHTML = itemsMore > 0
      ? '<div style="font-size:10px;color:var(--gray-400);padding-top:2px;">+' + itemsMore + ' more item' + (itemsMore > 1 ? 's' : '') + '</div>'
      : '';

    const summary = escapeHtml(items.slice(0,3).map(i => (i.name||i.productName||'?') + ' ×' + (i.quantity||i.qty||0)).join(', '))
      + (items.length > 3 ? '…' : '');

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="font-family:var(--font-mono);font-size:11px;">${escapeHtml(sale.receiptNumber || sale.id || '')}</td>
      <td style="font-size:11px;">${saleDate.toLocaleDateString()}<br>
        <span style="color:var(--gray-400);">${saleDate.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span></td>
      <td>
        <div style="cursor:pointer;margin-bottom:3px;" onclick="(function(){var d=document.getElementById('${expandId}');if(d)d.style.display=d.style.display==='none'?'block':'none';})()">
          <span style="font-size:11px;font-weight:700;">${items.length} item${items.length!==1?'s':''}</span>
          <span style="font-size:10px;color:var(--gray-400);margin-left:4px;">▾</span>
        </div>
        <div style="font-size:10px;color:var(--gray-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${summary}</div>
        <div id="${expandId}" style="display:none;border-top:1px solid var(--border);margin-top:4px;padding-top:4px;">
          ${itemRowsHTML}${moreHTML}
        </div>
      </td>
      <td style="font-weight:800;">${formatCurrency(sale.totals?.total ?? sale.total ?? 0)}</td>
      <td style="font-size:11px;">${escapeHtml((sale.payment?.method||sale.paymentMethod||'cash').toUpperCase())}</td>
      <td><span class="${statusClass}">${escapeHtml(sale.status||'COMPLETED')}</span></td>
      <td>
        <div class="table-actions">
          ${saleStatus==='PENDING'
            ? `<button type="button" class="btn btn-sm" data-action="complete-pending-sale" data-id="${sale.id}">Complete</button>
               <button type="button" class="btn btn-sm btn-secondary" data-action="cancel-pending-sale" data-id="${sale.id}">Cancel</button>`
            : saleStatus==='VOIDED'
              ? `<button type="button" class="btn btn-sm btn-secondary" data-action="open-sale-receipt" data-id="${sale.id}">Receipt</button>`
              : `<button type="button" class="btn btn-sm btn-secondary" data-action="open-sale-receipt" data-id="${sale.id}">Receipt</button>
                 <button type="button" class="btn btn-sm btn-secondary" data-action="view-transaction-timeline" data-id="${sale.id}">Timeline</button>
                 <button type="button" class="btn btn-sm btn-danger" data-action="open-void-modal" data-id="${sale.id}">Void</button>
                 <button type="button" class="btn btn-sm refund-action-btn" data-action="open-refund-modal" data-id="${sale.id}">Refund</button>`}
        </div>
      </td>`;
    tableBody.appendChild(row);
  });


  // See more
  if (typeof _renderSeeMore === 'function') {
    _renderSeeMore(
      'salesSeeMore', sales.length, window.salesTableLimit || 20,
      () => { window.salesTableLimit = (window.salesTableLimit || 20) + 20; renderSalesTable(); },
      () => { window.salesTableLimit = 20; renderSalesTable(); }
    );
  }
}

function exportSalesReport() {
  if (typeof requireTier === 'function' && !requireTier('pro', 'Report exports (CSV)')) return;
  const sales = getSales();
  const lines = [['Receipt','Date','Payment','Order Type','Status','Subtotal','Discount','Tax','Total'].join(',')];
  sales.forEach(sale => {
    const saleDate = new Date(sale.audit?.completedAt || sale.completedAt || sale.createdAt || Date.now());
    lines.push([
      `"${sale.receiptNumber || sale.id || ''}"`,
      saleDate.toISOString(),
      sale.payment?.method || sale.paymentMethod || '',
      sale.orderType || '',
      sale.status || '',
      Number(sale.totals?.subtotal ?? sale.subtotal ?? 0),
      Number(sale.totals?.discount ?? sale.discount ?? 0),
      Number(sale.totals?.tax ?? sale.tax ?? 0),
      Number(sale.totals?.total ?? sale.total ?? 0)
    ].join(','));
  });
  downloadTextFile(`sales-report-${Date.now()}.csv`, lines.join('\n'));
  showNotification('Sales report exported', 'success');
}

/* ── Pending sale management ── */
async function completePendingSale(saleId) {
  const sales = getSales();
  const sale = sales.find(s => String(s.id) === String(saleId));
  if (!sale) return;
  sale.status = 'COMPLETED';
  sale.paymentStatus = 'PAID';
  sale.audit = sale.audit || {};
  sale.audit.completedAt = new Date().toISOString();
  sale.audit.inventoryDeducted = true;

  // Re-seal — the integrity hash covers status, so it must be recomputed
  // after this transition or verifyTransaction() will flag it as tampered.
  if (typeof sealTransaction === 'function') {
    await sealTransaction(sale);
  }

  updateState('sales', () => sales);
  renderSalesTable();
  if (typeof refreshDashboard === 'function') refreshDashboard();
  showNotification('Pending sale completed', 'success');
}

function restoreInventoryForSale(sale) {
  const ingredientReturns = new Map();
  (sale.items || []).forEach(line => {
    const product = getProductById(line.productId);
    if (!product) return;

    // FG-mode products: restore via the FG ledger, not ingredients —
    // ingredients for these were already consumed at production time.
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      if (typeof _setFGRecord === 'function') {
        const units = Number(line.quantity || 0) * Number(line.multiplier || 1);
        _setFGRecord(product.id, product.name, units, 0,
          `Pending sale cancelled: ${sale.receiptNumber || sale.id}`, 'pending-cancel-restore');
      }
      return;
    }

    const recipeItems = Array.isArray(product.recipe) ? product.recipe : [];
    const batchYield = Math.max(1, Number(product.batchYield || 1));
    const recipeMode = String(product.recipeMode || 'unit');
    recipeItems.forEach(recipeItem => {
      const perProduct = Number(recipeItem.quantity || 0);
      const usagePerUnit = recipeMode === 'batch' ? perProduct / batchYield : perProduct;
      const restoreQty = usagePerUnit * Number(line.quantity || 0);
      ingredientReturns.set(recipeItem.ingredientId, (ingredientReturns.get(recipeItem.ingredientId) || 0) + restoreQty);
    });
  });
  if (!ingredientReturns.size) return;
  const updatedIngredients = getIngredients().map(ingredient => {
    const restoreQty = ingredientReturns.get(ingredient.id);
    if (!restoreQty) return ingredient;
    return { ...ingredient, stock: Number(ingredient.stock || 0) + restoreQty };
  });
  if (typeof setIngredients === 'function') setIngredients(updatedIngredients);
  const movements = Array.isArray(APP_STATE.inventoryMovements) ? APP_STATE.inventoryMovements : [];
  ingredientReturns.forEach((qty, ingredientId) => {
    const ingredient = getIngredientById(ingredientId);
    if (!ingredient) return;
    movements.push({
      id: generateId(), ingredientId, ingredientName: ingredient.name,
      type: 'pending-cancel-restoration', quantityAdded: qty, quantityUsed: 0,
      reason: 'Pending sale cancelled', previousStock: Number(ingredient.stock || 0),
      newStock: Number(ingredient.stock || 0) + qty,
      createdAt: new Date().toISOString(), createdBy: APP_STATE.currentUserRole || 'STAFF'
    });
  });
  if (typeof setInventoryMovements === 'function') setInventoryMovements(movements);
  else updateState('inventoryMovements', () => movements);
}

function cancelPendingSale(saleId) {
  const sales = getSales();
  const sale = sales.find(s => String(s.id) === String(saleId));
  if (!sale) return;
  if (sale.audit?.inventoryDeducted) {
    const updatedProducts = getProducts().map(product => {
      // FG-mode products restore via the FG ledger inside restoreInventoryForSale below.
      if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
        return product;
      }
      const qty = (sale.items || []).reduce((sum, line) => {
        if (String(line.productId) !== String(product.id)) return sum;
        return sum + Number(line.quantity || 0) * Number(line.multiplier || 1);
      }, 0);
      if (!qty) return product;
      return { ...product, stock: Number(product.stock || 0) + qty };
    });
    if (typeof setProducts === 'function') setProducts(updatedProducts);
    else updateState('products', () => updatedProducts);
    restoreInventoryForSale(sale);
  }
  updateState('sales', () => sales.filter(s => String(s.id) !== String(saleId)));
  renderSalesTable();
  showNotification('Pending sale cancelled — stock restored', 'success');
}

/* ── Held orders modal ── */
function openHeldOrdersModal() {
  const modal = document.getElementById('heldOrdersModal');
  const list = document.getElementById('heldOrdersList');
  if (!modal || !list) return;

  const held = Array.isArray(APP_STATE.heldOrders) ? APP_STATE.heldOrders : [];
  list.innerHTML = held.map((o, i) => {
    const total = o.totals?.total || o.total || 0;
    const items = (o.items || []).length;
    const name = o.customer?.name || o.customerName || 'Walk-in Customer';
    const time = new Date(o.audit?.createdAt || o.createdAt || Date.now());
    const timeStr = time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    return `
      <div class="held-order-card" data-held-index="${i}">
        <div class="held-order-name">${escapeHtml(name)}</div>
        <div class="held-order-meta">${items} item(s) · ${formatCurrency(total)} · ${timeStr}</div>
      </div>`;
  }).join('') || '<div class="empty-state">No held orders</div>';

  modal.classList.remove('hidden');
}

function closeHeldOrdersModal() {
  const m = document.getElementById('heldOrdersModal');
  if (m) m.classList.add('hidden');
}

function resumeHeldOrder(index) {
  const held = Array.isArray(APP_STATE.heldOrders) ? APP_STATE.heldOrders : [];
  const order = held[index];
  if (!order) return;
  updateState('cart', () => Array.isArray(order.items) ? order.items : []);
  held.splice(index, 1);
  updateState('heldOrders', () => held);
  renderCart();
  updateCartSummary();
  renderHeldOrdersBadge();
  closeHeldOrdersModal();
  showNotification('Order resumed', 'success');
}

document.addEventListener('click', (e) => {
  const card = e.target.closest('.held-order-card');
  if (card) resumeHeldOrder(Number(card.dataset.heldIndex));
  if (e.target && (e.target.id === 'closeHeldOrdersBtn' || e.target.closest('#closeHeldOrdersBtn')))
    closeHeldOrdersModal();
});

/* ── Quick cash amounts ── */
function setQuickAmount(amount) {
  const el = document.getElementById('checkoutTendered');
  if (el) { el.value = amount; calculateChange(); }
}

/* ── Print receipt ── */
/* ─────────────────────────────────────────────
   PRINT RECEIPT
   • Desktop/laptop: opens a clean print window (works with any wired printer)
   • Mobile/tablet:  uses window.print() on a hidden iframe (avoids popup blockers)
   • Bluetooth thermal: Web Bluetooth API → ESC/POS commands to paired printer
   ───────────────────────────────────────────── */
function printReceipt() {
  const receiptBody = document.getElementById('receiptBody');
  if (!receiptBody) { showNotification('Receipt not found', 'error'); return; }

  // Show print options modal
  _openPrintOptionsModal(receiptBody);
}

function _buildPrintHTML(receiptBody) {
  const brand = APP_STATE.settings?.brandName || 'Caflat.CORE';
  // Clone so we can clean up SVG QR for print (SVG prints fine natively)
  const clone = receiptBody.cloneNode(true);
  return `<!DOCTYPE html><html><head>
    <title>Receipt — ${brand}</title>
    <meta charset="utf-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Courier New', monospace; font-size: 12px; color: #000;
             background: #fff; padding: 12px; }
      .receipt { max-width: 300px; margin: 0 auto; }
      .receipt-header { text-align: center; border-bottom: 1px dashed #000;
                        padding-bottom: 8px; margin-bottom: 8px; }
      .receipt-brand  { font-weight: bold; letter-spacing: 2px;
                        font-size: 14px; margin-bottom: 4px; text-transform: uppercase; }
      .receipt-line   { display: flex; justify-content: space-between;
                        gap: 8px; padding: 2px 0; }
      .receipt-items  { margin: 6px 0; }
      .receipt-item   { display: flex; justify-content: space-between;
                        gap: 8px; padding: 1px 0; font-size: 11px; }
      .receipt-divider{ border-top: 1px dashed #000; margin: 6px 0; }
      .receipt-total  { font-weight: bold; font-size: 13px; }
      #receiptQRContainer { text-align: center; padding: 6px 0; }
      #receiptQRDiv   { display: inline-block; }
      svg             { display: block; margin: 0 auto; }
      @media print    { @page { margin: 4mm; } body { padding: 0; } }
    </style>
  </head><body>
    <div class="receipt">${clone.innerHTML}</div>
  </body></html>`;
}

/* ── Standard print (desktop + wired printer) ── */
function _printStandard(receiptBody) {
  const html = _buildPrintHTML(receiptBody);
  // Use hidden iframe to avoid popup blockers (especially on iPad/mobile)
  let iframe = document.getElementById('_caflat_print_frame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '_caflat_print_frame';
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:none;';
    document.body.appendChild(iframe);
  }
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch(e) {
      // Fallback for browsers that block iframe.print()
      const pw = window.open('', '_blank', 'width=400,height=600');
      if (pw) {
        pw.document.write(html);
        pw.document.close();
        pw.print();
      } else {
        showNotification('Please allow popups for printing', 'error');
      }
    }
  }, 400);
}

/* ── Bluetooth thermal printer (ESC/POS) ── */
async function _printBluetooth(receiptBody) {
  if (!navigator.bluetooth) {
    showNotification('Web Bluetooth not supported on this browser. Use Chrome or Edge.', 'error');
    return;
  }
  let device = null;
  try {
    showNotification('Searching for Bluetooth printer…', 'info');

    // Request any Bluetooth device that exposes a serial-like GATT service
    // Most ESC/POS thermal printers use one of these service UUIDs
    const PRINT_SERVICES = [
      '000018f0-0000-1000-8000-00805f9b34fb', // Common BT thermal (e.g. GOOJPRT, MUNBYN)
      '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Bluetooth serial port emulation
      'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Another common thermal UUID
    ];

    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [PRINT_SERVICES[0]] }],
      optionalServices: PRINT_SERVICES
    });

    showNotification(`Connecting to ${device.name || 'printer'}…`, 'info');
    const server  = await device.gatt.connect();

    // Try each known service UUID until one works
    let characteristic = null;
    for (const svcUUID of PRINT_SERVICES) {
      try {
        const service = await server.getPrimaryService(svcUUID);
        const chars   = await service.getCharacteristics();
        // Find a writable characteristic
        characteristic = chars.find(c =>
          c.properties.write || c.properties.writeWithoutResponse
        );
        if (characteristic) break;
      } catch(e) { /* try next */ }
    }

    if (!characteristic) {
      showNotification('Printer found but no writable channel. Check printer compatibility.', 'error');
      return;
    }

    // Build ESC/POS byte commands from receipt data
    const commands = _buildESCPOS(receiptBody);

    // Write in chunks (BLE MTU is typically 512 bytes max)
    const CHUNK = 512;
    for (let i = 0; i < commands.length; i += CHUNK) {
      const chunk = commands.slice(i, i + CHUNK);
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else {
        await characteristic.writeValue(chunk);
      }
      // Small delay between chunks to avoid buffer overflow
      if (i + CHUNK < commands.length) await new Promise(r => setTimeout(r, 50));
    }

    showNotification('Sent to Bluetooth printer ✓', 'success');

  } catch(err) {
    if (err.name === 'NotFoundError' || err.message?.includes('cancelled')) {
      showNotification('Printer pairing cancelled', 'info');
    } else {
      console.error('Bluetooth print error:', err);
      showNotification(`Bluetooth error: ${err.message || err}`, 'error');
    }
  } finally {
    if (device?.gatt?.connected) device.gatt.disconnect();
  }
}

/* ── ESC/POS command builder ── */
function _buildESCPOS(receiptBody) {
  const ESC = 0x1B, GS = 0x1D;
  const bytes = [];
  const push  = (...b) => bytes.push(...b);
  const enc   = new TextEncoder();
  const text  = str => enc.encode(String(str || ''));

  const line  = str => { push(...text(str)); push(0x0A); };            // print + LF
  const dashes= ()  => line('--------------------------------');
  const center= str => {                                                 // 32-char center
    const s = String(str || '').slice(0, 32);
    const pad = Math.max(0, Math.floor((32 - s.length) / 2));
    line(' '.repeat(pad) + s);
  };
  const bold  = on  => push(ESC, 0x45, on ? 1 : 0);                   // ESC E
  const big   = on  => push(GS,  0x21, on ? 0x11 : 0x00);             // GS ! (2x)
  const cut   = ()  => push(GS,  0x56, 0x42, 0x00);                   // GS V — full cut

  // Init
  push(ESC, 0x40);  // ESC @ — initialize printer

  const brand    = APP_STATE.settings?.brandName || 'Caflat.CORE';
  const footer   = APP_STATE.settings?.receiptFooter || '';

  // Extract receipt data from DOM
  const receiptLines = receiptBody.querySelectorAll('.receipt-line, .receipt-item');
  const brandEl      = receiptBody.querySelector('.receipt-brand');
  const items        = receiptBody.querySelector('.receipt-items');

  // Header
  bold(true); big(true);
  center(brandEl ? brandEl.textContent.trim() : brand);
  big(false); bold(false);
  dashes();

  // Receipt lines (date, receipt#, customer, payment, order type, reference)
  receiptLines.forEach(el => {
    if (el.classList.contains('receipt-total')) return; // printed separately
    if (el.classList.contains('receipt-item'))  return; // in items section
    const spans = el.querySelectorAll('span');
    if (spans.length >= 2) {
      const label = spans[0].textContent.trim().padEnd(16);
      const value = spans[1].textContent.trim();
      line(`${label}${value}`.slice(0, 48));
    }
  });

  dashes();

  // Items
  if (items) {
    items.querySelectorAll('.receipt-item').forEach(el => {
      const spans = el.querySelectorAll('span');
      if (spans.length >= 2) {
        const name  = spans[0].textContent.trim().slice(0, 24).padEnd(24);
        const price = spans[1].textContent.trim();
        line(`${name}${price}`);
      }
    });
  }

  dashes();

  // Totals
  receiptLines.forEach(el => {
    const spans = el.querySelectorAll('span');
    if (spans.length < 2) return;
    const label = spans[0].textContent.trim();
    const value = spans[1].textContent.trim();
    if (el.classList.contains('receipt-total')) {
      bold(true); big(true);
      line(`${'TOTAL'.padEnd(16)}${value}`);
      big(false); bold(false);
    } else if (['Subtotal','Discount','Tax','Tendered','Change'].includes(label)) {
      line(`${label.padEnd(16)}${value}`);
    }
  });

  dashes();

  // Footer
  if (footer) {
    center(footer);
    push(0x0A);
  }

  // Feed and cut
  push(0x0A, 0x0A, 0x0A, 0x0A); // feed 4 lines
  cut();

  return new Uint8Array(bytes);
}

/* ── Print options modal ── */
function _openPrintOptionsModal(receiptBody) {
  // Remove existing if present
  const existing = document.getElementById('_printOptionsModal');
  if (existing) existing.remove();

  const hasBluetooth = !!navigator.bluetooth;

  const overlay = document.createElement('div');
  overlay.id = '_printOptionsModal';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;
    backdrop-filter:blur(2px);`;

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px 24px;
      max-width:340px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2);">
      <div style="font-weight:800;font-size:16px;margin-bottom:6px;">Print Receipt</div>
      <div style="font-size:13px;color:#888;margin-bottom:20px;">
        Choose how to print this receipt.
      </div>

      <button id="_printStandardBtn"
        style="width:100%;padding:14px 16px;border:1.5px solid #e8e8e8;border-radius:12px;
          background:#fff;text-align:left;cursor:pointer;margin-bottom:10px;
          font-family:inherit;display:flex;align-items:center;gap:12px;">
        <span style="font-size:22px;">🖨️</span>
        <div>
          <div style="font-weight:700;font-size:14px;">Standard Print</div>
          <div style="font-size:11px;color:#888;">USB / wired / WiFi printer — opens print dialog</div>
        </div>
      </button>

      <button id="_printBluetoothBtn"
        style="width:100%;padding:14px 16px;border:1.5px solid #e8e8e8;border-radius:12px;
          background:#fff;text-align:left;cursor:pointer;margin-bottom:20px;
          font-family:inherit;display:flex;align-items:center;gap:12px;
          ${!hasBluetooth ? 'opacity:0.4;cursor:not-allowed;' : ''}">
        <span style="font-size:22px;">📡</span>
        <div>
          <div style="font-weight:700;font-size:14px;">Bluetooth Thermal Printer</div>
          <div style="font-size:11px;color:#888;">
            ${hasBluetooth
              ? 'ESC/POS thermal — pairs and prints wirelessly'
              : 'Not available — use Chrome or Edge on desktop/Android'}
          </div>
        </div>
      </button>

      <button id="_printCancelBtn"
        style="width:100%;padding:11px;border:1.5px solid #e8e8e8;border-radius:10px;
          background:#fff;cursor:pointer;font-family:inherit;font-size:13px;color:#666;">
        Cancel
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  document.getElementById('_printStandardBtn').onclick = () => {
    close();
    _printStandard(receiptBody);
  };

  document.getElementById('_printBluetoothBtn').onclick = () => {
    if (!hasBluetooth) return;
    close();
    _printBluetooth(receiptBody);
  };

  document.getElementById('_printCancelBtn').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

/* ── Exports ── */
function initializeSalesCompatibility() {
  window.completeSale = completeSale;
  window.togglePaymentFields = togglePaymentFields;
  window.clearCart = clearCart;
  window.holdOrder = holdOrder;
  window.openCheckoutModal = openCheckoutModal;
  window.renderSalesTable = renderSalesTable;
  window.renderCart = renderCart;
  window.exportSalesReport = exportSalesReport;
  window.calculateChange = calculateChange;
  window.calculateCartTotal = calculateCartTotal;
  window.calculateCartSubtotal = calculateCartSubtotal;
  window.calculateCartDiscount = calculateCartDiscount;
  window.calculateCartTax = calculateCartTax;
  window.updateCartSummary = updateCartSummary;
  window.removeFromCart = removeFromCart;
  window.increaseQty = increaseQty;
  window.decreaseQty = decreaseQty;
  window.openSaleReceipt = openSaleReceipt;
}

window.initializeSales = initializeSales;
window.getCart = getCart;
window.setCart = setCart;
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.increaseQty = increaseQty;
window.decreaseQty = decreaseQty;
window.renderCart = renderCart;
window.completeSale = completeSale;
window.holdOrder = holdOrder;
window.openCheckoutModal = openCheckoutModal;
window.renderSalesTable = renderSalesTable;
window.exportSalesReport = exportSalesReport;
window.togglePaymentFields = togglePaymentFields;
window.calculateChange = calculateChange;
window.calculateCartTotal = calculateCartTotal;
window.calculateCartSubtotal = calculateCartSubtotal;
window.calculateCartDiscount = calculateCartDiscount;
window.calculateCartTax = calculateCartTax;
window.updateCartSummary = updateCartSummary;
window.renderHeldOrdersBadge = renderHeldOrdersBadge;
window.openSaleReceipt = openSaleReceipt;
window.completePendingSale = completePendingSale;
window.cancelPendingSale = cancelPendingSale;
window.getSales = getSales;
window.openHeldOrdersModal = openHeldOrdersModal;
window.closeHeldOrdersModal = closeHeldOrdersModal;
window.resumeHeldOrder = resumeHeldOrder;
window.setQuickAmount = setQuickAmount;
window.escapeHtml = escapeHtml;
window.printReceipt = printReceipt;
window.applyTimePill = applyTimePill;

/* ═══════════════════════════════════════════════════════
   SPLIT PAYMENT
═══════════════════════════════════════════════════════ */
let _splitActive = false;

function _resetSplitPayment() {
  _splitActive = false;
  const track  = document.getElementById('splitToggleTrack');
  const thumb  = document.getElementById('splitToggleThumb');
  const section = document.getElementById('splitPaymentSection');
  if (track)   { track.style.background = 'var(--gray-200)'; }
  if (thumb)   { thumb.style.transform = 'translateX(0)'; }
  if (section) { section.style.display = 'none'; }
  const amtEl  = document.getElementById('splitPaymentAmount');
  const refEl  = document.getElementById('splitPaymentReference');
  if (amtEl)   amtEl.value = '';
  if (refEl)   refEl.value = '';
}

function toggleSplitPayment() {
  _splitActive = !_splitActive;
  const track   = document.getElementById('splitToggleTrack');
  const thumb   = document.getElementById('splitToggleThumb');
  const section = document.getElementById('splitPaymentSection');

  if (_splitActive) {
    if (track)   { track.style.background = 'var(--black)'; }
    if (thumb)   { thumb.style.transform = 'translateX(16px)'; }
    if (section) { section.style.display = 'block'; }
    // Populate split method dropdown with same options as main
    const mainSel  = document.getElementById('checkoutPayment');
    const splitSel = document.getElementById('splitPaymentMethod');
    if (mainSel && splitSel) {
      splitSel.innerHTML = mainSel.innerHTML;
      // Default split to GCash if available, else first non-cash
      const nonCash = Array.from(splitSel.options).find(o => o.value !== 'cash');
      if (nonCash) splitSel.value = nonCash.value;
    }
    renderSplitPaymentFields();
    updateSplitAmounts();
  } else {
    _resetSplitPayment();
  }
}

function renderSplitPaymentFields() {
  const method   = document.getElementById('splitPaymentMethod')?.value || '';
  const refWrap  = document.getElementById('splitReferenceWrap');
  const isCashLike = method === 'cash' || method === '';
  if (refWrap) refWrap.style.display = isCashLike ? 'none' : 'block';
}

function updateSplitAmounts() {
  if (!_splitActive) return;
  const total   = calculateCartTotal();
  const splitEl = document.getElementById('splitPaymentAmount');
  const firstEl = document.getElementById('splitFirstAmount');
  const splitAmt = parseMoney(splitEl?.value || '0');
  const firstAmt = Math.max(0, total - splitAmt);
  if (firstEl) firstEl.textContent = formatCurrency(firstAmt);
}

function isSplitActive() { return _splitActive; }

function getSplitPaymentData() {
  if (!_splitActive) return null;
  const method    = document.getElementById('splitPaymentMethod')?.value || 'cash';
  const amount    = parseMoney(document.getElementById('splitPaymentAmount')?.value || '0');
  const reference = document.getElementById('splitPaymentReference')?.value?.trim() || '';
  return { method, amount, reference };
}

window.toggleSplitPayment      = toggleSplitPayment;
window.renderSplitPaymentFields = renderSplitPaymentFields;
window.updateSplitAmounts      = updateSplitAmounts;
window.isSplitActive           = isSplitActive;
window.getSplitPaymentData     = getSplitPaymentData;
