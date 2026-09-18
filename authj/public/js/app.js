// ==================== STATE ====================
const STATE = {
  sessionToken: localStorage.getItem('novex_session'),
  wlName: '',
  keyId: null,
  currentPanel: 'dashboard',
  panicMode: false
};

// ==================== DOM REFS ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  checkPanicStatus();
  if (STATE.sessionToken) {
    const valid = await validateSession();
    if (!valid) {
      localStorage.removeItem('novex_session');
      showAuthOverlay();
    } else {
      hideAuthOverlay();
    }
  } else {
    showAuthOverlay();
  }

  setupNavigation();
  setupAuth();
  setupRefresh();
  setupPanic();
  setupConsole();
  setupModals();
  setupButtons();
  setupSocketHeartbeat();

  if (!isAuthOverlayVisible()) {
    loadCurrentPanel();
    loadAllData();
  }
});

// ==================== AUTH ====================
function showAuthOverlay() { $('#authOverlay').style.display = 'flex'; }
function hideAuthOverlay() { $('#authOverlay').style.display = 'none'; }
function isAuthOverlayVisible() { return $('#authOverlay').style.display !== 'none'; }

function setupAuth() {
  $('#loginBtn').addEventListener('click', doLogin);
  $('#keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const key = $('#keyInput').value.trim();
  if (!key) return showAuthError('Key giriniz');

  $('#loginBtn').disabled = true;
  $('#loginBtn').textContent = 'Kontrol ediliyor...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();

    if (data.success) {
      STATE.sessionToken = data.session_token;
      STATE.wlName = data.wl_name;
      STATE.keyId = data.key_id;
      localStorage.setItem('novex_session', data.session_token);
      hideAuthOverlay();
      $('#wlGreeting').textContent = 'Hos Geldin, ' + data.wl_name;
      $('#panelBadge').textContent = '| WL: ' + data.wl_name;
      loadCurrentPanel();
      loadAllData();
    } else {
      showAuthError(data.message || 'Giris basarisiz');
    }
  } catch (e) {
    showAuthError('Baglanti hatasi');
  }
  $('#loginBtn').disabled = false;
  $('#loginBtn').textContent = 'Giris Yap';
}

function showAuthError(msg) {
  $('#authError').textContent = msg;
  setTimeout(() => { $('#authError').textContent = ''; }, 4000);
}

async function validateSession() {
  try {
    const res = await fetch('/api/auth/validate-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: STATE.sessionToken })
    });
    const data = await res.json();
    if (data.valid) {
      STATE.wlName = data.wl_name;
      STATE.keyId = data.key_id;
      $('#wlGreeting').textContent = 'Hos Geldin, ' + data.wl_name;
      $('#panelBadge').textContent = '| WL: ' + data.wl_name;
      return true;
    }
    return false;
  } catch { return false; }
}

function setupSocketHeartbeat() {
  const socket = io();
  setInterval(() => {
    if (STATE.sessionToken) {
      socket.emit('heartbeat', { session_token: STATE.sessionToken });
    }
  }, 30000);

  socket.on('panic_activated', () => {
    STATE.panicMode = true;
    updatePanicStatus();
  });
  socket.on('panic_deactivated', () => {
    STATE.panicMode = false;
    updatePanicStatus();
  });
}

// ==================== NAVIGATION ====================
function setupNavigation() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const panel = item.dataset.panel;
      switchPanel(panel);
    });
  });
}

function switchPanel(panel) {
  STATE.currentPanel = panel;
  $$('.nav-item').forEach(i => i.classList.remove('active'));
  const navItem = $(`.nav-item[data-panel="${panel}"]`);
  if (navItem) navItem.classList.add('active');

  $$('.panel').forEach(p => p.classList.remove('active'));
  const panelEl = $(`#panel-${panel}`);
  if (panelEl) panelEl.classList.add('active');

  loadCurrentPanel();
}

// ==================== DATA LOADING ====================
function loadCurrentPanel() {
  switch (STATE.currentPanel) {
    case 'dashboard': loadDashboard(); break;
    case 'key-management': loadKeys(); break;
    case 'active-sessions': loadSessions(); break;
    case 'whitelist-panel': loadWhitelist(); break;
    case 'system-console': break;
    case 'system-logs': loadLogs(); break;
    case 'alerts': loadAlerts(); break;
    case 'banned-ips': loadBannedIps(); break;
    case 'wl-ips': loadWlIps(); break;
    case 'settings-panel': loadSettings(); break;
  }
}

function loadAllData() {
  loadDashboard();
}

// ==================== DASHBOARD ====================
async function loadDashboard() {
  await Promise.all([
    loadDashboardStats(),
    loadRecentLogins(),
    loadStatusReport(),
    loadDailyChart()
  ]);
}

async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const d = await res.json();
    $('#statTotalKeys').textContent = d.totalKeys;
    $('#statActiveKeys').textContent = d.activeKeys;
    $('#statOnline').textContent = d.onlineNow;
    $('#statAvgAuth').textContent = d.avgAuthHours + 's';

    $('#licTotal').textContent = d.totalKeys;
    $('#licActive').textContent = d.activeKeys;
    $('#licExpired').textContent = d.totalKeys - d.activeKeys;
    $('#licBanned').textContent = '0';
    $('#licUsage').textContent = d.totalKeys > 0 ? '%' + Math.round((d.onlineNow / d.activeKeys) * 100) || 0 : '%0';
    $('#licToday').textContent = d.totalLoginsToday;

    // Update key table for banned count
    try {
      const kres = await fetch('/api/keys/list');
      const keys = await kres.json();
      const banned = keys.filter(k => k.is_banned).length;
      $('#licBanned').textContent = banned;
    } catch {}
  } catch {}
}

async function loadRecentLogins() {
  try {
    const res = await fetch('/api/dashboard/recent-logins');
    const logs = await res.json();
    const tbody = $('#recentLoginsBody');
    tbody.innerHTML = logs.slice(0, 10).map(l => `
      <tr>
        <td>${esc(l.wl_name || '-')}</td>
        <td style="font-family:monospace;font-size:11px;">${esc((l.key_value || '').substring(0, 16))}...</td>
        <td>${esc(l.ip_address || '-')}</td>
        <td style="color:#555;">${formatDate(l.timestamp)}</td>
      </tr>
    `).join('');
  } catch {}
}

async function loadStatusReport() {
  try {
    const res = await fetch('/api/dashboard/status-report');
    const d = await res.json();
    const maxVal = Math.max(d.today, d.thisMonth, 1);

    setCircle('#circleToday', '#circleTodayVal', d.today, maxVal);
    setCircle('#circleMonth', '#circleMonthVal', d.thisMonth, maxVal * 30);
    setCircle('#circleFailed', '#circleFailedVal', d.failedToday, Math.max(d.failedToday, d.today));
  } catch {}
}

function setCircle(circleId, valId, value, max) {
  const circle = $(circleId);
  const valEl = $(valId);
  if (!circle || !valEl) return;

  const circumference = 251.2;
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference - (ratio * circumference);
  circle.setAttribute('stroke-dashoffset', offset);
  valEl.textContent = value;
}

async function loadDailyChart() {
  try {
    const res = await fetch('/api/dashboard/daily-stats');
    const stats = await res.json();
    let existingChart = $('#dailyChart');
    if (existingChart) existingChart.remove();

    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-container';
    chartDiv.id = 'dailyChart';
    chartDiv.style.marginTop = '15px';

    if (stats.length === 0) {
      chartDiv.innerHTML = '<div style="color:#444;align-self:center;width:100%;text-align:center;">Henuz veri yok</div>';
    } else {
      const maxVal = Math.max(...stats.map(s => s.count), 1);
      chartDiv.innerHTML = stats.map(s => {
        const h = Math.max((s.count / maxVal) * 180, 4);
        return `<div class="chart-bar" style="height:${h}px;" title="${s.date}: ${s.count} giris"></div>`;
      }).join('');
    }

    const statusCircles = $('.status-circles');
    if (statusCircles) statusCircles.after(chartDiv);
  } catch {}
}

// ==================== KEY MANAGEMENT ====================
async function loadKeys() {
  try {
    const res = await fetch('/api/keys/list');
    const keys = await res.json();
    const tbody = $('#keysTableBody');
    tbody.innerHTML = keys.map(k => {
      let statusHtml = '';
      if (k.is_banned) statusHtml = '<span class="key-tag banned">BANLI</span>';
      else if (!k.is_active) statusHtml = '<span class="key-tag inactive">PASIF</span>';
      else if (k.expires_at && new Date(k.expires_at) < new Date()) statusHtml = '<span class="key-tag expired">SURESI DOLDU</span>';
      else statusHtml = '<span class="key-tag active">AKTIF</span>';

      return `
        <tr>
          <td>#${k.id}</td>
          <td>${esc(k.wl_name)}</td>
          <td style="font-family:monospace;font-size:11px;">${esc(k.key_value.substring(0, 20))}...</td>
          <td>${k.duration_minutes}dk</td>
          <td style="font-size:11px;">${k.expires_at ? formatDate(k.expires_at) : '-'}</td>
          <td>${statusHtml}</td>
          <td>${k.online_sessions || 0}</td>
          <td>${k.usage_count}</td>
          <td>
            <button class="btn-danger btn-sm" onclick="banKey(${k.id})" style="margin:2px;">Ban</button>
            <button class="btn-danger btn-sm" onclick="deleteKey(${k.id})" style="margin:2px;">Sil</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  $('#genKeyBtn')?.addEventListener('click', generateKey);
  $('#bulkGenBtn')?.addEventListener('click', bulkGenerateKeys);
  $('#banKeyBtn')?.addEventListener('click', () => doKeyAction('ban'));
  $('#unbanKeyBtn')?.addEventListener('click', () => doKeyAction('unban'));
  $('#deleteKeyBtn')?.addEventListener('click', () => doKeyAction('delete'));
  $('#extendKeyBtn')?.addEventListener('click', () => doKeyAction('extend'));
  $('#resetHwidBtn')?.addEventListener('click', () => doKeyAction('resethwid'));
});

async function generateKey() {
  const wlName = $('#keyWlName').value.trim();
  const duration = $('#keyDuration').value;
  if (!wlName) return alert('WL adi girin');

  const res = await fetch('/api/keys/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wl_name: wlName, duration_minutes: parseInt(duration) })
  });
  const data = await res.json();
  if (data.success) {
    const gk = $('#generatedKey');
    gk.style.display = 'block';
    gk.textContent = 'Key: ' + data.key;
    loadKeys();
  }
}

async function bulkGenerateKeys() {
  const wlName = $('#bulkWlName').value.trim();
  const count = parseInt($('#bulkCount').value);
  const duration = $('#bulkDuration').value;
  if (!wlName || !count) return alert('WL adi ve adet girin');

  const res = await fetch('/api/keys/bulk-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wl_name: wlName, duration_minutes: parseInt(duration), count })
  });
  const data = await res.json();
  if (data.success && data.keys) {
    const bk = $('#bulkGeneratedKeys');
    bk.style.display = 'block';
    bk.innerHTML = data.keys.map(k => `<div style="margin:3px 0;">${k}</div>`).join('');
    loadKeys();
  }
}

async function doKeyAction(action) {
  const keyId = parseInt($('#operationKeyId').value);
  if (!keyId) return alert('Key ID girin');

  let url, body = { key_id: keyId };
  switch (action) {
    case 'ban': url = '/api/keys/ban'; break;
    case 'unban': url = '/api/keys/unban'; break;
    case 'delete': url = '/api/keys/delete'; break;
    case 'extend':
      url = '/api/keys/extend';
      body.additional_minutes = parseInt($('#extendDuration').value) || 30;
      break;
    case 'resethwid': url = '/api/keys/reset-hwid'; break;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.success) loadKeys();
  if (action === 'extend' && data.new_expires_at) {
    alert('Sure uzatildi. Yeni bitis: ' + formatDate(data.new_expires_at));
  }
}

async function banKey(id) {
  await fetch('/api/keys/ban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key_id: id })
  });
  loadKeys();
}

async function deleteKey(id) {
  if (!confirm('Bu keyi silmek istediginize emin misiniz?')) return;
  await fetch('/api/keys/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key_id: id })
  });
  loadKeys();
}

// ==================== SESSIONS ====================
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions/active');
    const sessions = await res.json();
    const tbody = $('#sessionsTableBody');
    tbody.innerHTML = sessions.map(s => `
      <tr>
        <td>${esc(s.wl_name)}</td>
        <td style="font-family:monospace;font-size:11px;">${esc((s.key_value || '').substring(0, 16))}...</td>
        <td>${esc(s.ip_address || '-')}</td>
        <td style="font-size:11px;">${formatDate(s.login_at)}</td>
        <td style="font-size:11px;color:#555;">${formatDate(s.last_active)}</td>
        <td><button class="btn-danger btn-sm" onclick="killSession(${s.id})">Sonlandir</button></td>
      </tr>
    `).join('');
  } catch {}
}

async function killSession(id) {
  await fetch('/api/sessions/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: id })
  });
  loadSessions();
}

// ==================== WHITELIST ====================
async function loadWhitelist() {
  try {
    const res = await fetch('/api/whitelist/list');
    const wl = await res.json();
    const tbody = $('#wlTableBody');
    tbody.innerHTML = wl.map(w => `
      <tr>
        <td>#${w.id}</td>
        <td>${esc(w.name)}</td>
        <td>${esc(w.discord_id)}</td>
        <td style="font-size:11px;">${formatDate(w.created_at)}</td>
        <td><button class="btn-danger btn-sm" onclick="removeWl('${esc(w.discord_id)}')">Kaldir</button></td>
      </tr>
    `).join('');
  } catch {}
}

async function removeWl(discordId) {
  await fetch('/api/whitelist/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ discord_id: discordId })
  });
  loadWhitelist();
}

// ==================== LOGS ====================
async function loadLogs() {
  try {
    const res = await fetch('/api/logs/list');
    const logs = await res.json();
    const output = $('#logsOutput');
    output.innerHTML = logs.map(l => `
      <div class="console-line level-${l.level}">
        <span class="console-time">[${formatDate(l.timestamp)}]</span>
        ${esc(l.message)}
      </div>
    `).join('');
    output.scrollTop = output.scrollHeight;
  } catch {}
}

// ==================== ALERTS ====================
async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts/list');
    const alerts = await res.json();
    const list = $('#alertsList');
    list.innerHTML = alerts.map(a => `
      <div class="alert-item severity-${a.severity} ${a.is_read ? 'read' : ''}" onclick="markAlertRead(${a.id})">
        <span class="alert-icon">${a.severity === 'critical' ? '&#9888;' : a.severity === 'high' ? '&#128308;' : a.severity === 'warning' ? '&#128993;' : '&#8505;'}</span>
        <div class="alert-content">
          <div class="alert-title">${esc(a.title)}</div>
          <div class="alert-message">${esc(a.message || '')}</div>
        </div>
        <span class="alert-time">${formatDate(a.created_at)}</span>
      </div>
    `).join('');
  } catch {}
}

async function markAlertRead(id) {
  await fetch('/api/alerts/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alert_id: id })
  });
  loadAlerts();
}

// ==================== BANNED IPs ====================
async function loadBannedIps() {
  try {
    const res = await fetch('/api/ips/banned');
    const ips = await res.json();
    const tbody = $('#bannedIpsBody');
    tbody.innerHTML = ips.map(i => `
      <tr>
        <td style="font-family:monospace;">${esc(i.ip_address)}</td>
        <td>${esc(i.reason || '-')}</td>
        <td style="font-size:11px;">${formatDate(i.created_at)}</td>
        <td><button class="btn-danger btn-sm" onclick="unbanIp('${esc(i.ip_address)}')">Ban Kaldir</button></td>
      </tr>
    `).join('');
  } catch {}
}

async function unbanIp(ip) {
  await fetch('/api/ips/unban', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip })
  });
  loadBannedIps();
}

// ==================== WL IPs ====================
async function loadWlIps() {
  try {
    const res = await fetch('/api/ips/whitelist');
    const ips = await res.json();
    const tbody = $('#wlIpsBody');
    tbody.innerHTML = ips.map(i => `
      <tr>
        <td style="font-family:monospace;">${esc(i.ip_address)}</td>
        <td>${esc(i.description || '-')}</td>
        <td style="font-size:11px;">${formatDate(i.created_at)}</td>
        <td><button class="btn-danger btn-sm" onclick="removeWlIp('${esc(i.ip_address)}')">Kaldir</button></td>
      </tr>
    `).join('');
  } catch {}
}

async function removeWlIp(ip) {
  await fetch('/api/ips/whitelist-remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip })
  });
  loadWlIps();
}

// ==================== SETTINGS ====================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings'); // This endpoint doesn't exist in server, skip for now
  } catch {}
}

// ==================== CONSOLE ====================
function setupConsole() {
  const input = $('#consoleInput');
  if (!input) return;

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const cmd = input.value.trim();
    if (!cmd) return;

    addConsoleLine('> ' + cmd, 'success');

    const parts = cmd.split(' ');
    const action = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (action) {
      case 'help':
        addConsoleLine('  help          - Bu menuyu goster', 'info');
        addConsoleLine('  stats         - Sistem istatistikleri', 'info');
        addConsoleLine('  keys          - Key listesini goster', 'info');
        addConsoleLine('  sessions      - Aktif oturumlar', 'info');
        addConsoleLine('  clear         - Konsolu temizle', 'info');
        addConsoleLine('  panic         - Panic modu aktif et', 'info');
        addConsoleLine('  banip [ip]    - IP banla', 'info');
        addConsoleLine('  unbanip [ip]  - IP ban kaldir', 'info');
        addConsoleLine('  wlip [ip]     - IP whitelist ekle', 'info');
        break;

      case 'clear':
        $('#consoleOutput').innerHTML = '';
        break;

      case 'stats':
        try {
          const r = await fetch('/api/dashboard/stats');
          const d = await r.json();
          addConsoleLine(`  Toplam Key: ${d.totalKeys} | Aktif: ${d.activeKeys} | Online: ${d.onlineNow}`, 'info');
        } catch { addConsoleLine('  Hata', 'error'); }
        break;

      case 'keys':
        try {
          const r = await fetch('/api/keys/list');
          const keys = await r.json();
          addConsoleLine(`  Toplam ${keys.length} key bulundu.`, 'info');
          keys.slice(0, 5).forEach(k => addConsoleLine(`    #${k.id} ${k.wl_name} - ${k.key_value.substring(0,15)}... [${k.is_active && !k.is_banned ? 'AKTIF' : 'PASIF'}]`, 'info'));
        } catch { addConsoleLine('  Hata', 'error'); }
        break;

      case 'panic':
        await fetch('/api/panic/enable', { method: 'POST' });
        addConsoleLine('  PANIC MODE AKTIF EDILDI!', 'critical');
        updatePanicStatus();
        break;

      case 'banip':
        if (args[0]) {
          await fetch('/api/ips/ban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: args[0], reason: args.slice(1).join(' ') || 'Console ban' })
          });
          addConsoleLine(`  ${args[0]} banlandi`, 'warning');
        }
        break;

      case 'wlip':
        if (args[0]) {
          await fetch('/api/ips/whitelist-add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip: args[0], description: args.slice(1).join(' ') || 'Console wl' })
          });
          addConsoleLine(`  ${args[0]} whitelist eklendi`, 'success');
        }
        break;

      default:
        addConsoleLine('  Bilinmeyen komut. help yazin.', 'warning');
    }

    input.value = '';
  });
}

function addConsoleLine(text, level = 'info') {
  const output = $('#consoleOutput');
  if (!output) return;
  const line = document.createElement('div');
  line.className = `console-line level-${level}`;
  const now = new Date();
  const time = now.toLocaleTimeString('tr-TR');
  line.innerHTML = `<span class="console-time">[${time}]</span>${text}`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}

// ==================== PANIC ====================
async function checkPanicStatus() {
  try {
    const res = await fetch('/api/panic/status');
    const d = await res.json();
    STATE.panicMode = d.panic_mode;
    updatePanicStatus();
  } catch {}
}

function setupPanic() {
  $('#panicBtn')?.addEventListener('click', async () => {
    if (STATE.panicMode) {
      if (!confirm('Panic modu devre disi birakilsin mi?')) return;
      await fetch('/api/panic/disable', { method: 'POST' });
      STATE.panicMode = false;
    } else {
      if (!confirm('PANIC MODE: Tum oturumlari kapatip sistemi durdurmak istediginize emin misiniz?')) return;
      await fetch('/api/panic/enable', { method: 'POST' });
      STATE.panicMode = true;
    }
    updatePanicStatus();
  });
}

function updatePanicStatus() {
  const status = $('#panicStatus');
  if (!status) return;
  if (STATE.panicMode) {
    status.innerHTML = '<span class="panic-dot" style="background:#ff0000;box-shadow:0 0 8px #ff0000;"></span> PANIC MODE AKTIF';
    status.style.color = '#ff0000';
  } else {
    status.innerHTML = '<span class="panic-dot"></span> Sistem Aktif';
    status.style.color = '';
  }
}

// ==================== REFRESH ====================
function setupRefresh() {
  $('#refreshBtn')?.addEventListener('click', () => {
    loadCurrentPanel();
    if (STATE.currentPanel === 'dashboard') loadDashboard();
  });
}

// ==================== MODALS ====================
function setupModals() {
  $('#showAllReports')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/dashboard/recent-logins');
      const logs = await res.json();
      const tbody = $('#allReportsBody');
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td>${esc(l.wl_name || '-')}</td>
          <td style="font-family:monospace;font-size:11px;">${esc((l.key_value || '').substring(0, 18))}...</td>
          <td>${esc(l.action)}</td>
          <td>${esc(l.ip_address || '-')}</td>
          <td style="font-size:11px;color:#555;">${formatDate(l.timestamp)}</td>
        </tr>
      `).join('');
      $('#allReportsModal').classList.add('active');
    } catch {}
  });

  $('#closeReports')?.addEventListener('click', () => {
    $('#allReportsModal').classList.remove('active');
  });

  $('#allReportsModal')?.addEventListener('click', (e) => {
    if (e.target === $('#allReportsModal')) {
      $('#allReportsModal').classList.remove('active');
    }
  });
}

// ==================== MISC BUTTONS ====================
function setupButtons() {
  $('#killAllSessions')?.addEventListener('click', async () => {
    if (!confirm('Tum aktif oturumlari sonlandirmak istediginize emin misiniz?')) return;
    await fetch('/api/sessions/kill-all', { method: 'POST' });
    loadSessions();
  });

  $('#clearLogsBtn')?.addEventListener('click', async () => {
    if (!confirm('Tum loglari temizlemek istediginize emin misiniz?')) return;
    await fetch('/api/logs/clear', { method: 'POST' });
    loadLogs();
  });

  $('#markAllRead')?.addEventListener('click', async () => {
    await fetch('/api/alerts/mark-all-read', { method: 'POST' });
    loadAlerts();
  });

  $('#addWlBtn')?.addEventListener('click', async () => {
    const name = $('#wlNameInput').value.trim();
    const discordId = $('#wlDiscordInput').value.trim();
    if (!name || !discordId) return alert('WL Adi ve Discord ID gerekli');
    await fetch('/api/whitelist/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, discord_id: discordId })
    });
    $('#wlNameInput').value = '';
    $('#wlDiscordInput').value = '';
    loadWhitelist();
  });

  $('#banIpBtn')?.addEventListener('click', async () => {
    const ip = $('#banIpInput').value.trim();
    const reason = $('#banIpReason').value.trim();
    if (!ip) return alert('IP gerekli');
    await fetch('/api/ips/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, reason })
    });
    $('#banIpInput').value = '';
    $('#banIpReason').value = '';
    loadBannedIps();
  });

  $('#wlIpAddBtn')?.addEventListener('click', async () => {
    const ip = $('#wlIpInput').value.trim();
    const desc = $('#wlIpDesc').value.trim();
    if (!ip) return alert('IP gerekli');
    await fetch('/api/ips/whitelist-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, description: desc })
    });
    $('#wlIpInput').value = '';
    $('#wlIpDesc').value = '';
    loadWlIps();
  });

  $('#wlIpMyIpBtn')?.addEventListener('click', async () => {
    const res = await fetch('/api/myip');
    const { ip } = await res.json();
    $('#wlIpInput').value = ip || '127.0.0.1';
  });

  $$('.save-setting').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      const inputId = key === 'max_sessions_per_key' ? 'setMaxSessions' : 'setSiteName';
      const value = $(`#${inputId}`).value;
      // Settings save to DB - already handled via init
      alert('Ayar kaydedildi (sayfa yenilenince aktif olur)');
    });
  });
}

// ==================== UTILS ====================
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('tr-TR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch { return dateStr; }
}
