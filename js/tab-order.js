// =============================================
// tab-order.js — 餐廳下單 + 訂單瀏覽  v1.0.1
// 依賴：shared.js（WEBHOOK_URL, formatDate,
//                  getNearestMonday, esc）
// =============================================

const ORDER_UNITS = ['公斤','台斤','斤','公克','顆','支','束','盒','袋','打','份','把','包','條','片'];
const CN_NUM      = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'半':0.5 };

// ── Sub-tab 切換 ──────────────────────────────
let currentOrderSub    = 'entry';
let orderWeekChipsLoaded = false;

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

function parseOrderText(rawText) {
  const unitRe = ORDER_UNITS.join('|');
  const numRe = '\\d+(?:\\.\\d+)?|[一二三四五六七八九十半]';
  const itemRe = new RegExp(`^(.+?)[/／\\s+＋]*(${numRe})(${unitRe})\\s*$`);

  const result = [];
  let currentShop = '';

  rawText.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;

    // Remove leading + / ＋
    const cleanLine = line.replace(/^[+＋]+\s*/, '');

    // Try to match item pattern
    const match = cleanLine.match(itemRe);
    if (match) {
      let qty = match[2];
      qty = (CN_NUM[qty] !== undefined) ? CN_NUM[qty] : parseFloat(qty);
      const name = match[1].replace(/[+＋/／]+/g, '').trim();
      if (name) {
        result.push({ id: orderNid++, shop: currentShop, name, qty, unit: match[3], price: '' });
      }
    } else {
      // It's a shop name (skip obvious header lines)
      if (!/下單|訂單/.test(cleanLine)) {
        currentShop = cleanLine.replace(/[,，、。：:]+$/, '').trim();
      }
    }
  });
  return result;
}

function parseAndPreview() {
  const raw = document.getElementById('orderRawText').value.trim();
  if (!raw) { alert('請先貼入下單訊息'); return; }
  orderNid  = 1;
  orderRows = parseOrderText(raw);
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

    const unitOpts = ORDER_UNITS.map(u => `<option${u === row.unit ? ' selected' : ''}>${u}</option>`).join('');
    const tr = document.createElement('tr');
    tr.id = 'order-row-' + row.id;
    tr.innerHTML = `
      <td><input type="text" value="${esc(row.shop)}" placeholder="店家"
        style="font-size:12px" oninput="updateOrderRow(${row.id},'shop',this.value)" /></td>
      <td><input type="text" value="${esc(row.name)}" placeholder="品名"
        oninput="updateOrderRow(${row.id},'name',this.value)" /></td>
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
      '單價（元）': r.price, '交易總價': subtotal,
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
async function fetchOrderBrowseData() {
  const val = document.getElementById('orderBrowseWeekDate').value;
  if (val) {
    const ws = formatDate(val);
    document.querySelectorAll('#orderWeekChips .week-chip').forEach(c =>
      c.classList.toggle('active', c.textContent.trim() === ws)
    );
  }
  if (!WEBHOOK_URL) { setBrowseMsg('請先在設定中填入 Webhook 網址。'); return; }
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
    spinner.style.display = 'none';
    results.innerHTML = '<div class="browse-empty"><span class="empty-icon">⚠️</span>查詢失敗，請確認網路或 Webhook 設定</div>';
  }
}

function renderOrderBrowseResults(rows) {
  const container = document.getElementById('orderSearchResults');
  if (!rows.length) {
    container.innerHTML = '<div class="browse-empty"><span class="empty-icon">🧾</span>查無符合條件的訂單資料</div>';
    return;
  }

  // Group by shop
  const shopMap = {};
  const shopOrder = [];
  rows.forEach(r => {
    const shop = r['店家/料理人'] || '（未填店家）';
    if (!shopMap[shop]) { shopMap[shop] = []; shopOrder.push(shop); }
    shopMap[shop].push(r);
  });

  // Calculate total (if prices filled)
  let grandTotal = 0;
  rows.forEach(r => { const t = parseFloat(r['交易總價']); if (!isNaN(t)) grandTotal += t; });

  let html = `<div class="order-browse-summary">
    共 ${rows.length} 筆 · ${shopOrder.length} 個店家
    ${grandTotal > 0 ? ` · 合計 <strong style="color:var(--red-600)">$${Math.round(grandTotal)}</strong>` : ''}
  </div>`;

  shopOrder.forEach(shop => {
    const shopRows = shopRows2 = shopMap[shop];
    const firstRow = shopRows[0];
    const week = firstRow['週次'] || '';
    const registrant = firstRow['登記人'] || '';
    const deliveryLoc = firstRow['送貨地點'] || '';
    const deliveryTime = firstRow['送貨時間'] || '';

    // Shop total
    let shopTotal = 0;
    shopRows.forEach(r => { const t = parseFloat(r['交易總價']); if (!isNaN(t)) shopTotal += t; });

    html += `<div class="order-group">
      <div class="order-group-header">
        <span class="shop-name">🏪 ${esc(shop)}</span>
        <span class="shop-meta">
          ${week ? `${esc(week)}<br>` : ''}
          ${shopRows.length} 項${shopTotal > 0 ? ` · $${Math.round(shopTotal)}` : ''}
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

    shopRows.forEach((r, rowIdx) => {
      const sid = getBaseId(r['提交ID'] || '');
      const shop  = r['店家'];
      const qty  = r['數量'] ?   `${esc(r['數量'])} ${esc(r['單位']||'')}` : '—';
      const price = r['單價（元）'] ? `$${esc(r['單價（元）'])}` : '—';
      const total = r['交易總價'] ? `<strong>$${esc(r['交易總價'])}</strong>` : '—';
      const note  = r['備註'] ? `<span style="color:var(--gray-400);font-size:11px;font-style:italic">${esc(r['備註'])}</span>` : '—';

      const payStatus = r['付款狀態'] || '';
      let payClass = 'none', payLabel = payStatus || '未設定';
      if (payStatus === '待付款')  { payClass = 'pending'; }
      else if (payStatus === '已付款')  { payClass = 'paid'; }
      else if (payStatus === '貨到付款') { payClass = 'cod'; }

      const editBtn  = sid ? `<button class="row-edit-btn" onclick="editRow('${esc(sid)}',${rowIdx})" aria-label="編輯">✎</button>` : '';

      html += `<tr>
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