'use strict';
/*
 * Together — совместный просмотр фильмов с чатом.
 * Работает без сторонних библиотек: нужен только Node.js 18 или новее.
 * Запуск: двойной клик по start.bat (или команда `node server.js`).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG_PATH = process.env.TOGETHER_CONFIG ? path.resolve(process.env.TOGETHER_CONFIG) : path.join(ROOT, 'config.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

const VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};
const SUB_EXTS = new Set(['.srt', '.vtt']);
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const REACTIONS = ['😂', '😱', '❤️', '🔥', '👍', '😭'];
const MAX_CHAT = 300;
const LEAVE_GRACE_MS = 8000;      // сколько ждём переподключения, прежде чем считать, что человек ушёл
const STALE_CLIENT_MS = 120000;   // клиент молчит дольше — считаем отключённым (фоновые вкладки шлют сигналы реже)
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// ------------------------------------------------------------------ настройки

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return s.slice(0, 5) + '-' + s.slice(5);
}

function loadConfig() {
  let cfg = {};
  const exists = fs.existsSync(CONFIG_PATH);
  if (exists) {
    try {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      console.error('\n  Не получилось прочитать config.json: ' + e.message);
      console.error('  Исправь файл или удали его — он создастся заново.\n');
      process.exit(1);
    }
  }
  const defaults = { port: 8765, password: '', moviesDir: 'movies', openBrowser: true };
  let changed = !exists;
  for (const k of Object.keys(defaults)) {
    if (cfg[k] === undefined) { cfg[k] = defaults[k]; changed = true; }
  }
  if (!cfg.password || !String(cfg.password).trim()) { cfg.password = randomPassword(); changed = true; }
  if (!cfg.secret) { cfg.secret = crypto.randomBytes(24).toString('hex'); changed = true; }
  if (changed) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n'); }
    catch (e) { console.warn('  Не удалось сохранить config.json: ' + e.message); }
  }
  return cfg;
}

const cfg = loadConfig();
const PORT = Number(process.env.PORT) || Number(cfg.port) || 8765;
const MOVIES_DIR = path.resolve(ROOT, String(cfg.moviesDir || 'movies'));
const normPass = (s) => String(s == null ? '' : s).trim().toLowerCase();
const TOKEN = crypto.createHmac('sha256', String(cfg.secret)).update('room:' + normPass(cfg.password)).digest('hex').slice(0, 48);

try { fs.mkdirSync(MOVIES_DIR, { recursive: true }); } catch (e) { console.warn('  Папка с фильмами недоступна: ' + MOVIES_DIR); }
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }

// ------------------------------------------------------------------ утилиты

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  }, SEC_HEADERS, extraHeaders || {}));
  res.end(body);
}

function notFound(res) {
  if (res.headersSent) return res.end();
  res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SEC_HEADERS));
  res.end('Not found');
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

function isAuthed(req, url) {
  // Подходит любой из способов: заголовок, параметр в ссылке или cookie
  const candidates = [req.headers['x-token'], url.searchParams.get('t'), parseCookies(req.headers.cookie).tg];
  return candidates.some((t) => !!t && safeEqual(t, TOKEN));
}

function cleanName(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function cleanText(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

/** Абсолютный путь к файлу внутри baseDir или null, если путь пытается выйти наружу. */
function resolveInside(baseDir, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const full = path.resolve(baseDir, rel);
  const base = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (!full.startsWith(base)) return null;
  return full;
}

function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ------------------------------------------------------------------ субтитры

function decodeTextBuffer(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch {
    // Русские .srt часто в кодировке Windows-1251
    try { return new TextDecoder('windows-1251').decode(buf); } catch { return buf.toString('latin1'); }
  }
}

function srtToVtt(text) {
  let t = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(t)) return t.trim() + '\n';
  t = t.replace(/(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/g,
    (_, h, m, s, ms) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}.${ms.padEnd(3, '0')}`);
  t = t.replace(/\{\\[^}]*\}/g, ''); // теги вида {\an8}
  return 'WEBVTT\n\n' + t.trim() + '\n';
}

// ------------------------------------------------------------------ библиотека фильмов

function subLabel(base, fileName) {
  const ext = path.extname(fileName);
  const middle = fileName.slice(base.length, fileName.length - ext.length).replace(/^[.\s_-]+/, '');
  return middle ? middle.toUpperCase() : 'Субтитры';
}

function scanLibrary() {
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const subsHere = entries.filter((e) => e.isFile() && SUB_EXTS.has(path.extname(e.name).toLowerCase())).map((e) => e.name);
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (depth < 3) walk(full, r, depth + 1); continue; }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!VIDEO_TYPES[ext]) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      const base = e.name.slice(0, e.name.length - ext.length);
      const subs = subsHere
        .filter((n) => n.toLowerCase().startsWith(base.toLowerCase() + '.'))
        .map((n) => ({ id: (rel ? rel + '/' : '') + n, label: subLabel(base, n) }));
      out.push({ id: r, name: base, ext: ext.slice(1), size: st.size, subs });
    }
  };
  walk(MOVIES_DIR, '', 0);
  out.sort((a, b) => a.id.localeCompare(b.id, 'ru', { numeric: true }));
  return out;
}

function movieInfo(m) {
  return { id: m.id, name: m.name, ext: m.ext, size: m.size, subs: m.subs };
}

// ------------------------------------------------------------------ состояние комнаты

const room = {
  mode: 'stream',      // 'stream' — фильм идёт с этого компьютера, 'local' — у каждого свой файл
  movie: null,         // для режима stream
  playing: false,
  position: 0,         // секунды на момент updatedAt
  updatedAt: Date.now(),
  rate: 1,
  autoPaused: false,   // пауза из-за того, что у кого-то подгружается видео
  waitingFor: [],      // cid тех, кого ждём
  version: 0,
};

const clients = new Map(); // cid -> { cid, uid, name, res, status, lastSeen, ip }
const chat = [];
let msgSeq = 0;

function expectedPosition() {
  return room.playing ? room.position + ((Date.now() - room.updatedAt) / 1000) * room.rate : room.position;
}

function setPosition(pos, playing) {
  room.position = Math.max(0, Number(pos) || 0);
  room.playing = !!playing;
  room.updatedAt = Date.now();
}

function publicState(extra) {
  return Object.assign({
    mode: room.mode,
    movie: room.movie,
    playing: room.playing,
    position: room.position,
    updatedAt: room.updatedAt,
    rate: room.rate,
    autoPaused: room.autoPaused,
    waitingFor: room.waitingFor.map((cid) => ({ cid, name: clients.has(cid) ? clients.get(cid).name : '…' })),
    version: room.version,
    serverNow: Date.now(),
  }, extra || {});
}

function presenceList() {
  return [...clients.values()].map((c) => Object.assign({ cid: c.cid, uid: c.uid, name: c.name }, c.status));
}

function sendEvent(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* закроется само */ }
}

function broadcast(event, data) {
  for (const c of clients.values()) sendEvent(c, event, data);
}

function broadcastPresence() { broadcast('presence', presenceList()); }

function commitState(by, action) {
  room.version++;
  broadcast('state', publicState({ by: by ? by.name : null, byUid: by ? by.uid : null, action: action || null }));
  saveSoon();
}

function pushMsg(m) {
  m.id = Date.now().toString(36) + '-' + (++msgSeq);
  m.ts = Date.now();
  chat.push(m);
  if (chat.length > MAX_CHAT) chat.splice(0, chat.length - MAX_CHAT);
  broadcast('chat', m);
  saveSoon();
}

/** Системное сообщение. Повторяющиеся (например, несколько перемоток подряд) склеиваются. */
function sysMsg(text, by, tag) {
  const last = chat[chat.length - 1];
  if (tag && by && last && last.kind === 'system' && last.tag === tag && last.uid === by.uid && Date.now() - last.ts < 5000) {
    last.text = text;
    last.ts = Date.now();
    broadcast('chat', last);
    saveSoon();
    return;
  }
  pushMsg({ kind: 'system', text, uid: by ? by.uid : null, from: by ? by.name : null, tag: tag || null });
}

// ------------------------------------------------------------------ сохранение чата и позиции

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 1500);
}
function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const data = {
    chat,
    room: { mode: room.mode, movieId: room.movie ? room.movie.id : null, position: expectedPosition() },
  };
  try {
    fs.writeFileSync(STATE_PATH + '.tmp', JSON.stringify(data));
    fs.renameSync(STATE_PATH + '.tmp', STATE_PATH);
  } catch { /* не критично */ }
}
function loadState() {
  let d;
  try { d = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return; }
  if (Array.isArray(d.chat)) {
    for (const m of d.chat.slice(-MAX_CHAT)) {
      if (m && typeof m.text === 'string' && typeof m.id === 'string') chat.push(m);
    }
  }
  if (d.room) {
    if (d.room.mode === 'stream' || d.room.mode === 'local') room.mode = d.room.mode;
    if (d.room.movieId) {
      const m = scanLibrary().find((x) => x.id === d.room.movieId);
      if (m) room.movie = movieInfo(m);
    }
    if (Number.isFinite(d.room.position)) room.position = Math.max(0, d.room.position);
  }
}

// ------------------------------------------------------------------ действия участников

const num = (v, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < max ? n : null;
};

function handleAction(client, body) {
  const type = String(body.type || '');
  switch (type) {
    case 'play': {
      const p = num(body.position);
      setPosition(p == null ? expectedPosition() : p, true);
      room.autoPaused = false; room.waitingFor = [];
      sysMsg(`${client.name} · ▶ ${fmtTime(room.position)}`, client);
      commitState(client, 'play');
      return true;
    }
    case 'pause': {
      const p = num(body.position);
      setPosition(p == null ? expectedPosition() : p, false);
      room.autoPaused = false; room.waitingFor = [];
      sysMsg(`${client.name} · пауза на ${fmtTime(room.position)}`, client);
      commitState(client, 'pause');
      return true;
    }
    case 'seek': {
      const p = num(body.position);
      if (p == null) return false;
      const keepPlaying = room.playing || room.autoPaused;
      setPosition(p, keepPlaying);
      room.autoPaused = false; room.waitingFor = [];
      sysMsg(`${client.name} · перемотка на ${fmtTime(p)}`, client, 'seek');
      commitState(client, 'seek');
      return true;
    }
    case 'buffering': {
      // У участника кончился буфер — ставим всех на паузу и ждём его
      const p = num(body.position);
      if (room.playing) {
        const exp = expectedPosition();
        const pos = p != null && Math.abs(p - exp) < 30 ? p : exp;
        setPosition(pos, false);
        room.autoPaused = true;
        room.waitingFor = [client.cid];
        commitState(client, 'buffering');
      } else if (room.autoPaused && !room.waitingFor.includes(client.cid)) {
        room.waitingFor.push(client.cid);
        commitState(client, 'buffering');
      }
      return true;
    }
    case 'buffered': {
      const i = room.waitingFor.indexOf(client.cid);
      if (i === -1) return true;
      room.waitingFor.splice(i, 1);
      if (room.autoPaused && room.waitingFor.length === 0) {
        room.autoPaused = false;
        setPosition(room.position, true);
        commitState(client, 'resume');
      } else {
        commitState(client, 'buffered');
      }
      return true;
    }
    case 'chat': {
      const text = cleanText(body.text, 1000);
      if (!text) return false;
      pushMsg({ kind: 'user', from: client.name, uid: client.uid, text });
      return true;
    }
    case 'react': {
      const emoji = String(body.emoji || '');
      if (!REACTIONS.includes(emoji)) return false;
      const now = Date.now();
      if (client.lastReact && now - client.lastReact < 150) return true;
      client.lastReact = now;
      broadcast('react', { emoji, from: client.name, uid: client.uid });
      return true;
    }
    case 'setMode': {
      const mode = body.mode === 'local' ? 'local' : body.mode === 'stream' ? 'stream' : null;
      if (!mode || mode === room.mode) return true;
      room.mode = mode;
      room.autoPaused = false; room.waitingFor = [];
      setPosition(expectedPosition(), false);
      sysMsg(mode === 'local'
        ? `${client.name} · режим «Свой файл у каждого»`
        : `${client.name} · режим «Стрим с компьютера»`, client);
      commitState(client, 'mode');
      return true;
    }
    case 'setMovie': {
      const m = scanLibrary().find((x) => x.id === body.id);
      if (!m) return false;
      const same = room.movie && room.movie.id === m.id;
      room.movie = movieInfo(m);
      const modeChanged = room.mode !== 'stream';
      room.mode = 'stream';
      room.autoPaused = false; room.waitingFor = [];
      if (!same) {
        setPosition(0, false);
        sysMsg(`${client.name} · фильм «${m.name}»`, client);
      } else if (modeChanged) {
        setPosition(expectedPosition(), false);
      }
      commitState(client, 'movie');
      return true;
    }
    case 'status': {
      const s = body.status && typeof body.status === 'object' ? body.status : {};
      const f = s.file && typeof s.file === 'object' ? {
        name: cleanText(s.file.name, 200),
        size: num(s.file.size, 1e15),
        duration: num(s.file.duration),
      } : null;
      const next = { file: f, buffering: !!s.buffering, needsTap: !!s.needsTap, mobile: !!s.mobile };
      const changed = JSON.stringify(next) !== JSON.stringify(client.status);
      client.status = next;
      if (changed) broadcastPresence();
      return true;
    }
    default:
      return false;
  }
}

// ------------------------------------------------------------------ подключение / отключение

const lastSeenUid = new Map(); // uid -> время последнего отключения

function handleEvents(req, res, url) {
  const cid = String(url.searchParams.get('cid') || '');
  const uid = String(url.searchParams.get('uid') || '');
  const name = cleanName(url.searchParams.get('name'));
  if (!/^[a-z0-9]{6,40}$/i.test(cid) || !/^[a-z0-9]{6,40}$/i.test(uid) || !name) {
    return sendJson(res, 400, { error: 'bad_request' });
  }

  res.writeHead(200, Object.assign({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  }, SEC_HEADERS));
  res.write('retry: 2000\n\n');
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true, 15000);

  const prev = clients.get(cid);
  if (prev && prev.res !== res) { try { prev.res.end(); } catch { /* ignore */ } }
  const wasHere = [...clients.values()].some((c) => c.uid === uid)
    || (lastSeenUid.has(uid) && Date.now() - lastSeenUid.get(uid) < LEAVE_GRACE_MS + 2000);

  const client = {
    cid, uid, name, res,
    status: prev ? prev.status : { file: null, buffering: false, needsTap: false, mobile: false },
    lastSeen: Date.now(),
    ip: req.socket.remoteAddress,
  };
  clients.set(cid, client);

  sendEvent(client, 'init', {
    you: { cid, uid },
    state: publicState(),
    presence: presenceList(),
    chat,
    reactions: REACTIONS,
  });
  if (!wasHere) {
    log(`${name} подключается (${String(client.ip || '').replace('::ffff:', '')})`);
    sysMsg(`${name} в комнате`);
  }
  broadcastPresence();

  res.on('close', () => {
    if (clients.get(cid) !== client) return;
    clients.delete(cid);
    lastSeenUid.set(uid, Date.now());
    onClientGone(client);
  });
}

function onClientGone(c) {
  broadcastPresence();
  const i = room.waitingFor.indexOf(c.cid);
  if (i !== -1) {
    room.waitingFor.splice(i, 1);
    if (room.autoPaused && room.waitingFor.length === 0) room.autoPaused = false; // остаёмся на паузе
    commitState(null, 'waiting');
  }
  setTimeout(() => {
    const back = [...clients.values()].some((x) => x.uid === c.uid);
    if (back) return;
    log(`${c.name} отключается`);
    if (room.playing) {
      setPosition(expectedPosition(), false);
      sysMsg(`${c.name} — не в сети, поставили на паузу`);
      commitState(null, 'leave');
    } else {
      sysMsg(`${c.name} — не в сети`);
    }
  }, LEAVE_GRACE_MS);
}

// Пинг, чтобы соединения не засыпали, и уборка «зависших» клиентов
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) {
    if (now - c.lastSeen > STALE_CLIENT_MS) { try { c.res.destroy(); } catch { /* ignore */ } continue; }
    try { c.res.write(': ping\n\n'); } catch { /* ignore */ }
  }
}, 15000).unref();

setInterval(() => { if (room.playing) saveSoon(); }, 15000).unref();

// ------------------------------------------------------------------ раздача файлов

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  try { rel = decodeURIComponent(rel); } catch { return notFound(res); }
  const file = resolveInside(PUBLIC_DIR, rel);
  if (!file) return notFound(res);
  const type = STATIC_TYPES[path.extname(file).toLowerCase()];
  if (!type) return notFound(res);
  fs.readFile(file, (err, buf) => {
    if (err) return notFound(res);
    const headers = Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': buf.length }, SEC_HEADERS);
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function serveMedia(req, res, id, download) {
  const file = resolveInside(MOVIES_DIR, id);
  const ext = file ? path.extname(file).toLowerCase() : '';
  if (!file || !VIDEO_TYPES[ext]) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const size = st.size;
    const headers = Object.assign({
      'Content-Type': VIDEO_TYPES[ext],
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }, SEC_HEADERS);
    if (download) headers['Content-Disposition'] = contentDisposition(path.basename(file));

    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = req.headers.range;
    if (range && size > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).split(',')[0].trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      if (m[1] === '') {
        start = Math.max(0, size - parseInt(m[2], 10));
      } else {
        start = parseInt(m[1], 10);
        if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1);
      }
      if (!(start <= end) || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || size === 0) return res.end();

    const stream = fs.createReadStream(file, { start, end, highWaterMark: 256 * 1024 });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

function serveSubs(req, res, id) {
  const file = resolveInside(MOVIES_DIR, id);
  const ext = file ? path.extname(file).toLowerCase() : '';
  if (!file || !SUB_EXTS.has(ext)) return notFound(res);
  fs.readFile(file, (err, buf) => {
    if (err || buf.length > 10 * 1024 * 1024) return notFound(res);
    const vtt = srtToVtt(decodeTextBuffer(buf));
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-cache' }, SEC_HEADERS));
    res.end(vtt);
  });
}

// ------------------------------------------------------------------ HTTP

const loginAttempts = new Map(); // ip -> { n, until }

async function handleLogin(req, res) {
  const ip = req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'; // сам хозяин не блокируется
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (rec && now > rec.until) { loginAttempts.delete(ip); rec = null; }
  if (rec && rec.n >= 10 && !isLocal) return sendJson(res, 429, { error: 'too_many' });
  let body;
  try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'bad_request' }); }
  if (safeEqual(normPass(body.password), normPass(cfg.password))) {
    loginAttempts.delete(ip);
    return sendJson(res, 200, { token: TOKEN }, {
      'Set-Cookie': `tg=${TOKEN}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
    });
  }
  if (!rec) { rec = { n: 0, until: now + 15 * 60 * 1000 }; loginAttempts.set(ip, rec); }
  rec.n++;
  log(`Неверный пароль с адреса ${ip.replace('::ffff:', '')}`);
  return sendJson(res, 401, { error: 'bad_password' });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/time') return sendJson(res, 200, { now: Date.now() });
  if (p === '/api/login' && method === 'POST') return handleLogin(req, res);

  if (p.startsWith('/api/') || p.startsWith('/media/') || p.startsWith('/subs/')) {
    if (!isAuthed(req, url)) return sendJson(res, 401, { error: 'unauthorized' });

    if (p === '/api/session') return sendJson(res, 200, { token: TOKEN });
    if (p === '/api/events' && method === 'GET') return handleEvents(req, res, url);
    if (p === '/api/movies' && method === 'GET') {
      return sendJson(res, 200, { dir: MOVIES_DIR, movies: scanLibrary() });
    }
    if (p === '/api/action' && method === 'POST') {
      let body;
      try { body = await readJson(req); } catch { return sendJson(res, 400, { error: 'bad_request' }); }
      const client = clients.get(String(body.cid || ''));
      if (!client) return sendJson(res, 409, { error: 'not_connected' });
      client.lastSeen = Date.now();
      const ok = handleAction(client, body);
      return sendJson(res, ok ? 200 : 400, ok ? { ok: true } : { error: 'bad_action' });
    }
    if ((p.startsWith('/media/') || p.startsWith('/subs/')) && (method === 'GET' || method === 'HEAD')) {
      let id;
      try { id = decodeURIComponent(p.slice(p.indexOf('/', 1) + 1)); } catch { return notFound(res); }
      if (p.startsWith('/media/')) return serveMedia(req, res, id, url.searchParams.get('dl') === '1');
      return serveSubs(req, res, id);
    }
    return notFound(res);
  }

  if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, p);
  return notFound(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    else res.destroy();
  });
});

function log(msg) {
  const d = new Date();
  const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  console.log(`  [${t}] ${msg}`);
}

function listAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (!v4 || a.internal || a.address.startsWith('169.254.')) continue;
      const [x, y] = a.address.split('.').map(Number);
      const tailscale = /tailscale/i.test(name) || (x === 100 && y >= 64 && y <= 127);
      const virtual = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|Loopback/i.test(name);
      out.push({ name, address: a.address, tailscale, virtual });
    }
  }
  // Виртуальные адаптеры (WSL, эмуляторы, виртуалки) другу не помогут — прячем, если есть что-то ещё
  const real = out.filter((a) => !a.virtual || a.tailscale);
  return real.length ? real : out;
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Порт ${PORT} уже занят. Возможно, сервер уже запущен в другом окне.`);
    console.error('  Закрой его или поменяй "port" в config.json.\n');
  } else {
    console.error('\n  Ошибка сервера: ' + e.message + '\n');
  }
  process.exit(1);
});

loadState();

// Без указания адреса Node слушает и IPv4, и IPv6
server.listen(PORT, () => {
  const addrs = listAddresses();
  const ts = addrs.filter((a) => a.tailscale);
  const lan = addrs.filter((a) => !a.tailscale);
  const movies = scanLibrary().length;
  const link = (host) => `http://${host}:${PORT}`;
  const key = encodeURIComponent(cfg.password);
  const L = [];
  L.push('');
  L.push('  ============================================================');
  L.push('    Together запущен');
  L.push('  ============================================================');
  L.push(`    Пароль комнаты:   ${cfg.password}`);
  L.push('');
  L.push(`    У себя:           ${link('localhost')}`);
  ts.forEach((a) => L.push(`    Через Tailscale:  ${link(a.address)}`));
  lan.forEach((a) => L.push(`    Домашняя сеть:    ${link(a.address)}   (${a.name})`));
  L.push('');
  if (ts.length) {
    L.push('    Ссылка для друга (пароль уже внутри, отправь её в мессенджере):');
    L.push(`    ${link(ts[0].address)}/?k=${key}`);
  } else {
    L.push('    Tailscale не найден. Как подключить друга через интернет — см. README.md.');
    L.push('    Если на роутере проброшен порт, ссылка для друга такая:');
    L.push(`    http://ТВОЙ-ВНЕШНИЙ-IP:${PORT}/?k=${key}`);
  }
  L.push('');
  L.push(`    Фильмы для режима «С компьютера»: ${MOVIES_DIR}  (найдено: ${movies})`);
  L.push('    Остановить: закрой это окно или нажми Ctrl+C');
  L.push('  ============================================================');
  L.push('');
  console.log(L.join('\n'));

  if (process.platform === 'win32' && cfg.openBrowser !== false && !process.env.TOGETHER_NO_BROWSER) {
    // Открываем сайт у себя сразу с паролем (только если в пароле нет символов, опасных для командной строки)
    const q = /^[\w-]+$/.test(String(cfg.password)) ? `/?k=${key}` : '/';
    exec(`start "" "http://localhost:${PORT}${q}"`, () => {});
  }
});

function shutdown() {
  saveNow();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
