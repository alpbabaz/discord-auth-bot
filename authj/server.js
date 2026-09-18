const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new Database('novex.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==================== DATABASE INIT ====================
db.exec(`
  CREATE TABLE IF NOT EXISTS whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    discord_id TEXT UNIQUE NOT NULL,
    added_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_value TEXT UNIQUE NOT NULL,
    wl_name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    is_active INTEGER DEFAULT 1,
    is_banned INTEGER DEFAULT 0,
    hwid TEXT,
    first_used_at DATETIME,
    last_used_at DATETIME,
    usage_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    session_token TEXT UNIQUE,
    login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_online INTEGER DEFAULT 1,
    FOREIGN KEY (key_id) REFERENCES auth_keys(id)
  );

  CREATE TABLE IF NOT EXISTS key_usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER,
    key_value TEXT,
    wl_name TEXT,
    action TEXT NOT NULL,
    ip_address TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT,
    severity TEXT DEFAULT 'warning',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS banned_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT UNIQUE NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS whitelist_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS panic_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    triggered_by TEXT,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT,
    user_agent TEXT,
    url_attempted TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaultSettings = {
  panic_mode: '0',
  site_name: 'Novex Auth',
  max_sessions_per_key: '5',
  auto_ban_threshold: '10'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) {
  insertSetting.run(k, v);
}

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// IP ban middleware
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const clientIp = ip.replace('::ffff:', '').replace('::1', '127.0.0.1');

  const ban = db.prepare('SELECT id FROM banned_ips WHERE ip_address = ?').get(clientIp);
  if (ban) {
    return res.status(403).sendFile(path.join(__dirname, 'public', '403.html'));
  }

  const panic = db.prepare('SELECT value FROM settings WHERE key = ?').get('panic_mode');
  if (panic && panic.value === '1') {
    if (req.path === '/api/panic/disable') {
      return next();
    }
    return res.status(503).sendFile(path.join(__dirname, 'public', 'panic.html'));
  }

  next();
});

// ==================== HELPER FUNCTIONS ====================
function logSystem(level, message) {
  db.prepare('INSERT INTO system_logs (level, message) VALUES (?, ?)').run(level, message);
  io.emit('new_log', { level, message, timestamp: new Date().toISOString() });
}

function logAlert(title, message, severity = 'warning') {
  db.prepare('INSERT INTO alerts (title, message, severity) VALUES (?, ?, ?)').run(title, message, severity);
  io.emit('new_alert', { title, message, severity });
}

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'NX-';
  for (let i = 0; i < 20; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

function cleanExpiredKeys() {
  const result = db.prepare(`
    UPDATE auth_keys SET is_active = 0
    WHERE is_active = 1 AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')
  `).run();
  if (result.changes > 0) {
    logSystem('info', `${result.changes} expired key(s) deactivated`);
  }
}

setInterval(cleanExpiredKeys, 60000);

function updateSessionActivity(sessionId) {
  db.prepare('UPDATE sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
}

function endStaleSessions() {
  const result = db.prepare(`
    UPDATE sessions SET is_online = 0
    WHERE is_online = 1 AND datetime(last_active) < datetime('now', '-5 minutes')
  `).run();
}
setInterval(endStaleSessions, 120000);

// ==================== API ROUTES ====================

// ----- AUTH -----
app.post('/api/auth/login', (req, res) => {
  const { key } = req.body;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '').replace('::1', '127.0.0.1');

  if (!key || !key.startsWith('NX-')) {
    return res.json({ success: false, message: 'Geçersiz key formatı' });
  }

  const keyData = db.prepare('SELECT * FROM auth_keys WHERE key_value = ?').get(key);
  if (!keyData) {
    db.prepare('INSERT INTO key_usage_log (key_value, action, ip_address) VALUES (?, ?, ?)').run(key, 'FAILED_LOGIN_UNKNOWN', ip);
    return res.json({ success: false, message: 'Key bulunamadı' });
  }

  if (keyData.is_banned) {
    return res.json({ success: false, message: 'Bu key banlanmış' });
  }

  if (!keyData.is_active) {
    return res.json({ success: false, message: 'Bu key artık aktif değil' });
  }

  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
    db.prepare('UPDATE auth_keys SET is_active = 0 WHERE id = ?').run(keyData.id);
    return res.json({ success: false, message: 'Key süresi dolmuş' });
  }

  const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE key_id = ? AND is_online = 1').get(keyData.id);
  const maxSessions = parseInt(db.prepare('SELECT value FROM settings WHERE key = ?').get('max_sessions_per_key')?.value || 5);

  if (sessionCount.count >= maxSessions) {
    return res.json({ success: false, message: `Maksimum oturum sayısına ulaşıldı (${maxSessions})` });
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');

  if (!keyData.first_used_at) {
    db.prepare('UPDATE auth_keys SET first_used_at = CURRENT_TIMESTAMP, usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(keyData.id);
  } else {
    db.prepare('UPDATE auth_keys SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(keyData.id);
  }

  db.prepare('INSERT INTO sessions (key_id, ip_address, session_token) VALUES (?, ?, ?)').run(keyData.id, ip, sessionToken);
  db.prepare('INSERT INTO key_usage_log (key_id, key_value, wl_name, action, ip_address) VALUES (?, ?, ?, ?, ?)').run(keyData.id, keyData.key_value, keyData.wl_name, 'LOGIN_SUCCESS', ip);

  logSystem('info', `${keyData.wl_name} giriş yaptı (IP: ${ip})`);

  return res.json({
    success: true,
    message: 'Giriş başarılı',
    wl_name: keyData.wl_name,
    session_token: sessionToken,
    key_id: keyData.id,
    expires_at: keyData.expires_at
  });
});

app.post('/api/auth/logout', (req, res) => {
  const { session_token } = req.body;
  db.prepare('UPDATE sessions SET is_online = 0 WHERE session_token = ?').run(session_token);
  res.json({ success: true });
});

app.post('/api/auth/validate-session', (req, res) => {
  const { session_token } = req.body;
  if (!session_token) return res.json({ valid: false });

  const session = db.prepare('SELECT * FROM sessions WHERE session_token = ? AND is_online = 1').get(session_token);
  if (!session) return res.json({ valid: false });

  updateSessionActivity(session.id);
  const keyData = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(session.key_id);
  return res.json({ valid: true, wl_name: keyData.wl_name, key_id: keyData.id });
});

// ----- DASHBOARD STATS -----
app.get('/api/dashboard/stats', (req, res) => {
  const totalKeys = db.prepare('SELECT COUNT(*) as count FROM auth_keys').get().count;
  const activeKeys = db.prepare('SELECT COUNT(*) as count FROM auth_keys WHERE is_active = 1 AND (expires_at IS NULL OR datetime(expires_at) > datetime(\'now\'))').get().count;
  const onlineNow = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE is_online = 1').get().count;
  const totalLoginsToday = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND date(timestamp) = date('now')").get().count;
  const totalLoginsMonth = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')").get().count;

  const sessionsAuthDuration = db.prepare(`
    SELECT COALESCE(ROUND(AVG(
      (julianday(COALESCE(last_active, 'now')) - julianday(login_at)) * 24
    )), 0) as avg_hours
    FROM sessions WHERE is_online = 1
  `).get();

  res.json({
    totalKeys,
    activeKeys,
    onlineNow,
    totalLoginsToday,
    totalLoginsMonth,
    avgAuthHours: Math.round(sessionsAuthDuration.avg_hours * 10) / 10
  });
});

app.get('/api/dashboard/recent-logins', (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM key_usage_log WHERE action = 'LOGIN_SUCCESS'
    ORDER BY timestamp DESC LIMIT 50
  `).all();
  res.json(logs);
});

app.get('/api/dashboard/daily-stats', (req, res) => {
  const stats = db.prepare(`
    SELECT date(timestamp) as date, COUNT(*) as count
    FROM key_usage_log WHERE action = 'LOGIN_SUCCESS'
    AND date(timestamp) >= date('now', '-30 days')
    GROUP BY date(timestamp) ORDER BY date(timestamp)
  `).all();
  res.json(stats);
});

app.get('/api/dashboard/status-report', (req, res) => {
  const today = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND date(timestamp) = date('now')").get().count;
  const yesterday = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND date(timestamp) = date('now', '-1 day')").get().count;
  const thisMonth = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')").get().count;
  const lastMonth = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action = 'LOGIN_SUCCESS' AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now', '-1 month')").get().count;
  const failedToday = db.prepare("SELECT COUNT(*) as count FROM key_usage_log WHERE action LIKE 'FAILED%' AND date(timestamp) = date('now')").get().count;

  res.json({ today, yesterday, thisMonth, lastMonth, failedToday });
});

// ----- KEY MANAGEMENT -----
app.get('/api/keys/list', (req, res) => {
  const keys = db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM sessions WHERE key_id = a.id AND is_online = 1) as online_sessions
    FROM auth_keys a ORDER BY a.created_at DESC
  `).all();
  res.json(keys);
});

app.post('/api/keys/generate', (req, res) => {
  const { wl_name, duration_minutes } = req.body;
  if (!wl_name) return res.json({ success: false, message: 'WL adı gerekli' });

  const key = generateKey();
  const expiresAt = new Date(Date.now() + (duration_minutes || 30) * 60000).toISOString();

  db.prepare('INSERT INTO auth_keys (key_value, wl_name, duration_minutes, expires_at) VALUES (?, ?, ?, ?)').run(key, wl_name, duration_minutes || 30, expiresAt);
  db.prepare('INSERT INTO key_usage_log (key_value, wl_name, action) VALUES (?, ?, ?)').run(key, wl_name, 'KEY_CREATED');

  logSystem('info', `Yeni key oluşturuldu: ${wl_name} (${duration_minutes || 30}dk)`);
  io.emit('key_created', { key, wl_name, duration_minutes: duration_minutes || 30 });
  res.json({ success: true, key });
});

app.post('/api/keys/bulk-generate', (req, res) => {
  const { wl_name, duration_minutes, count } = req.body;
  if (!wl_name || !count) return res.json({ success: false, message: 'WL adı ve miktar gerekli' });

  const keys = [];
  const insertKey = db.prepare('INSERT INTO auth_keys (key_value, wl_name, duration_minutes, expires_at) VALUES (?, ?, ?, ?)');
  const insertLog = db.prepare('INSERT INTO key_usage_log (key_value, wl_name, action) VALUES (?, ?, ?)');

  const transaction = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const key = generateKey();
      const expiresAt = new Date(Date.now() + (duration_minutes || 30) * 60000).toISOString();
      insertKey.run(key, wl_name, duration_minutes || 30, expiresAt);
      insertLog.run(key, wl_name, 'KEY_CREATED_BULK');
      keys.push(key);
    }
  });
  transaction();

  logSystem('info', `Toplu key oluşturuldu: ${wl_name} x${count}`);
  res.json({ success: true, keys });
});

app.post('/api/keys/ban', (req, res) => {
  const { key_id } = req.body;
  db.prepare('UPDATE auth_keys SET is_banned = 1, is_active = 0 WHERE id = ?').run(key_id);
  db.prepare('UPDATE sessions SET is_online = 0 WHERE key_id = ?').run(key_id);
  const keyData = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(key_id);
  if (keyData) {
    db.prepare('INSERT INTO key_usage_log (key_id, key_value, wl_name, action) VALUES (?, ?, ?, ?)').run(key_id, keyData.key_value, keyData.wl_name, 'KEY_BANNED');
  }
  logAlert('Key Banlandı', `Key #${key_id} banlandı`, 'high');
  res.json({ success: true });
});

app.post('/api/keys/unban', (req, res) => {
  const { key_id } = req.body;
  db.prepare('UPDATE auth_keys SET is_banned = 0 WHERE id = ?').run(key_id);
  const keyData = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(key_id);
  if (keyData) {
    db.prepare('INSERT INTO key_usage_log (key_id, key_value, wl_name, action) VALUES (?, ?, ?, ?)').run(key_id, keyData.key_value, keyData.wl_name, 'KEY_UNBANNED');
  }
  res.json({ success: true });
});

app.post('/api/keys/delete', (req, res) => {
  const { key_id } = req.body;
  const keyData = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(key_id);
  if (keyData) {
    db.prepare('DELETE FROM sessions WHERE key_id = ?').run(key_id);
    db.prepare('DELETE FROM auth_keys WHERE id = ?').run(key_id);
    db.prepare('INSERT INTO key_usage_log (key_value, wl_name, action) VALUES (?, ?, ?)').run(keyData.key_value, keyData.wl_name, 'KEY_DELETED');
  }
  logSystem('warning', `Key silindi: #${key_id}`);
  res.json({ success: true });
});

app.post('/api/keys/extend', (req, res) => {
  const { key_id, additional_minutes } = req.body;
  const keyData = db.prepare('SELECT * FROM auth_keys WHERE id = ?').get(key_id);
  if (!keyData) return res.json({ success: false, message: 'Key bulunamadı' });

  const currentExpiry = keyData.expires_at ? new Date(keyData.expires_at) : new Date();
  if (currentExpiry < new Date()) currentExpiry.setTime(Date.now());
  const newExpiry = new Date(currentExpiry.getTime() + additional_minutes * 60000).toISOString();

  db.prepare('UPDATE auth_keys SET expires_at = ?, is_active = 1 WHERE id = ?').run(newExpiry, key_id);
  db.prepare('INSERT INTO key_usage_log (key_id, key_value, wl_name, action) VALUES (?, ?, ?, ?)').run(key_id, keyData.key_value, keyData.wl_name, `KEY_EXTENDED_${additional_minutes}MIN`);
  res.json({ success: true, new_expires_at: newExpiry });
});

app.post('/api/keys/reset-hwid', (req, res) => {
  const { key_id } = req.body;
  db.prepare('UPDATE auth_keys SET hwid = NULL WHERE id = ?').run(key_id);
  res.json({ success: true });
});

// ----- SESSIONS -----
app.get('/api/sessions/active', (req, res) => {
  const sessions = db.prepare(`
    SELECT s.*, a.key_value, a.wl_name
    FROM sessions s JOIN auth_keys a ON s.key_id = a.id
    WHERE s.is_online = 1 ORDER BY s.login_at DESC
  `).all();
  res.json(sessions);
});

app.post('/api/sessions/kill', (req, res) => {
  const { session_id } = req.body;
  db.prepare('UPDATE sessions SET is_online = 0 WHERE id = ?').run(session_id);
  res.json({ success: true });
});

app.post('/api/sessions/kill-all', (req, res) => {
  db.prepare('UPDATE sessions SET is_online = 0').run();
  logSystem('warning', 'Tüm oturumlar sonlandırıldı');
  res.json({ success: true });
});

// ----- ALERTS -----
app.get('/api/alerts/list', (req, res) => {
  const alerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100').all();
  res.json(alerts);
});

app.post('/api/alerts/mark-read', (req, res) => {
  const { alert_id } = req.body;
  db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(alert_id);
  res.json({ success: true });
});

app.post('/api/alerts/mark-all-read', (req, res) => {
  db.prepare('UPDATE alerts SET is_read = 1').run();
  res.json({ success: true });
});

// ----- SYSTEM LOGS -----
app.get('/api/logs/list', (req, res) => {
  const logs = db.prepare('SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT 200').all();
  res.json(logs);
});

app.post('/api/logs/clear', (req, res) => {
  db.prepare('DELETE FROM system_logs').run();
  res.json({ success: true });
});

// ----- IP MANAGEMENT -----
app.get('/api/ips/banned', (req, res) => {
  const ips = db.prepare('SELECT * FROM banned_ips ORDER BY created_at DESC').all();
  res.json(ips);
});

app.post('/api/ips/ban', (req, res) => {
  const { ip, reason } = req.body;
  db.prepare('INSERT OR REPLACE INTO banned_ips (ip_address, reason) VALUES (?, ?)').run(ip, reason);
  db.prepare('UPDATE sessions SET is_online = 0 WHERE ip_address = ?').run(ip);
  logAlert('IP Banlandı', `${ip} banlandı: ${reason}`, 'high');
  res.json({ success: true });
});

app.post('/api/ips/unban', (req, res) => {
  const { ip } = req.body;
  db.prepare('DELETE FROM banned_ips WHERE ip_address = ?').run(ip);
  res.json({ success: true });
});

app.get('/api/ips/whitelist', (req, res) => {
  const ips = db.prepare('SELECT * FROM whitelist_ips ORDER BY created_at DESC').all();
  res.json(ips);
});

app.post('/api/ips/whitelist-add', (req, res) => {
  const { ip, description } = req.body;
  db.prepare('INSERT OR REPLACE INTO whitelist_ips (ip_address, description) VALUES (?, ?)').run(ip, description);
  logSystem('info', `WL IP eklendi: ${ip}`);
  res.json({ success: true });
});

app.post('/api/ips/whitelist-remove', (req, res) => {
  const { ip } = req.body;
  db.prepare('DELETE FROM whitelist_ips WHERE ip_address = ?').run(ip);
  res.json({ success: true });
});

// ----- PANIC -----
app.post('/api/panic/enable', (req, res) => {
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1', 'panic_mode');
  db.prepare('UPDATE sessions SET is_online = 0').run();
  db.prepare('INSERT INTO panic_log (triggered_by, reason) VALUES (?, ?)').run('admin', 'Manual panic triggered');
  logAlert('PANIC MODE AKTIF', 'Sistem panic moduna alındı! Tüm oturumlar kapatıldı.', 'critical');
  io.emit('panic_activated');
  res.json({ success: true });
});

app.post('/api/panic/disable', (req, res) => {
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('0', 'panic_mode');
  logSystem('info', 'Panic mode deaktive edildi');
  io.emit('panic_deactivated');
  res.json({ success: true });
});

app.get('/api/panic/status', (req, res) => {
  const status = db.prepare('SELECT value FROM settings WHERE key = ?').get('panic_mode');
  res.json({ panic_mode: status?.value === '1' });
});

// ----- WHITELIST MANAGEMENT -----
app.get('/api/whitelist/list', (req, res) => {
  const wl = db.prepare('SELECT * FROM whitelist ORDER BY created_at DESC').all();
  res.json(wl);
});

app.post('/api/whitelist/add', (req, res) => {
  const { name, discord_id } = req.body;
  if (!name || !discord_id) return res.json({ success: false, message: 'İsim ve Discord ID gerekli' });
  db.prepare('INSERT OR REPLACE INTO whitelist (name, discord_id, added_by) VALUES (?, ?, ?)').run(name, discord_id, 'admin');
  logSystem('info', `Whitelist eklendi: ${name} (${discord_id})`);
  res.json({ success: true });
});

app.post('/api/whitelist/remove', (req, res) => {
  const { discord_id } = req.body;
  db.prepare('DELETE FROM whitelist WHERE discord_id = ?').run(discord_id);
  res.json({ success: true });
});

// ----- MY IP -----
app.get('/api/myip', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '').replace('::1', '127.0.0.1');
  res.json({ ip });
});

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '').replace('::1', '127.0.0.1');
  db.prepare('INSERT INTO visitors (ip_address, user_agent, url_attempted) VALUES (?, ?, ?)').run(
    ip,
    req.headers['user-agent'] || '',
    req.originalUrl
  );
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  socket.on('heartbeat', (data) => {
    if (data && data.session_token) {
      updateSessionActivity(
        db.prepare('SELECT id FROM sessions WHERE session_token = ? AND is_online = 1').get(data.session_token)?.id
      );
    }
  });
});

// ==================== STARTUP ====================
const PORT = process.env.PORT || require('./config.json').site_port || 3000;
server.listen(PORT, () => {
  const myIp = require('os').networkInterfaces();
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║    NOVEX AUTH SYSTEM v1.0           ║`);
  console.log(`  ║    http://localhost:${PORT}            ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);

  logSystem('info', 'Novex Auth sistemi başlatıldı');
});
