// =============================================
// shared.js — 共用常數、設定、工具函式  v1.0.2
// =============================================

const FORM_VERSION = 'v1.0.5';

// 供應表單用單位（farm tab 共用）
const UNITS = ['公斤','台斤','公克','顆','束','盒','袋','包','打','斤','份', '支','把','包','條','片'];
const CN_NUM = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'半':0.5 };
let WEBHOOK_URL = localStorage.getItem('webhookUrl') || '';

// ── 初始化顯示 ────────────────────────────────
document.getElementById('headerTitle').textContent = `菜車供應登記 ${FORM_VERSION}`;
document.getElementById('settingsVersion').textContent = FORM_VERSION;
document.getElementById('webhookInput').value = WEBHOOK_URL;

// ── 設定面板 ──────────────────────────────────
function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  const btn   = document.getElementById('settingsBtn');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  btn.classList.toggle('active', !isOpen);
  if (!isOpen) document.getElementById('webhookInput').value = WEBHOOK_URL;
}

function saveSettings() {
  WEBHOOK_URL = document.getElementById('webhookInput').value.trim();
  localStorage.setItem('webhookUrl', WEBHOOK_URL);
  document.getElementById('settingsPanel').classList.remove('open');
  document.getElementById('settingsBtn').classList.remove('active');
}

// 點選面板外部時關閉
document.addEventListener('click', function(e) {
  const panel = document.getElementById('settingsPanel');
  const btn   = document.getElementById('settingsBtn');
  if (panel.classList.contains('open') &&
      !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.remove('open');
    btn.classList.remove('active');
  }
});

// ── 主 Tab 切換 ───────────────────────────────
let currentTab = 'register';
function switchTab(tab) {
  currentTab = tab;
  ['register', 'order', 'browse'].forEach(t => {
    const panelId = 'panel' + t.charAt(0).toUpperCase() + t.slice(1);
    const btnId   = 'tab'   + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(panelId).style.display = (t === tab) ? '' : 'none';
    document.getElementById(btnId).classList.toggle('active', t === tab);
  });
}

// ── 工具函式 ──────────────────────────────────
function getWeekOfMonth(dateStr) {
  const d = new Date(dateStr);
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  return Math.ceil((d.getDate() + offset) / 7);
}

function formatDate(val) {
  const [year, month] = val.split('-');
  return `${year}-${month}-第${getWeekOfMonth(val)}週`;
}

function getNearestMonday() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? 1 : day === 6 ? 2 : -(day - 1);
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

/** HTML 跳脫（防 XSS） */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 公斤到台斤 */
// 台斤＝600克，重量單位換算基準（換算成台斤價）
const JIN_CONVERSION_FACTORS = { '公斤': 1000/600, '公克': 1/600, '斤': 1 };

function convertToJin({ qty, unit, price, wholesalePrice, wholesaleThreshold, retailPrice, actualPrice, itemNote }) {
  const k = JIN_CONVERSION_FACTORS[unit];
  if (!k) return { qty, unit, price, wholesalePrice, wholesaleThreshold, retailPrice, actualPrice, itemNote };

  const num  = v => (v !== '' && v !== undefined && v !== null && !isNaN(v)) ? parseFloat(v) : null;
  const conv = (v, mul, decimals) => { const n = num(v); return n === null ? v : +(n * mul).toFixed(decimals); };

  const newQty = conv(qty, k, 2);
  const newWt  = conv(wholesaleThreshold, k, 2);
  const newPrice = conv(price, 1 / k, 0);
  const newWp    = conv(wholesalePrice, 1 / k, 0);
  const newRp    = conv(retailPrice, 1 / k, 0);
  const newAp    = conv(actualPrice, 1 / k, 0);

  const parts = [];
  if (qty || price) parts.push(`${qty || ''} ${unit}／進貨價${price || '—'}元`);
  if (wholesalePrice) parts.push(`批價${wholesalePrice}元${wholesaleThreshold ? `(${wholesaleThreshold}${unit}以上)` : ''}`);
  if (retailPrice) parts.push(`建議售價${retailPrice}元`);
  if (actualPrice) parts.push(`農二出貨價${actualPrice}元`);
  const originalNote = `（原始輸入：${parts.join('／')}）`;

  return {
    qty: newQty, unit: '台斤', price: newPrice,
    wholesalePrice: newWp, wholesaleThreshold: newWt,
    retailPrice: newRp, actualPrice: newAp,
    itemNote: itemNote ? `${itemNote} ${originalNote}` : originalNote,
  };
}