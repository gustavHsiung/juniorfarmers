// =============================================
// tab-browse.js — 供需分析  v1.0.0
// 依賴：shared.js（WEBHOOK_URL, formatDate, getNearestMonday, esc）
// =============================================

let analysisWeekChipsLoaded = false;

// 切到分析頁時自動填入最近的週一，並載入 chips
(function patchSwitchTab() {
  const _orig = window.switchTab;
  window.switchTab = function(tab) {
    _orig(tab);
    if (tab === 'browse') {
      const el = document.getElementById('analysisWeekDate');
      if (el && !el.value) el.value = getNearestMonday();
      if (!analysisWeekChipsLoaded) { loadAnalysisWeekChips(); analysisWeekChipsLoaded = true; }
    }
  };
})();

// ── Week Chips ────────────────────────────────
async function loadAnalysisWeekChips() {
  if (!WEBHOOK_URL) return;
  const chips      = document.getElementById('analysisWeekChips');
  const refreshBtn = document.getElementById('analysisRefreshBtn');
  const hint       = document.getElementById('analysisChipsHint');
  chips.innerHTML  = '<span style="font-size:12px;color:var(--gray-400);">載入中…</span>';
  refreshBtn.style.display = 'none';
  hint.textContent = '';
  try {
    const res  = await fetch(WEBHOOK_URL + '?action=weeks');
    const data = await res.json();
    renderAnalysisWeekChips(data.weeks || []);
  } catch(e) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--red-400);">載入失敗</span>';
  }
  refreshBtn.style.display = 'block';
}

function renderAnalysisWeekChips(weeks) {
  const container = document.getElementById('analysisWeekChips');
  const hint      = document.getElementById('analysisChipsHint');
  if (!weeks.length) {
    container.innerHTML = '<span style="color:var(--gray-400);font-size:13px;">目前尚無資料</span>';
    return;
  }
  container.innerHTML = '';
  hint.textContent = '點選週次快速分析';
  weeks.forEach(w => {
    const btn = document.createElement('button');
    btn.className = 'week-chip';
    btn.textContent = w;
    btn.onclick = () => {
      // 取消其他 chip 的 active
      container.querySelectorAll('.week-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      // 解析週次字串回日期（格式：YYYY-MM-第N週），填入日期欄位後直接查詢
      _applyWeekChip(w);
    };
    container.appendChild(btn);
  });
}

function _applyWeekChip(weekStr) {
  // weekStr 格式：2026-05-第4週，直接用在查詢，不需反推日期
  // 改為直接帶著 weekStr 查詢，繞過 formatDate
  _fetchAnalysisWithWeek(weekStr);
}

async function _fetchAnalysisWithWeek(weekStr) {
  if (!WEBHOOK_URL) return;
  const spinner = document.getElementById('analysisSpinner');
  const results = document.getElementById('analysisResults');
  spinner.style.display = 'block';
  results.innerHTML = '';
  try {
    const weeksParam = encodeURIComponent(weekStr);
    const [farmRes, orderRes] = await Promise.all([
      fetch(WEBHOOK_URL + '?action=query&weeks=' + weeksParam),
      fetch(WEBHOOK_URL + '?action=orderQuery&weeks=' + weeksParam),
    ]);
    const farmData  = await farmRes.json();
    const orderData = await orderRes.json();
    spinner.style.display = 'none';
    renderAnalysis(weekStr, farmData.data || [], orderData.data || []);
  } catch(e) {
    spinner.style.display = 'none';
    results.innerHTML = '<div class="browse-empty"><span class="empty-icon">⚠️</span>查詢失敗，請確認網路或 Webhook 設定。</div>';
  }
}

// ── 品項比對（雙向 includes）────────────────
function itemMatch(a, b) {
  const na = String(a || '').trim();
  const nb = String(b || '').trim();
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

// ── 主查詢（日期選擇器觸發）────────────────
async function fetchAnalysisData() {
  if (!WEBHOOK_URL) {
    document.getElementById('analysisResults').innerHTML =
      '<div class="browse-empty"><span class="empty-icon">⚙️</span>請先在設定中填入 Webhook 網址。</div>';
    return;
  }
  const dateVal = document.getElementById('analysisWeekDate').value;
  if (!dateVal) {
    document.getElementById('analysisResults').innerHTML =
      '<div class="browse-empty"><span class="empty-icon">📅</span>請選擇週次。</div>';
    return;
  }
  const weekStr = formatDate(dateVal);
  // 同步 chip active 狀態
  document.querySelectorAll('#analysisWeekChips .week-chip').forEach(c =>
    c.classList.toggle('active', c.textContent.trim() === weekStr)
  );
  await _fetchAnalysisWithWeek(weekStr);
}

// ── 渲染分析結果 ─────────────────────────────
function renderAnalysis(weekStr, farmRows, orderRows) {
  const results = document.getElementById('analysisResults');

  if (!farmRows.length && !orderRows.length) {
    results.innerHTML = '<div class="browse-empty"><span class="empty-icon">🌱</span>本週無任何資料。</div>';
    return;
  }

  // 整理農場品項
  const farmItems = farmRows.map(r => ({
    farm: r['農場'] || '（未填農場）',
    name: r['品名'] || '',
    qty:  r['數量'] || '',
    unit: r['單位'] || '',
    price: r['基本進貨價'] || '',
  })).filter(r => r.name);

  // 整理訂單品項
  const orderItems = orderRows.map(r => ({
    shop: r['店家/料理人'] || '（未填店家）',
    name: r['品名'] || '',
    qty:  r['數量'] || '',
    unit: r['單位'] || '',
    price: r['單價（元）'] || '',
  })).filter(r => r.name);

  // 統計數字
  const farms    = new Set(farmItems.map(r => r.farm));
  const shops    = new Set(orderItems.map(r => r.shop));

  // 配對
  const matched   = []; // 🟢 有供有訂
  const supplyOnly = []; // 🟡 有供無訂
  const orderOnly  = []; // 🔴 有訂無供

  const usedOrderIdxs = new Set();

  farmItems.forEach(fi => {
    const hits = orderItems
      .map((oi, idx) => ({ oi, idx }))
      .filter(({ oi }) => itemMatch(fi.name, oi.name));
    if (hits.length) {
      hits.forEach(({ oi, idx }) => {
        usedOrderIdxs.add(idx);
        matched.push({ farm: fi.farm, supply: fi, order: oi });
      });
    } else {
      supplyOnly.push(fi);
    }
  });

  orderItems.forEach((oi, idx) => {
    if (!usedOrderIdxs.has(idx)) orderOnly.push(oi);
  });

  // ── 總覽卡片 ──
  let html = `
    <div class="browse-summary" style="margin-bottom:12px">
      ${weekStr} 供需分析
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
      ${_statCard('農場', farms.size, '🌿')}
      ${_statCard('供應品項', farmItems.length, '🥬')}
      ${_statCard('店家/料理人', shops.size, '🍽️')}
      ${_statCard('訂單品項', orderItems.length, '📋')}
    </div>`;

  // ── 🟢 有供有訂：依 農場+品名 合併，訂單顯示為 inline tags ──
  const matchedGroups = {};
  matched.forEach(m => {
    const key = m.farm + '\u0000' + m.supply.name;
    if (!matchedGroups[key]) matchedGroups[key] = { farm: m.farm, name: m.supply.name, orders: [] };
    matchedGroups[key].orders.push(m.order);
  });
  const matchedCards = Object.values(matchedGroups);

  const _card = (borderColor, labelColor, labelText, inner) =>
    `<div style="border-left:3px solid ${borderColor};border-radius:0 8px 8px 0;padding:10px 14px;background:var(--surface);border-top:0.5px solid var(--border);border-right:0.5px solid var(--border);border-bottom:0.5px solid var(--border)">
      <div style="font-size:11px;font-weight:600;color:${labelColor};margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">${labelText}</div>
      ${inner}
    </div>`;

  html += `<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px">
    ${matchedCards.length ? matchedCards.map(g => _card(
      'var(--green-500, #4caf7d)', 'var(--green-600, #2d7a4f)', '有供有訂',
      `<div style="font-size:13px;font-weight:600;color:var(--gray-800);margin-bottom:6px">
        <span style="color:var(--gray-400);font-weight:400;font-size:12px">${esc(g.farm)}　</span>${esc(g.name)}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${g.orders.map(o => `<span style="font-size:12px;padding:2px 9px;border-radius:20px;background:#e8f5e9;color:#2d7a4f">${esc(o.shop)}${o.qty ? '（' + esc(o.qty) + ' ' + esc(o.unit) + '）' : ''}</span>`).join('')}
      </div>`
    )).join('') : _card('var(--green-500,#4caf7d)','var(--green-600,#2d7a4f)','有供有訂','<span style="color:var(--gray-400);font-size:13px">無</span>')}
  </div>`;

  html += `<div style="padding:0 12px 10px;display:flex;flex-direction:column;gap:8px">
    ${supplyOnly.length ? supplyOnly.map(fi => _card(
      '#e6a817', '#9a6e0a', '有供無訂',
      `<div style="font-size:13px;font-weight:600;color:var(--gray-800)">
        <span style="color:var(--gray-400);font-weight:400;font-size:12px">${esc(fi.farm)}　</span>${esc(fi.name)}
      </div>
      ${fi.price ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px">進貨價 $${esc(fi.price)}</div>` : ''}`
    )).join('') : _card('#e6a817','#9a6e0a','有供無訂','<span style="color:var(--gray-400);font-size:13px">無</span>')}
  </div>`;

  const orderOnlyGroups = {};
  orderOnly.forEach(oi => {
    if (!orderOnlyGroups[oi.name]) orderOnlyGroups[oi.name] = { name: oi.name, orders: [] };
    orderOnlyGroups[oi.name].orders.push(oi);
  });
  const orderOnlyCards = Object.values(orderOnlyGroups);

  html += `<div style="padding:0 12px 10px;display:flex;flex-direction:column;gap:8px">
    ${orderOnlyCards.length ? orderOnlyCards.map(g => _card(
      '#e05252', '#a03030', '有訂無供',
      `<div style="font-size:13px;font-weight:600;color:var(--gray-800);margin-bottom:6px">${esc(g.name)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${g.orders.map(o => `<span style="font-size:12px;padding:2px 9px;border-radius:20px;background:#fdecea;color:#a03030">${esc(o.shop)}${o.qty ? '（' + esc(o.qty) + ' ' + esc(o.unit) + '）' : ''}</span>`).join('')}
      </div>`
    )).join('') : _card('#e05252','#a03030','有訂無供','<span style="color:var(--gray-400);font-size:13px">無</span>')}
  </div>`;

  results.innerHTML = html;
}

function _statCard(label, value, icon) {
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
    <div style="font-size:20px;margin-bottom:4px">${icon}</div>
    <div style="font-size:22px;font-weight:700;color:var(--gray-900)">${value}</div>
    <div style="font-size:11px;color:var(--gray-500);margin-top:2px">${label}</div>
  </div>`;
}