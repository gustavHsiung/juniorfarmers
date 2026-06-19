// =============================================
// tab-browse.js — 供需分析  v1.0.1
// 依賴：shared.js（WEBHOOK_URL, formatDate, getNearestMonday, esc）
// =============================================

let analysisWeekChipsLoaded = false;
let _matchedCards = [];

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
    const [farmRes, orderRes, tripRes] = await Promise.all([
      fetch(WEBHOOK_URL + '?action=query&weeks=' + weeksParam),
      fetch(WEBHOOK_URL + '?action=orderQuery&weeks=' + weeksParam),
      fetch(WEBHOOK_URL + '?action=tripQuery&weeks=' + weeksParam),
    ]);
    const farmData  = await farmRes.json();
    const orderData = await orderRes.json();
    const tripData  = await tripRes.json();
    spinner.style.display = 'none';
    renderAnalysis(weekStr, farmData.data || [], orderData.data || [], tripData.data || []);
  } catch(e) {
    console.error('_fetchAnalysisWithWeek', e);
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

// ── 行程地圖（展開/收合）────────────────────
let _leafletLoaded = false;
let _routeMap = null;
let _routeGeometryCache = null; // { totalKm, trips: [{trip, coords, routeCoords}] }
let _currentTripRows = []; // 由 renderAnalysis 傳入，供地圖使用

/** 解析 GPX 座標字串 (+22.8145698,+121.088959) → [lat, lng] */
// ── GPX parse ────────────────
function parseGPX(str) {
  // (+22.8145698,+121.088959) → [22.8145698, 121.088959]
  const m = String(str || '').match(/([\+\-]?\d+\.\d+),\s*([\+\-]?\d+\.\d+)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}
async function _fetchRouteGeometries() {
  if (_routeGeometryCache) return _routeGeometryCache;

  // 只取有出發＋到達 GPX 的收菜/送菜列
  const movingRows = _currentTripRows.filter(r =>
    (r['作業'] === '收菜' || r['作業'] === '送菜') &&
    r['出發地點 GPX'] && r['到達地點 GPX']
  );

  // 先從 到達地點 建立地點類型表（收菜到達=農場，送菜到達=店家；農場優先）
  const locationTypeMap = {};
  movingRows.forEach(r => {
    const name = (r['到達地點'] || '').trim();
    if (!name) return;
    const type = r['作業'] === '收菜' ? 'farm' : 'shop';
    if (!locationTypeMap[name] || type === 'farm') locationTypeMap[name] = type;
  });
  const getType = (name, fallbackAct) =>
    locationTypeMap[name] || (fallbackAct === '收菜' ? 'farm' : 'shop');

  // 依「連續相同作業」分段（同趟次內可能混有收菜/送菜）
  const groups = [];
  movingRows.forEach(r => {
    const act  = r['作業'];
    const last = groups[groups.length - 1];
    if (last && last.act === act) {
      last.rows.push(r);
    } else {
      groups.push({ act, rows: [r], color: act === '收菜' ? '#3B6D11' : '#A65252' });
    }
  });

  let totalM = 0;
  const trips = await Promise.all(groups.map(async group => {
    const { act, rows, color } = group;

    // 串接停靠點序列（每列的出發點 + 最後一列的到達點，相鄰重複自動去除）
    const rawCoords = [];
    rows.forEach((r, i) => {
      const dep = parseGPX(r['出發地點 GPX']);
      if (dep) {
        const name = (r['出發地點'] || '').trim();
        if (!rawCoords.length || rawCoords[rawCoords.length - 1].name !== name)
          rawCoords.push({ coord: dep, name, type: getType(name, act) });
      }
      if (i === rows.length - 1) {
        const arr = parseGPX(r['到達地點 GPX']);
        if (arr) rawCoords.push({ coord: arr, name: (r['到達地點'] || '').trim(), type: getType(r['到達地點'], act) });
      }
    });

    const coords = rawCoords.map(p => p.coord);
    const trip   = { label: act, color, act, stops: rawCoords };

    if (coords.length < 2) return { trip, coords, routeCoords: coords };
    try {
      const lngLats = coords.map(([lat, lng]) => `${lng},${lat}`).join(';');
      const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${lngLats}?overview=full&geometries=geojson`);
      const data = await res.json();
      const route = data.routes[0];
      totalM += route.distance || 0;
      const routeCoords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      return { trip, coords, routeCoords };
    } catch {
      return { trip, coords, routeCoords: coords };
    }
  }));

  _routeGeometryCache = { totalKm: (totalM / 1000).toFixed(1), trips };
  return _routeGeometryCache;
}
 
async function _updateRouteDistanceStat() {
  const cache = await _fetchRouteGeometries();
  const el = document.getElementById('routeDistanceVal');
  if (el) el.textContent = cache.totalKm;
}

function toggleRouteMap() {
  const wrap = document.getElementById('routeMapWrap');
  const btn  = document.getElementById('routeMapToggleBtn');
  if (!wrap) return;
  const opening = wrap.style.display === 'none' || wrap.style.display === '';
  wrap.style.display = opening ? 'block' : 'none';
  btn.setAttribute('aria-expanded', opening);
  btn.querySelector('.route-map-arrow').style.transform = opening ? 'rotate(180deg)' : '';
  if (opening) _ensureLeaflet(_initRouteMap);
}

async function _initRouteMap() {
  if (!window.L) return;
  if (_routeMap) { _routeMap.invalidateSize(); return; }
 
  _routeMap = L.map('routeMapCanvas').setView([22.93, 121.12], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 18,
  }).addTo(_routeMap);
 
  const bounds = [];
  const cache  = await _fetchRouteGeometries();
 
  cache.trips.forEach(({ trip, coords, routeCoords }) => {
    coords.forEach(c => bounds.push(c));
    if (coords.length < 2) return;
    const isRoad = routeCoords !== coords;
    L.polyline(routeCoords, {
      color: trip.color, weight: 4, opacity: 0.8,
      ...(isRoad ? {} : { dashArray: '6 4' }),
    }).addTo(_routeMap);
  });
 
  // 動態收集所有不重複地點（出發+到達）
  const seenMarkers = {};
  cache.trips.forEach(({ trip }) => {
    trip.stops.forEach(p => {
      if (!p.name) return;
      // farm 優先：若已標記為 farm 則不覆蓋
      if (!seenMarkers[p.name] || p.type === 'farm')
        seenMarkers[p.name] = { coord: p.coord, type: p.type };
    });
  });
  Object.entries(seenMarkers).forEach(([name, { coord, type }]) => {
    const isFarm = type === 'farm';
    const color  = isFarm ? '#3B6D11' : '#A65252';
    const emoji  = isFarm ? '🌿' : '🍽️';
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        background:${color};color:#fff;
        font-size:11px;font-weight:600;
        padding:3px 7px;border-radius:12px;
        white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);
        display:flex;align-items:center;gap:4px;
      ">${emoji} ${esc(name)}</div>`,
      iconAnchor: [0, 12],
    });
    L.marker(coord, { icon })
      .addTo(_routeMap)
      .bindPopup(`<b>${esc(name)}</b><br>${isFarm ? '農場' : '店家'}`);
  });
 
  if (bounds.length) _routeMap.fitBounds(bounds, { padding: [28, 28] });
}

function _ensureLeaflet(cb) {
  if (window.L) { cb(); return; }
  // 載入 Leaflet CSS
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(link);
  }
  // 載入 Leaflet JS
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  script.onload = cb;
  document.head.appendChild(script);
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
function renderAnalysis(weekStr, farmRows, orderRows, tripRows) {
  const results = document.getElementById('analysisResults');
  // 每次重新渲染時重置地圖與路線 cache
  if (_routeMap) { _routeMap.remove(); _routeMap = null; }
  _routeGeometryCache = null;
  _currentTripRows = tripRows;

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
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
      ${_statCard('農場', farms.size, '🌿')}
      ${_statCard('供應品項', farmItems.length, '🥬')}
      ${_statCard('店家/料理人', shops.size, '🍽️')}
      ${_statCard('訂單品項', orderItems.length, '📋')}
      ${_statCard('里程估算', '<span id="routeDistanceVal">…</span><span style="font-size:13px;font-weight:400"> km</span>', '🛣️')}
    </div>
    <button id="routeMapToggleBtn" class="route-map-toggle" onclick="toggleRouteMap()" aria-expanded="false">
      <span>🗺️ 本週行程地圖</span>
      <span class="route-map-arrow" style="transition:transform 0.25s;display:inline-block;font-size:11px;color:var(--gray-400)">▼</span>
    </button>
    <div id="routeMapWrap" style="display:none;margin-bottom:8px">
      <div class="route-map-legend">
        <span><span class="route-map-dot" style="background:#3B6D11"></span>農場</span>
        <span><span class="route-map-dot" style="background:#A65252"></span>店家</span>
        <span><span class="route-map-dot" style="background:#3B6D11"></span>收菜路線</span>
        <span><span class="route-map-dot" style="background:#A65252"></span>送菜路線</span>
      </div>
      <div id="routeMapCanvas" style="height:300px;border-radius:0 0 10px 10px;overflow:hidden"></div>
    </div>`;

  // ── 🟢 有供有訂：依 農場+品名 合併，訂單顯示為 inline tags ──
  const matchedGroups = {};
  matched.forEach(m => {
    const key = m.farm + '\u0000' + m.supply.name;
    if (!matchedGroups[key]) matchedGroups[key] = { 
      farm: m.farm, 
      name: m.supply.name, 
      supply: m.supply, 
      orders: [] 
    };
    matchedGroups[key].orders.push(m.order);
  });
  _matchedCards = Object.values(matchedGroups);

  const _sectionHeader = (borderColor, labelColor, labelText, count) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:14px 12px 6px">
      <div style="width:3px;height:14px;background:${borderColor};border-radius:2px;flex-shrink:0"></div>
      <span style="font-size:12px;font-weight:600;color:${labelColor};letter-spacing:.04em">${labelText}</span>
      <span style="font-size:11px;color:var(--gray-400)">${count} 項</span>
    </div>`;

  const _card = (borderColor, inner) =>
    `<div style="border-left:3px solid ${borderColor};border-radius:0 8px 8px 0;padding:8px 12px;background:var(--surface);border-top:0.5px solid var(--border);border-right:0.5px solid var(--border);border-bottom:0.5px solid var(--border)">
      ${inner}
    </div>`;

  html += `<div style="display:flex;align-items:center;gap:8px;padding:14px 12px 6px">
    <div style="width:3px;height:14px;background:var(--green-500,#4caf7d);border-radius:2px;flex-shrink:0"></div>
    <span style="font-size:12px;font-weight:600;color:#2d7a4f;letter-spacing:.04em">有供有訂</span>
    <span style="font-size:11px;color:var(--gray-400)">${_matchedCards.length} 項</span>
    <select id="matchedSortSelect" onchange="sortMatchedCards(this.value)"
      style="margin-left:auto;font-size:11px;padding:1px 4px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--gray-500);cursor:pointer;width:auto">
      <option value="default"> ↕ 預設順序</option>
      <option value="name">品名</option>
      <option value="orders">店家數</option>
      <option value="price">銷售總額</option>
    </select>
  </div>`;
  html += `<div id="matchedCardsContainer" style="padding:0 12px 4px;display:flex;flex-direction:column;gap:6px"></div>`;

  html += _sectionHeader('#e6a817', '#9a6e0a', '有供無訂', supplyOnly.length);
  html += `<div style="padding:0 12px 4px;display:flex;flex-direction:column;gap:6px">
    ${supplyOnly.length ? supplyOnly.map(fi => _card(
      '#e6a817',
      `<div style="font-size:13px;font-weight:600;color:var(--gray-800)">
        <span style="color:var(--gray-400);font-weight:400;font-size:12px">${esc(fi.farm)}　</span>${esc(fi.name)}
      </div>
      ${fi.price ? `<div style="font-size:12px;color:var(--gray-500);margin-top:3px">進貨價 $${esc(fi.price)}</div>` : ''}`
    )).join('') : '<span style="color:var(--gray-400);font-size:13px;padding:4px 0;display:block">無</span>'}
  </div>`;

  const orderOnlyGroups = {};
  orderOnly.forEach(oi => {
    if (!orderOnlyGroups[oi.name]) orderOnlyGroups[oi.name] = { name: oi.name, orders: [] };
    orderOnlyGroups[oi.name].orders.push(oi);
  });
  const orderOnlyCards = Object.values(orderOnlyGroups);

  html += _sectionHeader('#e05252', '#a03030', '有訂無供', orderOnlyCards.length);
  html += `<div style="padding:0 12px 4px;display:flex;flex-direction:column;gap:6px">
    ${orderOnlyCards.length ? orderOnlyCards.map(g => {
      const orderTotal = g.orders.reduce((s, o) => s + (parseFloat(o.price) || 0) * (parseFloat(o.qty) || 0), 0);
      const totalHtml  = orderTotal > 0
        ? `<div style="font-size:11px;color:var(--gray-500);margin-top:5px">訂單總金額 <b style="color:#a03030">$${orderTotal.toLocaleString()}</b></div>`
        : '';
      return _card(
        '#e05252',
        `<div style="font-size:13px;font-weight:600;color:var(--gray-800);margin-bottom:5px">${esc(g.name)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${g.orders.map(o => `<span style="font-size:12px;padding:2px 9px;border-radius:20px;background:#fdecea;color:#a03030">${esc(o.shop)}${o.qty ? '（' + esc(o.qty) + ' ' + esc(o.unit) + '）' : ''}</span>`).join('')}
        </div>
        ${totalHtml}`
      );
    }).join('') : '<span style="color:var(--gray-400);font-size:13px;padding:4px 0;display:block">無</span>'}
  </div>`;

  results.innerHTML = html;
  renderMatchedCards('default');
  _ensureLeaflet(() => {});
  _updateRouteDistanceStat();
}

function _matchedCardHtml(g) {
  console.log('_matchedCardHtml', g);
  // 新增：計算銷售總價與利潤
  let sales = 0
  const profit = g.orders.reduce((p, o) => {
    sales += (parseFloat(o.price) || 0) * (parseFloat(o.qty) || 0);

    return p + (((parseFloat(o.price) || 0 )- (parseFloat(g.supply?.price)) || 0) * (parseFloat(o.qty) || 0));
  }, 0);

  const finHtml = sales !== 0
    ? `<div style="font-size:11px;color:var(--gray-500);margin-top:5px;display:flex;gap:10px">
        <span>銷售總價 <b style="color:var(--gray-700)">$${sales.toLocaleString()}</b></span>
       <span>利潤 <b style="color:${profit >= 0 ? '#2d7a4f' : '#a03030'}">$${profit.toLocaleString()}</b></span>
      </div>` : '';

  return `<div style="border-left:3px solid var(--green-500,#4caf7d);border-radius:0 8px 8px 0;padding:8px 12px;background:var(--surface);border-top:0.5px solid var(--border);border-right:0.5px solid var(--border);border-bottom:0.5px solid var(--border)">
    <div style="font-size:13px;font-weight:600;color:var(--gray-800);margin-bottom:5px">
      <span style="color:var(--gray-400);font-weight:400;font-size:12px">${esc(g.farm)}　</span>${esc(g.name)}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${g.orders.map(o => `<span style="font-size:12px;padding:2px 9px;border-radius:20px;background:#e8f5e9;color:#2d7a4f">${esc(o.shop)}${o.qty ? '（' + esc(o.qty) + ' ' + esc(o.unit) + '）' : ''}</span>`).join('')}
    </div>
    ${finHtml}
  </div>`;
}

function renderMatchedCards(sortBy) {
  const container = document.getElementById('matchedCardsContainer');
  if (!container) return;

  const sorted = [..._matchedCards];
  if (sortBy === 'name')   sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));
  if (sortBy === 'orders') sorted.sort((a, b) => b.orders.length - a.orders.length);
  if (sortBy === 'price')  sorted.sort((a, b) => {
  
    const sum = g => g.orders.reduce((acc, o) => acc + (parseFloat(o.price) || 0) * (parseFloat(o.qty) || 0), 0);
    
    return sum(b) - sum(a);
  });

  container.innerHTML = sorted.length
    ? sorted.map(_matchedCardHtml).join('')
    : '<span style="color:var(--gray-400);font-size:13px;padding:4px 0;display:block">無</span>';
}

function sortMatchedCards(val) {
  renderMatchedCards(val);
}

function _statCard(label, value, icon) {
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center">
    <div style="font-size:20px;margin-bottom:4px">${icon}</div>
    <div style="font-size:22px;font-weight:700;color:var(--gray-900)">${value}</div>
    <div style="font-size:11px;color:var(--gray-500);margin-top:2px">${label}</div>
  </div>`;
}