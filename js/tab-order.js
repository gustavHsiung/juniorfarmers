// =============================================
// tab-order.js — 餐廳下單 + 訂單瀏覽
// 依賴：shared.js（WEBHOOK_URL, formatDate,
//                  getNearestMonday, esc）
// =============================================

const ORDER_DATA_TARGET = '料理人下單';

// ── Sub-tab 切換 ──────────────────────────────
let currentOrderSub    = 'entry';
let orderWeekChipsLoaded = false;

let farmPriceCache = null;      // null = 尚未載入
let farmPriceCacheWeek = '';    // 記錄是哪個週次的快取

function switchOrderSubTab(sub) {
  currentOrderSub = sub;
  document.getElementById('orderSubPanelEntry').style.display  = sub === 'entry'  ? '' : 'none';
  document.getElementById('orderSubPanelBrowse').style.display = sub === 'browse' ? '' : 'none';
  document.getElementById('orderSubTabEntry').classList.toggle('active', sub === 'entry');
  document.getElementById('orderSubTabBrowse').classList.toggle('active', sub === 'browse');

  if (sub === 'browse') {
    if (!document.getElementById('orderBrowseWeekDate').value)
      document.getElementById('orderBrowseWeekDate').value = getNearestMonday();
    if (!orderWeekChipsLoaded) { loadOrderWeekChips(); orderWeekChipsLoaded = true; }
  }
}

// ════════════════════════════════════════════
// 下單解析與編輯
// ════════════════════════════════════════════
let orderRows = [];
let orderNid  = 1;

async function autoFillPricesFromFarm() {
  if (!WEBHOOK_URL) return;
  try {
    const weekDate = document.getElementById('orderWeekDate').value;
    const weekStr  = weekDate ? formatDate(weekDate) : '';

    // 同週次有快取就直接用，不重新 fetch
    if (farmPriceCache && farmPriceCacheWeek === weekStr) {
      _applyFarmPrices(farmPriceCache);
      return;
    }

    let url = WEBHOOK_URL + '?action=query';
    if (weekStr) url += '&weeks=' + encodeURIComponent(weekStr);
    const res  = await fetch(url);
    const data = await res.json();

    const priceMap = {};
    (data.data || []).forEach(r => {
      if (r['品名'] && r['農二出貨價'])
        priceMap[r['品名'].trim()] = { price: r['農二出貨價'], unit: r['單位'] || '' };
    });

    farmPriceCache     = priceMap;
    farmPriceCacheWeek = weekStr;
    _applyFarmPrices(priceMap);
  } catch(e) {
    console.warn('autoFillPricesFromFarm 失敗', e);
  }
}

function _findFarmPrice(priceMap, name) {
  // 回傳純價格字串（向後相容）
  const entry = _findFarmPriceEntry(priceMap, name);
  if (!entry) return null;
  return typeof entry === 'object' ? entry.price : entry;
}

function _applyFarmPrices(priceMap) {
  orderRows.forEach(row => {
    if (row.totalAmount !== undefined) {
      // 格式四：用農場單價反算數量
      const farmEntry = _findFarmPriceEntry(priceMap, row.name);
      if (farmEntry) {
        const unitPrice = parseFloat(farmEntry.price);
        if (unitPrice > 0) {
          row.qty   = Math.round((row.totalAmount / unitPrice) * 100) / 100;
          row.unit  = farmEntry.unit || row.unit;
          row.price = farmEntry.price;
        }
      }
      delete row.totalAmount;
    } else if (!row.price) {
      const price = _findFarmPrice(priceMap, row.name);
      if (price) row.price = price;
    }
  });
}

// 回傳 { price, unit } 物件，供格式四反算數量使用
function _findFarmPriceEntry(priceMap, name) {
  const n = name.trim();
  // priceMap 的值可能是純字串（向後相容）或 { price, unit } 物件
  const wrap = v => (typeof v === 'object' && v !== null) ? v : { price: v, unit: '' };

  if (priceMap[n]) return wrap(priceMap[n]);

  const keys = Object.keys(priceMap);
  const matched = keys
    .filter(k => k.includes(n) || n.includes(k))
    .sort((a, b) => b.length - a.length);

  return matched.length ? wrap(priceMap[matched[0]]) : null;
}

function parseOrderText(rawText) {
  let orderNid = 1; 

  // 使用外部定義的 UNITS，並擴充英文縮寫（不影響外部檔案）
  const parseUnits = [...UNITS, 'kg', 'g', 'ml', 'L'];
  const unitRe = parseUnits.join('|');
  const numRe = '\\d+(?:\\.\\d+)?|[一二三四五六七八九十半]';

  // 格式一：品名＋數量＋單位 (如：筍子1支)
  const itemRe = new RegExp(`^(.+?)(${numRe})(${unitRe})\\s*$`);

  // 格式二：品名＋單價元/單位＊數量（單位）（備註） (如：烏殼筍80元/台斤*4支)
  const priceUnitQtyRe = new RegExp(
    `^(.+?)(\\d+(?:\\.\\d+)?)元[/／](${unitRe})\\s*[\\*×x＊]\\s*(${numRe})(${unitRe})?\\s*(?:（([^）]*)）|\\(([^)]*)\\))?\\s*$`
  );

  // 格式二B：品名＋單價元/單位（備註） (如：甜玉米150元/包(大約4〜6支))
  const priceUnitNoteRe = new RegExp(
    `^(.+?)(\\d+(?:\\.\\d+)?)元[/／](${unitRe})\\s*(?:（([^）]*)）|\\(([^)]*)\\))?\\s*$`
  );

  // 格式三：品名＋單價元/規格＊份數 (如：紫蘇葉子85元/100g*1)
  const priceSpecQtyRe = new RegExp(
    `^(.+?)(\\d+(?:\\.\\d+)?)元[/／]([^\\*×x＊（\\(]+)\\s*[\\*×x＊]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:（([^）]*)）|\\(([^)]*)\\))?\\s*$`
  );

  // 【大優化】格式四：品名＋總金額元（允許元後面加上任意敘述與括號備註）
  // 範例：小黃瓜 20元左右（2-3條） -> 抓出 20元、左右（2-3條）
  const totalAmountRe = new RegExp(
    `^(.+?)(\\d+(?:\\.\\d+)?)元(?:左右|上下)?\\s*(?:（([^）]*)）|\\(([^)]*)\\))?\\s*$`
  );

  const result = [];
  let currentShop = '';

  rawText.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;

    // 移除前導的 + 或 ＋
    const cleanLine = line.replace(/^[+＋]+\s*/, '');

    // ── 1. 店家名稱判斷 ──
    // 如果這行沒有任何金額「元」、沒有包含任何計量單位，且字數較短，就判定為店名
    const hasPriceOrUnit = new RegExp(`元|${unitRe}`).test(cleanLine);
    if (!hasPriceOrUnit && cleanLine.length <= 8 && !/下單|訂單/.test(cleanLine)) {
      currentShop = cleanLine.replace(/[,，、。：:]+$/, '').trim();
      return; 
    }

    // ── 2. 格式二：品名＋單價元/單位＊數量 ──
    const m2 = cleanLine.match(priceUnitQtyRe);
    if (m2) {
      const name  = m2[1].replace(/[+＋/／\*×x＊]+/g, '').trim();
      const price = m2[2];
      const unit  = m2[5] || m2[3]; 
      let   qty   = m2[4];
      qty = (CN_NUM[qty] !== undefined) ? CN_NUM[qty] : parseFloat(qty);
      const note  = (m2[6] || m2[7] || '').trim();
      if (name) result.push({ id: orderNid++, shop: currentShop, name, qty, unit, price, note });
      return;
    }

    // ── 3. 格式二B：品名＋單價元/單位（後接括號備註）──
    const m2b = cleanLine.match(priceUnitNoteRe);
    if (m2b) {
      const name  = m2b[1].replace(/[+＋/／]+/g, '').trim();
      const price = m2b[2];
      const unit  = m2b[3];
      const note  = (m2b[4] || m2b[5] || '').trim();
      if (name) result.push({ id: orderNid++, shop: currentShop, name, qty: 1, unit, price, note });
      return;
    }

    // ── 4. 格式三：品名＋單價元/規格＊份數 ──
    const m3 = cleanLine.match(priceSpecQtyRe);
    if (m3) {
      const name  = m3[1].replace(/[+＋/／\*×x＊]+/g, '').trim();
      const price = m3[2];
      const spec  = m3[3].trim(); 
      const qty   = parseFloat(m3[4]);
      const note  = (m3[5] || m3[6] || '').trim();
      if (name) result.push({ id: orderNid++, shop: currentShop, name, qty, unit: spec, price, note });
      return;
    }

    // ── 5. 格式一：品名＋數量＋單位 (包含 筍子1支 / 龍鬚菜 半斤) ──
    const m1 = cleanLine.match(itemRe);
    if (m1) {
      let qty = m1[2];
      qty = (CN_NUM[qty] !== undefined) ? CN_NUM[qty] : parseFloat(qty);
      const name = m1[1].replace(/[+＋/／]+/g, '').trim();
      if (name) result.push({ id: orderNid++, shop: currentShop, name, qty, unit: m1[3], price: '', note: '' });
      return;
    }

    // ── 6. 格式四：品名＋總金額元 (包含 小黃瓜 20元左右) ──
    const m4 = cleanLine.match(totalAmountRe);
    if (m4) {
      const name        = m4[1].replace(/[+＋/／]+/g, '').trim();
      const totalAmount = parseFloat(m4[2]);
      const note        = (m4[3] || m4[4] || '').trim();
      if (name) result.push({ id: orderNid++, shop: currentShop, name, qty: '', unit: '', price: '', totalAmount, note });
      return;
    }

    // ── 7. 安全防禦：如果上面全漏接，保留原始文字，不污染店名 ──
    if (cleanLine.length > 0) {
      result.push({ id: orderNid++, shop: currentShop, name: cleanLine, qty: '', unit: '', price: '', note: '格式未完全匹配' });
    }
  });

  // 單位標準化
  const unitNorm = { 'kg': '公斤', 'g': '公克', '斤': '台斤' };
  result.forEach(r => { if (unitNorm[r.unit]) r.unit = unitNorm[r.unit]; });

  return result;
}


async function parseAndPreview() {
  const raw = document.getElementById('orderRawText').value.trim();
  if (!raw) { alert('請先貼入下單訊息'); return; }
  
  orderNid  = 1;
  
  orderRows = parseOrderText(raw);
  await autoFillPricesFromFarm();  

  if (!orderRows.length) {
    alert('解析不到任何品項，請確認格式（品名＋數量＋單位，例如：龍葵2斤）');
    return;
  }
  
  renderOrderPreview();
  
  document.getElementById('orderPreviewCard').style.display  = 'block';
  document.getElementById('orderDetailsCard').style.display  = 'block';
  document.getElementById('orderSubmitBtn').style.display    = 'flex';
  document.getElementById('orderPreviewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderOrderPreview() {
  const tbody = document.getElementById('orderPreviewBody');
  tbody.innerHTML = '';
  let total = 0;

  orderRows.forEach((row, idx) => {
    // 店家標題列
    const prevShop = idx > 0 ? orderRows[idx - 1].shop : null;
    if (row.shop !== prevShop) {
      const shopTr = document.createElement('tr');
      shopTr.innerHTML = `<td colspan="7" class="shop-row-header">🏪 ${esc(row.shop || '（未指定店家）')}</td>`;
      tbody.appendChild(shopTr);
    }

    const rowSubtotal = (row.qty && row.price)
      ? (parseFloat(row.qty) * parseFloat(row.price)).toFixed(0) : '';
    if (rowSubtotal) total += parseFloat(rowSubtotal);

    const unitOpts = UNITS.map(u => `<option${u === row.unit ? ' selected' : ''}>${u}</option>`).join('');
    const tr = document.createElement('tr');
    tr.id = 'order-row-' + row.id;
    tr.innerHTML = `
      <td><input type="text" value="${esc(row.shop)}" placeholder="店家"
        style="font-size:12px" oninput="updateOrderRow(${row.id},'shop',this.value)" /></td>
      <td>
        <input type="text" value="${esc(row.name)}" placeholder="品名"
          oninput="updateOrderRow(${row.id},'name',this.value)" />
        ${row.note ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px;font-style:italic">${esc(row.note)}</div>` : ''}
      </td>
      <td><input type="number" min="0" step="0.1" value="${esc(row.qty)}" style="width:72px"
        oninput="updateOrderRow(${row.id},'qty',this.value)" /></td>
      <td><select style="width:72px" onchange="updateOrderRow(${row.id},'unit',this.value)">${unitOpts}</select></td>
      <td><input type="number" min="0" value="${esc(row.price)}" placeholder="—" style="width:80px"
        oninput="updateOrderRow(${row.id},'price',this.value);updateSubtotal(${row.id})" /></td>
      <td id="subtotal-${row.id}">
        ${rowSubtotal ? `<span class="order-total-pill">$${rowSubtotal}</span>` : '<span style="color:var(--gray-400)">—</span>'}
      </td>
      <td><button class="order-remove-btn" onclick="removeOrderRow(${row.id})">×</button></td>`;
    tbody.appendChild(tr);
  });

  // 摘要欄
  const shops = [...new Set(orderRows.map(r => r.shop))];
  document.getElementById('orderSummaryBar').innerHTML =
    `共 <strong>${orderRows.length}</strong> 項，
     來自 <strong>${shops.length}</strong> 個店家：${shops.map(s => esc(s || '未指定')).join('、')}
     ${total > 0 ? `&nbsp;｜&nbsp; 合計 <strong>$${total}</strong>` : ''}`;
}

function updateOrderRow(id, field, val) {
  const row = orderRows.find(r => r.id === id);
  if (row) row[field] = val;
  if (field === 'shop') renderOrderPreview();
}

function updateSubtotal(id) {
  const row = orderRows.find(r => r.id === id);
  if (!row) return;
  const cell = document.getElementById('subtotal-' + id);
  if (!cell) return;
  const sub = (row.qty && row.price)
    ? (parseFloat(row.qty) * parseFloat(row.price)).toFixed(0) : '';
  cell.innerHTML = sub
    ? `<span class="order-total-pill">$${sub}</span>`
    : '<span style="color:var(--gray-400)">—</span>';
  // 更新摘要列總計
  let total = 0;
  orderRows.forEach(r => { if (r.qty && r.price) total += parseFloat(r.qty) * parseFloat(r.price); });
  const bar = document.getElementById('orderSummaryBar');
  if (bar) {
    const shops = [...new Set(orderRows.map(r => r.shop))];
    bar.innerHTML = `共 <strong>${orderRows.length}</strong> 項，
      來自 <strong>${shops.length}</strong> 個店家：${shops.map(s => esc(s || '未指定')).join('、')}
      ${total > 0 ? `&nbsp;｜&nbsp; 合計 <strong>$${Math.round(total)}</strong>` : ''}`;
  }
}

function removeOrderRow(id) {
  orderRows = orderRows.filter(r => r.id !== id);
  renderOrderPreview();
}

function addOrderRow() {
  orderRows.push({ id: orderNid++, shop: '', name: '', qty: '', unit: '斤', price: '' });
  renderOrderPreview();
}

async function submitOrder() {
  if (!WEBHOOK_URL) { showOrderErr('請先在設定中填入 Webhook 網址。'); return; }
  const validRows = orderRows.filter(r => r.name);
  if (!validRows.length) { showOrderErr('請至少填寫一項品名。'); return; }

  const registrant  = document.getElementById('orderRegistrant').value.trim();
  const weekDate    = document.getElementById('orderWeekDate').value;
  const deliveryLoc = document.getElementById('orderDeliveryLocation').value.trim();
  const deliveryTime= document.getElementById('orderDeliveryTime').value.trim();
  const payStatus   = document.getElementById('orderPaymentStatus').value;
  const batchNote   = document.getElementById('orderBatchNote').value.trim();
  const weekStr     = weekDate ? formatDate(weekDate) : '';

  const btn = document.getElementById('orderSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 送出中…';
  hideOrderErr();

  const rows = validRows.map(r => {
    const subtotal = (r.qty && r.price) ? (parseFloat(r.qty) * parseFloat(r.price)).toFixed(0) : '';
    return {
      '登記人': registrant, '店家/料理人': r.shop, '週次': weekStr,
      '品名': r.name, '數量': r.qty, '單位': r.unit,
      '單價（元）': r.price, '小記': subtotal,
      '送貨地點': deliveryLoc, '送貨時間': deliveryTime,
      '付款狀態': payStatus, '備註': batchNote,
    };
  });

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'order', rows }),
    });
    document.getElementById('orderFormSection').style.display = 'none';
    const box = document.getElementById('orderSuccessBox');
    box.style.display = 'block';
    const shops = [...new Set(validRows.map(r => r.shop).filter(Boolean))];
    document.getElementById('orderSuccessDetail').textContent =
      `共 ${validRows.length} 項，店家：${shops.join('、') || '未指定'}`;
  } catch(e) {
    showOrderErr('連線失敗，請確認網路或 Webhook 設定。');
    btn.disabled = false;
    btn.innerHTML = _orderSubmitIcon() + ' 送出訂單';
  }
}

function resetOrderForm() {
  document.getElementById('orderFormSection').style.display = 'block';
  document.getElementById('orderSuccessBox').style.display  = 'none';
  document.getElementById('orderRawText').value             = '';
  document.getElementById('orderPreviewCard').style.display = 'none';
  document.getElementById('orderDetailsCard').style.display = 'none';
  document.getElementById('orderSubmitBtn').style.display   = 'none';
  orderRows = []; orderNid = 1;
  const btn = document.getElementById('orderSubmitBtn');
  btn.disabled = false;
  btn.innerHTML = _orderSubmitIcon() + ' 送出訂單';
}

function showOrderErr(msg) {
  const e = document.getElementById('orderErrorMsg');
  e.style.display = 'block'; e.textContent = msg;
  e.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideOrderErr() { document.getElementById('orderErrorMsg').style.display = 'none'; }

function _orderSubmitIcon() {
  return '<svg width="18" height="18" viewBox="0 0 18 18" fill="none">' +
    '<path d="M9 1L17 9L9 17" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M1 9h16" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

// ════════════════════════════════════════════
// 訂單瀏覽
// ════════════════════════════════════════════
let selectedOrderWeeks = new Set();

async function loadOrderWeekChips() {
  if (!WEBHOOK_URL) return;
  const chips      = document.getElementById('orderWeekChips');
  const refreshBtn = document.getElementById('orderRefreshBtn');
  chips.innerHTML = '<span style="font-size:12px;color:var(--gray-400);">載入中…</span>';
  refreshBtn.style.display = 'none';
  try {
    const res  = await fetch(WEBHOOK_URL + '?action=orderWeeks');
    const data = await res.json();
    renderOrderWeekChips(data.weeks || []);
  } catch(e) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--red-400);">載入失敗</span>';
  }
  refreshBtn.style.display = 'block';
}

function renderOrderWeekChips(weeks) {
  const container = document.getElementById('orderWeekChips');
  if (!weeks.length) {
    container.innerHTML = '<span style="color:var(--gray-400);font-size:13px;">目前尚無訂單資料</span>';
    return;
  }
  container.innerHTML = '';
  weeks.forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'week-chip';
    btn.textContent = w;
    btn.onclick = () => {
      if (selectedOrderWeeks.has(w)) { selectedOrderWeeks.delete(w); btn.classList.remove('active'); }
      else                            { selectedOrderWeeks.add(w);    btn.classList.add('active'); }
      _updateOrderChipsHint();
    };
    container.appendChild(btn);
  });
  document.getElementById('orderChipsHint').textContent = '可選擇多個週次';
}

function _updateOrderChipsHint() {
  const n = selectedOrderWeeks.size;
  document.getElementById('orderChipsHint').textContent =
    n === 0 ? '可選擇多個週次' : `已選 ${n} 個週次`;
}

async function refreshOrderWeekChips() {
  orderWeekChipsLoaded = false;
  await loadOrderWeekChips();
  orderWeekChipsLoaded = true;
}

// ── Order browse query ───────────────────────────────────────
function setOrderBrowseMsg(msg) {
  document.getElementById('orderSearchResults').innerHTML =
    `<div class="browse-empty"><span class="empty-icon">🌶️</span>${msg}</div>`;
}

async function fetchOrderBrowseData() {
  const val = document.getElementById('orderBrowseWeekDate').value;
  if (val) {
    const ws = formatDate(val);
    document.querySelectorAll('#orderWeekChips .week-chip').forEach(c =>
      c.classList.toggle('active', c.textContent.trim() === ws)
    );
  }
  if (!WEBHOOK_URL) { setOrderBrowseMsg('請先在設定中填入 Webhook 網址。'); return; }
  const spinner = document.getElementById('orderBrowseSpinner');
  const results = document.getElementById('orderSearchResults');
  spinner.style.display = 'block'; results.innerHTML = '';

  try {
    const weeksParam = Array.from(selectedOrderWeeks).join(',');
    const shopFilter = document.getElementById('orderShopFilter').value.trim();
    let url = WEBHOOK_URL + '?action=orderQuery';
    if (weeksParam) url += '&weeks=' + encodeURIComponent(weeksParam);
    if (shopFilter) url += '&shop=' + encodeURIComponent(shopFilter);
    const res = await fetch(url);
    const data = await res.json();
    spinner.style.display = 'none';
    renderOrderBrowseResults(data.data || []);
  } catch(e) {
    console.error('fetchOrderBrowseData',e);
    spinner.style.display = 'none';
    results.innerHTML = '<div class="browse-empty"><span class="empty-icon">⚠️</span>查詢失敗，請確認網路或 Webhook 設定</div>';
  }
}

let orderEditStore = {};

function countShopTotal(shopRows) {
  let shopTotal = 0;
   shopRows.forEach(r => { 
    const t = parseFloat(r['小記']); 

    if (!isNaN(t)) shopTotal += t; 
  });
   return shopTotal;
}

function renderShopTotal(shopMeta) {
  return `${shopMeta.orderCount} 項${shopMeta.total > 0 ? ` · 共 $${Math.round(shopMeta.total)}` : ''}`;
}

function renderOrderBrowseResults(rows) {
  orderEditStore = {};
  const container = document.getElementById('orderSearchResults');
  if (!rows.length) {
    container.innerHTML = '<div class="browse-empty"><span class="empty-icon">🧾</span>查無符合條件的訂單資料</div>';
    return;
  }

  // Group by shop
  const shopList = [];
  const shopMap = {};
  let grandTotal = 0;

  rows.forEach(r => {
    const shop = esc(r['店家/料理人'] || '（未填店家）');
    if (!shopMap[shop]) { 
      shopMap[shop] = { orders:[], meta:{ orderCount: 0, total: 0 }}; 
      shopList.push(shop); 
    }
    
    const t = parseFloat(r['小記']); 
    if (!isNaN(t)) {
      grandTotal += t;
      shopMap[shop].meta.total+= t;
    }
    
    shopMap[shop].orders.push(r);
    shopMap[shop].meta.orderCount++;
    
  });

  let html = `<div class="order-browse-summary">
    共 ${rows.length} 筆 · ${shopList.length} 個店家
    <span id="order-grand-total-display">${grandTotal > 0 ? ` · 合計 <strong style="color:var(--red-600)">$${Math.round(grandTotal)}</strong>` : ''}</span>
  </div>`;

  const sidCounters = {};

  shopList.forEach(shop => {
    const shopRows = shopMap[shop].orders;
    const firstRow = shopRows[0];
    const week = firstRow['週次'] || '';
    const deliveryLoc = firstRow['送貨地點'] || '';
    const deliveryTime = firstRow['送貨時間'] || '';
  
    html += `<div class="order-group">
      <div class="order-group-header">
        <span class="shop-name">🏪 ${shop}</span>
        <span class="shop-meta">
          ${week ? `${esc(week)}<br>` : ''}
        </span>
        <span id="${shop}-${week}-meta-deal" class="shop-meta shop-meta-deal">
          ${esc(renderShopTotal(shopMap[shop].meta))}
        </span>
      </div>`;

    if (deliveryLoc || deliveryTime) {
      html += `<div class="order-group-delivery">`;
      if (deliveryLoc) html += `<span>📍 ${esc(deliveryLoc)}</span>`;
      if (deliveryTime) html += `<span>🕐 ${esc(deliveryTime)}</span>`;
      html += `</div>`;
    }

    html += `<table class="order-browse-table">
      <thead><tr>
        <th>品名</th><th>數量</th><th>單價</th><th>小計</th><th>付款</th><th>備註</th><th></th>
      </tr></thead><tbody>`;

    shopRows.forEach(r => {
      const sid = getBaseId(r['提交ID'] || '');
      if (sid) {
        if (!orderEditStore[sid]) orderEditStore[sid] = { rows: [] };
        if (sidCounters[sid] === undefined) sidCounters[sid] = 0;
        orderEditStore[sid].rows.push(r);
      }
      const rowIdx = sid ? sidCounters[sid]++ : -1;
      const rowId  = sid ? `orow-${sid}-${rowIdx}` : '';

      const qty   = r['數量'] ? `${esc(r['數量'])} ${esc(r['單位']||'')}` : '—';
      const price = r['單價（元）'] ? `$${esc(r['單價（元）'])}` : '—';
      const total = r['小記'] ? `<strong>$${esc(r['小記'])}</strong>` : '—';
      const note  = r['備註'] ? `<span style="color:var(--gray-400);font-size:11px;font-style:italic">${esc(r['備註'])}</span>` : '—';

      const payStatus = r['付款狀態'] || '';
      let payClass = 'none', payLabel = payStatus || '未設定';
      if (payStatus === '待付款')        { payClass = 'pending'; }
      else if (payStatus === '已付款')   { payClass = 'paid'; }
      else if (payStatus === '貨到付款') { payClass = 'cod'; }

      const editBtn = rowId ? `<button class="row-action-btn" onclick="editOrderRow('${esc(sid)}',${rowIdx})" aria-label="編輯">✎</button>` : '';

      html += `<tr${rowId ? ` id="${rowId}"` : ''}>
        <td>${esc(r['品名']||'')}</td>
        <td>${qty}</td>
        <td>${price}</td>
        <td>${total}</td>
        <td><span class="pay-pill ${payClass}">${esc(payLabel)}</span></td>
        <td>${note}</td>
        <td style="text-align:center;width:36px">${editBtn}</td>
      </tr>`;
    });

    html += `</tbody></table></div>`;
  });

  container.innerHTML = html;
}

// ── 列編輯 ────────────────────────────────────
function editOrderRow(sid, rowIdx) {
  const data = orderEditStore[sid];
  if (!data) return;
  const r     = data.rows[rowIdx];
  const rowId = `orow-${sid}-${rowIdx}`;
  const tr    = document.getElementById(rowId);
  if (!tr) return;

  const thead = tr.closest('table').querySelector('thead');
  if (thead) thead.style.display = 'none';

  const unitOpts = UNITS.map(u =>
    `<option${u === (r['單位'] || '斤') ? ' selected' : ''}>${u}</option>`).join('');
  const payOpts = ['待付款','已付款','貨到付款'].map(p =>
    `<option${p === (r['付款狀態'] || '') ? ' selected' : ''}>${p}</option>`).join('');

  tr.innerHTML = `
    <td colspan="6" style="padding:8px 6px">
      <div class="item-row" style="margin-bottom:8px">
        <div class="extra-field"><label>品名 *</label>
          <input type="text" id="ei-name-${rowId}" value="${esc(r['品名'] || '')}" placeholder="品名 *" /></div>
        <div class="extra-field"><label>數量</label>
          <div class="qty-wrap">
            <input type="number" id="ei-qty-${rowId}" min="0" step="0.1" value="${esc(r['數量'] || '')}" placeholder="數量" style="width:72px" />
            <select id="ei-unit-${rowId}" style="width:72px">${unitOpts}</select>
          </div></div>
      </div>
      <div class="item-extras-grid" style="margin-bottom:6px">
        <div class="extra-field"><label>單價（元）</label>
          <input type="number" id="ei-price-${rowId}" min="0" value="${esc(r['單價（元）'] || '')}" placeholder="單價" /></div>
        <div class="extra-field"><label>付款狀態</label>
          <select id="ei-pay-${rowId}">${payOpts}</select></div>
      </div>
      <div class="item-note-field"><label>備註</label>
        <textarea id="ei-note-${rowId}" style="min-height:32px">${esc(r['備註'] || '')}</textarea>
      </div>
    </td>
    <td style="vertical-align:top;padding-top:10px;width:36px">
      <div style="display:flex;flex-direction:column;gap:5px">
        <button class="save-edit-btn" id="ei-save-${rowId}"
          style="padding:6px 8px;font-size:13px;min-width:0"
          onclick="saveOrderRow('${esc(sid)}',${rowIdx})">✓</button>
        <button class="cancel-edit-btn"
          style="padding:6px 8px;font-size:13px;min-width:0"
          onclick="restoreOrderRow('${esc(sid)}',${rowIdx})">✕</button>
      </div>
    </td>`;
}

function restoreOrderRow(sid, rowIdx) {
  const data = orderEditStore[sid];
  if (!data) return;
  const r     = data.rows[rowIdx];
  const rowId = `orow-${sid}-${rowIdx}`;
  const tr    = document.getElementById(rowId);
  if (!tr) return;

  const thead = tr.closest('table').querySelector('thead');
  if (thead) thead.style.display = '';

  const shopName = r['店家/料理人'] || '（未填店家）';
  const week     = r['週次'] || '';
  const metaEl   = document.getElementById(`${esc(shopName)}-${week}-meta-deal`);
  let grandTotal = 0;
  Object.values(orderEditStore).forEach(d => {
    d.rows.forEach(row => {
      const t = parseFloat(row['小記']);
      if (!isNaN(t)) grandTotal += t;
    });
  });
  const grandEl = document.getElementById('order-grand-total-display');
  if (grandEl) grandEl.innerHTML = grandTotal > 0 ? ` · 合計 <strong style="color:var(--red-600)">$${Math.round(grandTotal)}</strong>` : '';

  if (metaEl) {
    let shopOrderTotal = 0, shopOrderCount = 0;
    Object.values(orderEditStore).forEach(d => {
      d.rows.forEach(row => {
        if ((row['店家/料理人'] || '（未填店家）') === shopName) {
          const t = parseFloat(row['小記']);
          if (!isNaN(t)) shopOrderTotal += t;
          shopOrderCount++;
        }
      });
    });
    metaEl.innerHTML = renderShopTotal({ orderCount: shopOrderCount, total: shopOrderTotal });
  }

  const qty   = r['數量'] ? `${esc(r['數量'])} ${esc(r['單位']||'')}` : '—';
  const price = r['單價（元）'] ? `$${esc(r['單價（元）'])}` : '—';
  const total = r['小記'] ? `<strong>$${esc(r['小記'])}</strong>` : '—';
  const note  = r['備註'] ? `<span style="color:var(--gray-400);font-size:11px;font-style:italic">${esc(r['備註'])}</span>` : '—';

  const payStatus = r['付款狀態'] || '';
  let payClass = 'none', payLabel = payStatus || '未設定';
  if (payStatus === '待付款')        { payClass = 'pending'; }
  else if (payStatus === '已付款')   { payClass = 'paid'; }
  else if (payStatus === '貨到付款') { payClass = 'cod'; }

  tr.innerHTML = `
    <td>${esc(r['品名']||'')}</td>
    <td>${qty}</td>
    <td>${price}</td>
    <td>${total}</td>
    <td><span class="pay-pill ${payClass}">${esc(payLabel)}</span></td>
    <td>${note}</td>
    <td style="text-align:center;width:36px">
      <button class="row-action-btn" onclick="editOrderRow('${esc(sid)}',${rowIdx})" aria-label="編輯">✎</button>
    </td>`;
}

async function saveOrderRow(sid, rowIdx) {
  if (!WEBHOOK_URL) return;
  const data = orderEditStore[sid];
  if (!data) return;

  const rowId = `orow-${sid}-${rowIdx}`;
  const name  = document.getElementById(`ei-name-${rowId}`).value.trim();
  const qty   = document.getElementById(`ei-qty-${rowId}`).value.trim();
  const unit  = document.getElementById(`ei-unit-${rowId}`).value;
  const price = document.getElementById(`ei-price-${rowId}`).value.trim();
  const pay   = document.getElementById(`ei-pay-${rowId}`).value;
  const note  = document.getElementById(`ei-note-${rowId}`).value.trim();

  if (!name) { alert('品名為必填'); return; }

  const saveBtn = document.getElementById(`ei-save-${rowId}`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }

  const originalRow = data.rows[rowIdx];

  const subtotal = (qty && price) ? String((parseFloat(qty) * parseFloat(price)).toFixed(0)) : '';
  const updatedRow = { ...originalRow,
    品名: name, 數量: qty, 單位: unit,
    '單價（元）': price, 小記: subtotal, 付款狀態: pay, 備註: note };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'updateRow',
        target: ORDER_DATA_TARGET,
        提交ID: originalRow['提交ID'],
        row: { 品名: name, 數量: qty, 單位: unit,
               '單價（元）': price, 小記: subtotal, 付款狀態: pay, 備註: note },
      }),
    });
    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message || '伺服器回傳錯誤');
    orderEditStore[sid].rows = data.rows.map((r, i) => i === rowIdx ? updatedRow : r);
    restoreOrderRow(sid, rowIdx);
  } catch(e) {
    alert(`儲存失敗：${e.message}`);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓'; }
  }
}