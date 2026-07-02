// =============================================
// tab-farm.js — 農場登記 + 農場瀏覽 / 編輯
// 依賴：shared.js（UNITS, WEBHOOK_URL, formatDate,
//                  getNearestMonday, esc）
// =============================================


const FARM_DATA_TARGET = '農場菜單';
// ── Sub-tab 切換 ──────────────────────────────
let currentFarmSub = 'register';
let weekChipsLoaded = false;

function switchFarmSubTab(sub) {
  currentFarmSub = sub;
  document.getElementById('farmSubPanelRegister').style.display = sub === 'register' ? '' : 'none';
  document.getElementById('farmSubPanelBrowse').style.display   = sub === 'browse'   ? '' : 'none';
  document.getElementById('farmSubTabRegister').classList.toggle('active', sub === 'register');
  document.getElementById('farmSubTabBrowse').classList.toggle('active', sub === 'browse');

  if (sub === 'browse') {
    if (!document.getElementById('browseWeekDate').value)
      document.getElementById('browseWeekDate').value = getNearestMonday();
    if (!weekChipsLoaded) { loadWeekChips(); weekChipsLoaded = true; }
  }
}

// ════════════════════════════════════════════
// 農場登記表單
// ════════════════════════════════════════════
let items = [];
let nid   = 1;

function addItem(n='', q='', u='公斤', p='', wp='', wt='', rp='', ap='', note='') {
  items.push({ id: nid++, name: n, qty: q, unit: u, price: p,
               wholesalePrice: wp, wholesaleThreshold: wt, retailPrice: rp,
               actualPrice: ap, itemNote: note });
  renderItems();
}

function removeItem(id) {
  items = items.filter(i => i.id !== id);
  renderItems();
}

function updateItem(id, f, v) {
  const item = items.find(x => x.id === id);
  if (item) item[f] = v;
  updateCount();
}

function renderItems() {
  const c = document.getElementById('itemsContainer');
  c.innerHTML = '';
  items.forEach(item => {
    const wrap = document.createElement('div');
    wrap.className = 'item-wrap';
    const unitOpts = UNITS.map(u => `<option${u === item.unit ? ' selected' : ''}>${u}</option>`).join('');
    wrap.innerHTML = `
      <div class="item-header">
        <span>品名 *</span><span>數量</span><span>基本進貨價 (元) *</span><span></span>
      </div>
      <div class="item-row">
        <input type="text" value="${esc(item.name)}" placeholder="品名"
          onchange="updateItem(${item.id},'name',this.value)"
          oninput="updateItem(${item.id},'name',this.value)"/>
        <div class="qty-wrap">
          <input type="number" min="0" value="${esc(item.qty)}" placeholder="數量"
            onchange="updateItem(${item.id},'qty',this.value)"
            oninput="updateItem(${item.id},'qty',this.value)"/>
          <select onchange="updateItem(${item.id},'unit',this.value)">${unitOpts}</select>
        </div>
        <input type="number" min="0" value="${esc(item.price)}" placeholder="進貨價"
          onchange="updateItem(${item.id},'price',this.value)"
          oninput="updateItem(${item.id},'price',this.value)"/>
        <button class="remove-btn" onclick="removeItem(${item.id})" aria-label="刪除">×</button>
      </div>
      <div class="item-extras">
        <div class="item-extras-grid">
          <div class="extra-field"><label>批價（元）</label>
            <input type="number" min="0" value="${esc(item.wholesalePrice)}" placeholder="批價"
              onchange="updateItem(${item.id},'wholesalePrice',this.value)"
              oninput="updateItem(${item.id},'wholesalePrice',this.value)"/></div>
          <div class="extra-field"><label>批價門檻（數量）</label>
            <input type="number" min="0" value="${esc(item.wholesaleThreshold)}" placeholder="批量起訂"
              onchange="updateItem(${item.id},'wholesaleThreshold',this.value)"
              oninput="updateItem(${item.id},'wholesaleThreshold',this.value)"/></div>
          <div class="extra-field"><label>末端建議售價（元）</label>
            <input type="number" min="0" value="${esc(item.retailPrice)}" placeholder="建議零售價"
              onchange="updateItem(${item.id},'retailPrice',this.value)"
              oninput="updateItem(${item.id},'retailPrice',this.value)"/></div>
          <div class="extra-field"><label>農二出貨價（元）</label>
            <input type="number" min="0" value="${esc(item.actualPrice)}" placeholder="農二出貨價"
              onchange="updateItem(${item.id},'actualPrice',this.value)"
              oninput="updateItem(${item.id},'actualPrice',this.value)"/></div>
        </div>
        <div class="item-note-field"><label>備注</label>
          <textarea placeholder="此品項備注…"
            onchange="updateItem(${item.id},'itemNote',this.value)"
            oninput="updateItem(${item.id},'itemNote',this.value)">${esc(item.itemNote)}</textarea>
        </div>
      </div>`;
    c.appendChild(wrap);
  });
  updateCount();
}

function updateCount() {
  const n = items.filter(i => i.name && i.qty && i.price).length;
  document.getElementById('itemCountLabel').textContent =
    items.length ? `（${n}/${items.length} 項完整）` : '';
}

// 初始化：加入第一個空白品項
addItem();

async function handleSubmit() {
  if (!WEBHOOK_URL) { showFarmErr('請先在右上角設定中填入 Webhook 網址。'); return; }
  const farm     = document.getElementById('farmerFarm').value.trim();
  const weekDate = document.getElementById('weekDate').value.trim();
  if (!weekDate) { showFarmErr('請確認週次有正確填寫'); return; }
  if (!farm)     { showFarmErr('請確認農場有正確填寫'); return; }
  const valid = items.filter(i => i.name && i.price);
  if (!valid.length) { showFarmErr('請至少填寫一項農產品（品名、進貨價都是必填）'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 送出中…';
  hideFarmErr();

  const ts   = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const name = document.getElementById('register').value.trim();
  const rows = valid.map((i, idx) => {
    const converted = convertToJin(i);
    return {
      時間戳記: ts, 登記人: name, 農場: farm,
      週次: formatDate(weekDate), 品名: i.name, 數量: converted.qty, 單位: converted.unit,
      基本進貨價: converted.price, 批價: converted.wholesalePrice, 批價門檻: converted.wholesaleThreshold,
      末端建議售價: converted.retailPrice, 農二出貨價: converted.actualPrice, 品項備注: converted.itemNote,
      備註: idx === 0 ? document.getElementById('notes').value.trim() : '',
    };
  });

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    hideFarmErr();
    document.getElementById('formSection').style.display = 'none';
    const box = document.getElementById('successBox');
    box.style.display = 'block';
    document.getElementById('successDetail').textContent =
      `${farm} 共登記 ${valid.length} 項：${valid.map(i => i.name).join('、')}。`;
  } catch (e) {
    showFarmErr('連線失敗，請確認網路或 Apps Script 網址。');
    btn.disabled = false;
    btn.innerHTML = _submitIcon() + ' 送出登記';
  }
}

function resetForm() {
  document.getElementById('formSection').style.display = 'block';
  document.getElementById('successBox').style.display  = 'none';
  document.getElementById('notes').value = '';
  const btn = document.getElementById('submitBtn');
  btn.disabled = false;
  btn.innerHTML = _submitIcon() + ' 送出登記';
  items = []; nid = 1; addItem();
}

function showFarmErr(msg) {
  const e = document.getElementById('errorMsg');
  e.style.display = 'block'; e.textContent = msg;
  e.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideFarmErr() { document.getElementById('errorMsg').style.display = 'none'; }

function _submitIcon() {
  return '<svg width="18" height="18" viewBox="0 0 18 18" fill="none">' +
    '<path d="M9 1L17 9L9 17" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M1 9h16" stroke="white" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

// ════════════════════════════════════════════
// 農場瀏覽 / 編輯
// ════════════════════════════════════════════
let selectedWeeks = new Set();
let editStore     = {};

// ── 週次 chips ────────────────────────────────
async function loadWeekChips() {
  if (!WEBHOOK_URL) return;
  const chips      = document.getElementById('weekChips');
  const refreshBtn = document.getElementById('refreshBtn');
  chips.innerHTML = '<span style="font-size:12px;color:var(--gray-400);">載入中…</span>';
  refreshBtn.style.display = 'none';
  try {
    const res  = await fetch(WEBHOOK_URL + '?action=weeks');
    const data = await res.json();
    renderWeekChips(data.weeks || []);
  } catch(e) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--red-400);">載入失敗</span>';
  }
  refreshBtn.style.display = 'block';
}

function renderWeekChips(weeks) {
  const container = document.getElementById('weekChips');
  if (!weeks.length) {
    container.innerHTML = '<span style="color:var(--gray-400);font-size:13px;">目前尚無資料</span>';
    return;
  }
  container.innerHTML = '';
  weeks.forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'week-chip';
    btn.textContent = w;
    btn.onclick = () => {
      if (selectedWeeks.has(w)) { selectedWeeks.delete(w); btn.classList.remove('active'); }
      else                       { selectedWeeks.add(w);    btn.classList.add('active'); }
      _updateChipsHint();
    };
    container.appendChild(btn);
  });
  document.getElementById('chipsHint').textContent = '可選擇多個週次';
}

function _updateChipsHint() {
  const n = selectedWeeks.size;
  document.getElementById('chipsHint').textContent = n === 0 ? '可選擇多個週次' : `已選 ${n} 個週次`;
}

async function refreshWeekChips() {
  weekChipsLoaded = false;
  await loadWeekChips();
  weekChipsLoaded = true;
}

// ── 查詢 ──────────────────────────────────────
async function fetchBrowseData() {
  if (!WEBHOOK_URL) { _setBrowseMsg('請先在設定中填入 Webhook 網址。'); return; }

  const spinner = document.getElementById('browseSpinner');
  const results = document.getElementById('searchResults');
  spinner.style.display = 'block'; results.innerHTML = '';

  try {
    const queryWeeks = new Set(selectedWeeks);
    const val = document.getElementById('browseWeekDate').value;
    if (val) queryWeeks.add(formatDate(val));

    // 同步 chip active 狀態
    document.querySelectorAll('#weekChips .week-chip').forEach(c =>
      c.classList.toggle('active', queryWeeks.has(c.textContent.trim()))
    );

    const weeksParam = Array.from(queryWeeks).join(',');
    const url = WEBHOOK_URL + '?action=query' + (weeksParam ? '&weeks=' + encodeURIComponent(weeksParam) : '');
    const res  = await fetch(url);
    const data = await res.json();
    spinner.style.display = 'none';
    renderSearchResults(data.data || []);
  } catch(e) {
    console.error('查詢失敗', e);
    spinner.style.display = 'none';
    results.innerHTML = '<div class="browse-empty"><span class="empty-icon">⚠️</span>查詢失敗，請確認網路或 Webhook 設定</div>';
  }
}

function _setBrowseMsg(msg) {
  document.getElementById('searchResults').innerHTML =
    `<div class="browse-empty"><span class="empty-icon">🌶️</span>${msg}</div>`;
}

// ── 結果渲染 ──────────────────────────────────
function getBaseId(rowId) {
  return String(rowId || '').replace(/-\d+$/, '');
}

function prepEditRow(row) {
  const sid = getBaseId(row['提交ID'] || '');
  if (!sid) return;
  if (!editStore[sid]) editStore[sid] = { rows: [] };
  editStore[sid].rows.push(row);
}

function renderSearchResults(rows) {
  console.log('test');
  editStore = {};
  const container = document.getElementById('searchResults');
  if (!rows.length) {
    container.innerHTML = '<div class="browse-empty"><span class="empty-icon">🌱</span>查無符合資料</div>';
    return;
  }

  const farmMap = {}, farmOrder = [];
  rows.forEach(r => {
    prepEditRow(r);
    const f = r['農場'] || '（未填農場）';
    if (!farmMap[f]) { farmMap[f] = []; farmOrder.push(f); }
    farmMap[f].push(r);
  });

  let html = `<div class="browse-summary">共 ${rows.length} 筆 · ${farmOrder.length} 個農場</div>`;
  farmOrder.forEach(farm => {
    const farmRows   = farmMap[farm];
    const registrant = farmRows[0]['登記人'] || '';
    const note       = farmRows[0]['本批備註'] || '';
    html += `<div class="farm-group">
      <div class="farm-group-header">
        <span class="farm-name">🌿 ${esc(farm)}</span>
        <span class="farm-meta">${registrant ? `登記人：${esc(registrant)}<br>` : ''}${farmRows.length} 項</span>
      </div>`;
    if (note) html += `<div class="farm-note-banner"><span class="note-label">📝</span><span>${esc(note)}</span></div>`;
    html += `<table class="browse-table"><thead><tr>
      <th>品名</th><th>數量</th><th>進貨 / 批價</th><th>建議零售</th><th>農二出貨價</th><th></th>
    </tr></thead><tbody>`;

    const sidCounters = {};
    farmRows.forEach(r => {
      const sid = getBaseId(r['提交ID'] || '');
      if (sidCounters[sid] === undefined) sidCounters[sid] = 0;
      const rowIdx = sidCounters[sid]++;
      const rowId  = sid ? `row-${sid}-${rowIdx}` : '';

      const qty = r['數量'] ? `${esc(r['數量'])} ${esc(r['單位'] || '')}` : '—';
      const purchaseHtml = `
        <div style="margin-bottom:4px">${r['基本進貨價'] ? `<span class="price-pill">進貨 $${esc(r['基本進貨價'])}</span>` : '—'}</div>
        <div>${r['批價']
          ? `<span class="wholesale-pill">批 $${esc(r['批價'])}${r['批價門檻'] ? ` / ${esc(r['批價門檻'])}起` : ''}</span>`
          : '<span style="color:var(--gray-400)">—</span>'}</div>`;
      const retailHtml = r['末端建議售價']
        ? `<span class="price-pill">$${esc(r['末端建議售價'])}</span>`
        : '<span style="color:var(--gray-400)">—</span>';
      const actualHtml = r['農二出貨價']
        ? `<span class="price-pill" style="background:#EEF4FF;border-color:#B0C8F0;color:#2850A0">$${esc(r['農二出貨價'])}</span>`
        : '<span style="color:var(--gray-400)">—</span>';
      const itemNote = r['品項備注'] ? `<div class="item-note-badge">　${esc(r['品項備注'])}</div>` : '';
      const editBtn  = sid ? `<button class="row-edit-btn" onclick="editRow('${esc(sid)}',${rowIdx})" aria-label="編輯">✎</button>` : '';

      html += `<tr${rowId ? ` id="${rowId}"` : ''}>
        <td>${esc(r['品名'] || '')}${itemNote}</td>
        <td>${qty}</td>
        <td>${purchaseHtml}</td>
        <td>${retailHtml}</td>
        <td>${actualHtml}</td>
        <td style="text-align:center;width:36px">${editBtn}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });
  container.innerHTML = html;
}

// ── 列編輯 ────────────────────────────────────
function editRow(sid, rowIdx) {
  console.log('test');
  const data = editStore[sid];
  if (!data) return;
  const r     = data.rows[rowIdx];
  const rowId = `row-${sid}-${rowIdx}`;
  const tr    = document.getElementById(rowId);
  if (!tr) return;

  const thead = tr.closest('table').querySelector('thead');
  if (thead) thead.style.display = 'none';

  const unitOpts = UNITS.map(u =>
    `<option${u === (r['單位'] || '公斤') ? ' selected' : ''}>${u}</option>`).join('');

  tr.innerHTML = `
    <td colspan="5" style="padding:8px 6px">
      <div class="item-row" style="margin-bottom:8px">
        <div class="extra-field"><label>品名 *</label>
          <input type="text" id="ei-name-${rowId}" value="${esc(r['品名'] || '')}" placeholder="品名 *" /></div>
        <div class="extra-field"><label>數量</label>
          <div class="qty-wrap">
            <input type="number" id="ei-qty-${rowId}" min="0" value="${esc(r['數量'] || '')}" placeholder="數量" />
            <select id="ei-unit-${rowId}">${unitOpts}</select>
          </div></div>
        <div class="extra-field"><label>基本進貨價 (元) *</label>
          <input type="number" id="ei-price-${rowId}" min="0" value="${esc(r['基本進貨價'] || '')}" placeholder="進貨價 *" /></div>
      </div>
      <div class="item-extras-grid" style="margin-bottom:6px">
        <div class="extra-field"><label>批價（元）</label>
          <input type="number" id="ei-wp-${rowId}" min="0" value="${esc(r['批價'] || '')}" placeholder="批價" /></div>
        <div class="extra-field"><label>批價門檻</label>
          <input type="number" id="ei-wt-${rowId}" min="0" value="${esc(r['批價門檻'] || '')}" placeholder="批量起訂" /></div>
        <div class="extra-field"><label>末端建議售價</label>
          <input type="number" id="ei-rp-${rowId}" min="0" value="${esc(r['末端建議售價'] || '')}" placeholder="零售價" /></div>
        <div class="extra-field"><label>農二出貨價</label>
          <input type="number" id="ei-ap-${rowId}" min="0" value="${esc(r['農二出貨價'] || '')}" placeholder="農二出貨價" /></div>
      </div>
      <div class="item-note-field"><label>品項備注</label>
        <textarea id="ei-note-${rowId}" style="min-height:32px">${esc(r['品項備注'] || '')}</textarea>
      </div>
    </td>
    <td style="vertical-align:top;padding-top:10px;width:36px">
      <div style="display:flex;flex-direction:column;gap:5px">
        <button class="save-edit-btn" id="ei-save-${rowId}"
          style="padding:6px 8px;font-size:13px;min-width:0"
          onclick="saveRow('${esc(sid)}',${rowIdx})">✓</button>
        <button class="cancel-edit-btn"
          style="padding:6px 8px;font-size:13px;min-width:0"
          onclick="restoreRow('${esc(sid)}',${rowIdx})">✕</button>
      </div>
    </td>`;
}

function restoreRow(sid, rowIdx) {
  const data = editStore[sid];
  if (!data) return;
  const r     = data.rows[rowIdx];
  const rowId = `row-${sid}-${rowIdx}`;
  const tr    = document.getElementById(rowId);
  if (!tr) return;

  const thead = tr.closest('table').querySelector('thead');
  if (thead) thead.style.display = '';

  const qty = r['數量'] ? `${esc(r['數量'])} ${esc(r['單位'] || '')}` : '—';
  const purchaseHtml = `
    <div style="margin-bottom:4px">${r['基本進貨價'] ? `<span class="price-pill">進貨 $${esc(r['基本進貨價'])}</span>` : '—'}</div>
    <div>${r['批價']
      ? `<span class="wholesale-pill">批價 $${esc(r['批價'])}${r['批價門檻'] ? ` / ${esc(r['批價門檻'])} ${esc(r['單位'] || '')} 起` : ''}</span>`
      : '<span style="color:var(--gray-400)">—</span>'}</div>`;
  const retailHtml = r['末端建議售價']
    ? `<span class="price-pill">$${esc(r['末端建議售價'])}</span>`
    : '<span style="color:var(--gray-400)">—</span>';
  const actualHtml = r['農二出貨價']
    ? `<span class="price-pill" style="background:#EEF4FF;border-color:#B0C8F0;color:#2850A0">$${esc(r['農二出貨價'])}</span>`
    : '<span style="color:var(--gray-400)">—</span>';
  const itemNote = r['品項備注'] ? `<div class="item-note-badge">　${esc(r['品項備注'])}</div>` : '';

  tr.innerHTML = `
    <td>${esc(r['品名'] || '')}${itemNote}</td>
    <td>${qty}</td>
    <td>${purchaseHtml}</td>
    <td>${retailHtml}</td>
    <td>${actualHtml}</td>
    <td style="text-align:center;width:36px">
      <button class="row-edit-btn" onclick="editRow('${esc(sid)}',${rowIdx})" aria-label="編輯">✎:D</button>
    </td>`;
}

async function saveRow(sid, rowIdx) {
  if (!WEBHOOK_URL) return;
  const data = editStore[sid];
  if (!data) return;

  const rowId = `row-${sid}-${rowIdx}`;
  const name  = document.getElementById(`ei-name-${rowId}`).value.trim();
  const qty   = document.getElementById(`ei-qty-${rowId}`).value.trim();
  const unit  = document.getElementById(`ei-unit-${rowId}`).value;
  const price = document.getElementById(`ei-price-${rowId}`).value.trim();
  const wp    = document.getElementById(`ei-wp-${rowId}`).value.trim();
  const wt    = document.getElementById(`ei-wt-${rowId}`).value.trim();
  const rp    = document.getElementById(`ei-rp-${rowId}`).value.trim();
  const ap    = document.getElementById(`ei-ap-${rowId}`).value.trim();
  const note  = document.getElementById(`ei-note-${rowId}`).value.trim();

  if (!name || !price) { alert('品名和進貨價為必填'); return; }

  const converted = convertToJin({ qty, unit, price, wholesalePrice: wp, wholesaleThreshold: wt,
                                     retailPrice: rp, actualPrice: ap, itemNote: note });
  
  const saveBtn = document.getElementById(`ei-save-${rowId}`);
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }

  const originalRow = data.rows[rowIdx];
  const updatedRow  = { ...originalRow,
    品名: name, 數量: converted.qty, 單位: converted.unit,
    基本進貨價: converted.price, 批價: converted.wholesalePrice, 批價門檻: converted.wholesaleThreshold,
    末端建議售價: converted.retailPrice, 農二出貨價: converted.actualPrice, 品項備注: converted.itemNote };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'updateRow',
        target: FARM_DATA_TARGET,
        提交ID: originalRow['提交ID'],
        row: { 品名: name, 數量: converted.qty, 單位: converted.unit,
               基本進貨價: converted.price, 批價: converted.wholesalePrice, 批價門檻: converted.wholesaleThreshold,
               末端建議售價: converted.retailPrice, 農二出貨價: converted.actualPrice, 品項備注: converted.itemNote },
      }),
    });

    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message || '伺服器回傳錯誤');
    editStore[sid].rows = data.rows.map((r, i) => i === rowIdx ? updatedRow : r);
    restoreRow(sid, rowIdx);
  } catch(e) {
    alert(`儲存失敗：${e.message}`);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓'; }
  }
}