'use strict';
/*
 * Together — клиентская часть.
 * Сервер хранит «эталонное» состояние комнаты (играет/пауза, позиция, время изменения),
 * а каждый браузер подгоняет свой плеер под него: жёсткой перемоткой при большом
 * расхождении и лёгким ускорением/замедлением при маленьком.
 */
(function () {
  // ================================================================ утилиты
  const $ = (s) => document.querySelector(s);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  const sess = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  function rid(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    let s = '';
    for (let i = 0; i < n; i++) s += (a[i] % 36).toString(36);
    return s;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function hhmm(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtSize(b) {
    if (b == null || !isFinite(b)) return '';
    const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i >= 2 ? b.toFixed(1) : Math.round(b)) + ' ' + u[i];
  }
  function nameColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return 'hsl(' + (h % 360) + ', 78%, 70%)';
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Иконки — Material Design Icons (Apache License 2.0)
  const ICONS = {
    play: '<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/>',
    pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
    back10: '<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="16.3" text-anchor="middle" font-size="7.2" font-weight="700" font-family="system-ui,sans-serif">10</text>',
    fwd10: '<path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="16.3" text-anchor="middle" font-size="7.2" font-weight="700" font-family="system-ui,sans-serif">10</text>',
    vol: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>',
    volOff: '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>',
    fs: '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>',
    fsExit: '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>',
    chat: '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>',
    cc: '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>',
    send: '<path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/>',
    movie: '<path d="m18 4 2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>',
    folder: '<path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>',
    download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
    close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
    refresh: '<path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
  };
  const svgIcon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  const setIcon = (node, name) => { if (node.dataset.cur !== name) { node.innerHTML = svgIcon(name); node.dataset.cur = name; } };
  function fillIcons(root) {
    root.querySelectorAll('[data-icon]').forEach((n) => n.insertAdjacentHTML('afterbegin', svgIcon(n.dataset.icon)));
  }

  // ================================================================ окружение
  const UA = navigator.userAgent;
  const IS_IOS = /iP(hone|od|ad)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_IPHONE = /iP(hone|od)/.test(UA);
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  const VOLUME_OK = (() => {
    try { const v = document.createElement('video'); v.volume = 0.5; return v.volume === 0.5; } catch (e) { return false; }
  })();
  const PHONE_LANDSCAPE = window.matchMedia('(orientation: landscape) and (max-height: 500px)');

  // Пороги синхронизации (секунды)
  const HARD_SYNC = 1.0;    // при смене состояния: дальше — перематываем
  const DRIFT_HARD = 1.2;   // во время просмотра: дальше — перематываем
  const SOFT_START = 0.18;  // дальше — чуть ускоряем/замедляем
  const SOFT_STOP = 0.05;   // ближе — возвращаем нормальную скорость
  const STALL_MS = 1600;    // столько стоим на месте во время игры — значит, кончился буфер

  // ================================================================ элементы
  const video = $('#video');
  const E = {};
  ['login', 'loginForm', 'nameInput', 'passInput', 'passLabel', 'loginError', 'app', 'layout', 'stage', 'people', 'conn',
    'empty', 'emptyTitle', 'emptyText', 'emptyBtn', 'wait', 'waitText', 'waitSkip', 'offline', 'reactLayer', 'toasts', 'flash',
    'tapjoin', 'tapjoinBtn', 'controls', 'scrub', 'scrubBuf', 'scrubProg', 'scrubKnob', 'scrubTip', 'playBtn', 'backBtn',
    'fwdBtn', 'time', 'muteBtn', 'vol', 'ccBtn', 'chatBtn', 'chatBadge', 'fsBtn', 'srcTitle', 'srcMeta', 'srcPeers',
    'pickMovieBtn', 'pickFileBtn', 'pickSubsBtn', 'chat', 'chatClose', 'messages', 'reactBar', 'chatForm', 'chatInput',
    'picker', 'pickerList', 'pickerFoot', 'pickerRefresh', 'pickerClose', 'fileInput', 'subsInput',
  ].forEach((id) => { E[id] = document.getElementById(id); });
  E.modeBtns = document.querySelectorAll('[data-mode]');

  // ================================================================ состояние клиента
  const S = {
    token: store.get('tg_token') || '',
    authed: false,
    name: store.get('tg_name') || '',
    uid: store.get('tg_uid') || '',
    cid: sess.get('tg_cid') || '',
    started: false,
    es: null,
    ready: false,
    room: null,
    presence: [],
    reactions: ['😂', '😱', '❤️', '🔥', '👍', '😭'],
    offset: 0,
    rtt: null,
    syncing: false,
    sourceKey: null,
    subsKey: null,
    subsIndex: -1,
    preferSubs: null,
    localFile: null,
    localSubs: null,
    mediaError: null,
    needsGesture: false,
    primed: false,
    unlocking: false,
    playPending: false,
    playPendingAt: 0,
    quietUntil: 0,
    quietPlayUntil: 0,
    quietPauseUntil: 0,
    holdSyncUntil: 0,
    seekIssuedAt: 0,
    seekCost: 0.15,       // сколько секунд обычно занимает перемотка (подстраивается само)
    lastHardSeekAt: 0,
    dragging: false,
    dragTime: 0,
    stallStart: 0,
    bufferingReported: false,
    bufferingSince: 0,
    lastBufferedAt: 0,
    bufferWaits: 0,       // сколько раз за фильм уже ждали подгрузку
    waitAhead: 0,
    waitProgressAt: 0,
    lastStruggleAt: 0,
    win: null,
    lastCT: 0,
    pseudoFs: false,
    chatOpen: null,
    unread: 0,
    lastStatusKey: '',
    lastStatusAt: 0,
    loginErrorText: '',
  };
  if (!/^[a-z0-9]{16}$/.test(S.uid)) { S.uid = rid(16); store.set('tg_uid', S.uid); }
  if (!/^[a-z0-9]{16}$/.test(S.cid)) { S.cid = rid(16); sess.set('tg_cid', S.cid); }

  // ================================================================ связь с сервером
  async function api(path, body) {
    const opts = { method: body ? 'POST' : 'GET', headers: {}, cache: 'no-store', credentials: 'same-origin' };
    if (S.token) opts.headers['X-Token'] = S.token;
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function act(type, extra) {
    if (!S.ready) {
      if (type !== 'status') flash('Нет связи с сервером');
      return Promise.resolve(null);
    }
    return api('/api/action', Object.assign({ cid: S.cid, type }, extra || {})).catch((err) => {
      if (err.status === 401) logout();
      else if (err.status === 409) connect();
      return null;
    });
  }

  function connect() {
    if (S.es) { S.es.close(); S.es = null; }
    S.ready = false;
    const q = new URLSearchParams({ t: S.token, cid: S.cid, uid: S.uid, name: S.name });
    const es = new EventSource('/api/events?' + q.toString());
    S.es = es;
    const on = (ev, fn) => es.addEventListener(ev, (e) => {
      if (S.es !== es) return;
      let d;
      try { d = JSON.parse(e.data); } catch (err) { return; }
      fn(d);
    });
    on('init', onInit);
    on('state', onState);
    on('presence', (p) => { S.presence = p; renderPeople(); renderSource(); });
    on('chat', (m) => addMsg(m, true));
    on('react', (r) => spawnReaction(r.emoji, r.uid === S.uid ? null : r.from));
    es.onerror = () => {
      if (S.es !== es) return;
      S.ready = false;
      setOffline(true);
      if (es.readyState === 2) { // CLOSED — браузер сам переподключаться не будет
        es.close();
        api('/api/session').then(
          () => setTimeout(() => { if (S.es === es) connect(); }, 1500),
          (err) => {
            if (err.status === 401) logout();
            else setTimeout(() => { if (S.es === es) connect(); }, 3000);
          });
      }
    };
  }

  function onInit(d) {
    S.ready = true;
    setOffline(false);
    if (Array.isArray(d.reactions)) { S.reactions = d.reactions; buildReactBar(); }
    S.presence = d.presence || [];
    renderChat(d.chat || []);
    onState(d.state);
    sendStatus(true);
    syncClock();
  }

  function onState(st) {
    if (!st) return;
    if (S.rtt == null && st.serverNow) S.offset = st.serverNow - Date.now();
    S.room = st;
    S.holdSyncUntil = 0;
    if (!st.playing) document.body.classList.remove('idle');
    applyRoom();
    renderAll();
  }

  /** Подстройка часов: сколько миллисекунд прибавить к Date.now(), чтобы получить время сервера. */
  async function syncClock() {
    if (S.syncing) return;
    S.syncing = true;
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      try {
        const r = await fetch('/api/time', { cache: 'no-store' });
        const j = await r.json();
        const t1 = Date.now();
        samples.push({ rtt: t1 - t0, offset: j.now - (t0 + t1) / 2 });
      } catch (e) { /* ignore */ }
      if (i < 4) await sleep(120);
    }
    S.syncing = false;
    if (!samples.length) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    S.offset = samples[0].offset;
    S.rtt = samples[0].rtt;
  }

  const serverNow = () => Date.now() + S.offset;

  /** Где фильм должен быть прямо сейчас по мнению сервера. */
  function expectedPos() {
    const r = S.room;
    if (!r) return 0;
    let p = r.position;
    if (r.playing) p += ((serverNow() - r.updatedAt) / 1000) * (r.rate || 1);
    const d = video.duration;
    if (isFinite(d) && d > 0) p = Math.min(p, d);
    return Math.max(0, p);
  }

  // ================================================================ плеер
  function desiredSource() {
    const r = S.room;
    if (!r) return null;
    if (r.mode === 'stream') {
      if (!r.movie) return null;
      return { key: 'stream:' + r.movie.id, url: '/media/' + encodeURIComponent(r.movie.id) + '?t=' + encodeURIComponent(S.token), title: r.movie.name };
    }
    if (!S.localFile) return null;
    return { key: 'local:' + S.localFile.id, url: S.localFile.url, title: S.localFile.name };
  }

  function ensureSource() {
    const want = desiredSource();
    const key = want ? want.key : null;
    if (key !== S.sourceKey) {
      S.sourceKey = key;
      S.mediaError = null;
      S.quietUntil = performance.now() + 1200;
      S.bufferingReported = false;
      S.bufferWaits = 0;
      S.stallStart = 0;
      S.win = null;
      S.playPending = false;
      S.subsKey = null;
      if (want) video.src = want.url;
      else video.removeAttribute('src');
      try { video.load(); } catch (e) { /* ignore */ }
      setMediaSessionTitle(want ? want.title : null);
    }
    ensureTracks();
  }

  function subsList() {
    const r = S.room;
    if (!r || !S.sourceKey) return [];
    if (r.mode === 'stream') {
      return ((r.movie && r.movie.subs) || []).map((s) => ({
        label: s.label,
        src: '/subs/' + encodeURIComponent(s.id) + '?t=' + encodeURIComponent(S.token),
      }));
    }
    return S.localSubs ? [S.localSubs] : [];
  }

  function langOf(label) {
    const m = /^([a-z]{2,3})\b/i.exec(String(label || ''));
    return m ? m[1].toLowerCase() : 'ru';
  }

  function ensureTracks() {
    const list = subsList();
    const key = S.sourceKey + '|' + list.map((s) => s.src).join('|');
    if (key === S.subsKey) return;
    S.subsKey = key;
    video.querySelectorAll('track').forEach((t) => t.remove());
    list.forEach((s) => {
      const t = document.createElement('track');
      t.kind = 'subtitles';
      t.label = s.label;
      t.srclang = langOf(s.label);
      t.src = s.src;
      video.appendChild(t);
    });
    if (S.preferSubs != null && S.preferSubs < list.length) S.subsIndex = S.preferSubs;
    S.preferSubs = null;
    if (S.subsIndex >= list.length) S.subsIndex = -1;
    applySubs();
  }

  function applySubs() {
    const tt = video.textTracks;
    for (let i = 0; i < tt.length; i++) tt[i].mode = i === S.subsIndex ? 'showing' : 'disabled';
    E.ccBtn.classList.toggle('on', S.subsIndex >= 0);
  }

  function atEnd(t) {
    const d = video.duration;
    return isFinite(d) && d > 0 && t >= d - 0.3;
  }

  function seekTo(t) {
    if (!isFinite(t) || video.readyState < 1) return;
    const d = video.duration;
    if (isFinite(d) && d > 0) t = Math.min(t, Math.max(0, d - 0.1));
    t = Math.max(0, t);
    S.seekIssuedAt = performance.now();
    try { video.currentTime = t; } catch (e) { /* ignore */ }
  }

  /** Перемотка «вдогонку»: с поправкой на то, сколько времени занимает сама перемотка. */
  function catchUpTo(t) {
    seekTo(t + Math.min(2, S.seekCost));
    S.lastHardSeekAt = performance.now();
  }

  function setRate(rate) {
    if (Math.abs(video.playbackRate - rate) > 0.001) {
      try { video.playbackRate = rate; } catch (e) { /* ignore */ }
    }
  }

  function doPlay() {
    S.quietPlayUntil = performance.now() + 500;
    S.playPending = true;
    S.playPendingAt = performance.now();
    let p;
    try { p = video.play(); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(() => {
      S.playPending = false;
      if (S.needsGesture) { S.needsGesture = false; renderOverlay(); sendStatus(true); }
    }, (err) => {
      S.playPending = false;
      if (err && err.name === 'NotAllowedError') {
        S.needsGesture = true;
        renderOverlay();
        sendStatus(true);
      }
    });
  }

  function tryPlay() {
    if (S.needsGesture || S.unlocking) return;
    if (S.playPending && performance.now() - S.playPendingAt < 8000) return;
    doPlay();
  }

  function doPause() {
    S.quietPauseUntil = performance.now() + 500;
    try { video.pause(); } catch (e) { /* ignore */ }
  }

  /** «Разблокировка» звука по первому касанию (iOS запрещает запуск видео со звуком без жеста). */
  function primeMedia() {
    if (S.unlocking || !S.sourceKey) return;
    S.unlocking = true;
    const wasMuted = video.muted;
    video.muted = true;
    S.quietPlayUntil = performance.now() + 500;
    let p;
    try { p = video.play(); } catch (e) { p = null; }
    const finish = (ok) => {
      if (ok) S.primed = true;
      if (!(S.room && S.room.playing) && !video.paused) doPause();
      video.muted = wasMuted;
      S.unlocking = false;
      applyRoom();
    };
    if (p && p.then) p.then(() => finish(true), () => finish(false));
    else finish(true);
  }

  /** Привести плеер к состоянию комнаты. */
  function applyRoom() {
    const r = S.room;
    if (!r) return;
    ensureSource();
    if (!S.sourceKey || S.mediaError) return;
    if (r.playing) {
      if (video.readyState < 1) { if (video.paused) tryPlay(); return; }
      const target = expectedPos();
      if (Math.abs(video.currentTime - target) > HARD_SYNC && !video.seeking) catchUpTo(target);
      if (video.paused && !video.ended && !atEnd(target)) tryPlay();
    } else {
      if (!video.paused && !S.unlocking) doPause();
      setRate(1);
      if (video.readyState >= 1 && Math.abs(video.currentTime - expectedPos()) > 0.1) seekTo(expectedPos());
    }
  }

  function bufferedAhead(t) {
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.3 && b.end(i) >= t) return b.end(i) - t;
    }
    return 0;
  }

  /** Главный цикл: 4 раза в секунду проверяем рассинхрон и буфер. */
  function tick() {
    updateTimeUI();
    const r = S.room;
    if (!r || !S.sourceKey || S.mediaError) { S.stallStart = 0; return; }
    const now = performance.now();

    if (!r.playing) {
      if (!video.paused && !S.unlocking) doPause();
      setRate(1);
      S.stallStart = 0;
      // На паузе у всех должен быть один и тот же кадр
      if (video.paused && !video.seeking && video.readyState >= 1 && !S.dragging && !S.unlocking &&
          now > S.holdSyncUntil && now - (S.lastPauseFixAt || 0) > 1000 &&
          Math.abs(video.currentTime - expectedPos()) > 0.15) {
        S.lastPauseFixAt = now;
        seekTo(expectedPos());
      }
    } else if (video.paused) {
      S.stallStart = 0;
      if (!video.ended && !S.needsGesture) {
        if (video.readyState < 1) tryPlay();
        else if (!atEnd(expectedPos())) {
          if (Math.abs(video.currentTime - expectedPos()) > HARD_SYNC) catchUpTo(expectedPos());
          tryPlay();
        }
      }
    } else if (video.readyState >= 1 && !S.dragging) {
      const ct = video.currentTime;
      const advancing = Math.abs(ct - S.lastCT) > 0.02;
      if (advancing && !video.seeking) S.stallStart = 0;
      else if (!S.stallStart) S.stallStart = now;

      // Скорость за последние 2 секунды: при «рваной» подгрузке видео не стоит, но отстаёт
      if (!S.win || video.seeking || Math.abs(ct - S.win.ct) > 6) S.win = { t: now, ct };
      let slow = false;
      if (now - S.win.t >= 2000) {
        const speed = (ct - S.win.ct) / ((now - S.win.t) / 1000);
        slow = speed >= 0 && speed < 0.6;
        S.win = { t: now, ct };
      }
      const stuck = !!S.stallStart && now - S.stallStart > STALL_MS;
      if (stuck || slow) S.lastStruggleAt = now;

      // Видео не успевает подгружаться — просим всех подождать
      if ((stuck || slow) && !S.bufferingReported && now - S.lastBufferedAt > 2500 && now > S.quietUntil) {
        S.bufferingReported = true;
        S.bufferingSince = now;
        S.bufferWaits++;
        S.waitAhead = 0;
        S.waitProgressAt = now;
        act('buffering', { position: Math.round(ct * 1000) / 1000 });
        sendStatus(true);
      }

      // Рассинхрон правим только при ровном воспроизведении — иначе перемотка лишь сбросит буфер
      const smooth = advancing && video.readyState >= 3 && now - S.lastStruggleAt > 3000;
      if (smooth && now > S.holdSyncUntil) {
        const exp = expectedPos();
        const diff = ct - exp;
        const ad = Math.abs(diff);
        if (ad > DRIFT_HARD && now - S.lastHardSeekAt > 2500) { catchUpTo(exp); setRate(1); }
        else if (ad > SOFT_START) setRate(diff > 0 ? 0.94 : 1.06);
        else if (ad < SOFT_STOP) setRate(1);
      } else if (!smooth) {
        setRate(1);
      }
    }
    S.lastCT = video.currentTime;

    // Ждали подгрузку — проверяем, можно ли продолжать.
    // С каждой новой паузой просим запас побольше: 8 → 16 → 32 → 45 секунд,
    // чтобы на медленном интернете было меньше, но длиннее остановок.
    if (S.bufferingReported) {
      const ct = video.currentTime;
      const d = video.duration;
      const ahead = bufferedAhead(ct);
      const need = Math.min(45, 4 * Math.pow(2, S.bufferWaits));
      const nearEnd = isFinite(d) && d - ct < need;
      if (ahead > S.waitAhead + 0.5) { S.waitAhead = ahead; S.waitProgressAt = now; }
      const enough = !video.seeking && video.readyState >= 3 &&
        (ahead >= need || nearEnd || (S.bufferWaits <= 1 && video.readyState >= 4));
      // Браузер перестал докачивать на паузе (так бывает на iPhone) — ждать дальше бессмысленно
      const noProgress = now - S.waitProgressAt > 7000 && video.readyState >= 3;
      if (enough || noProgress || now - S.bufferingSince > 90000) {
        S.bufferingReported = false;
        S.lastBufferedAt = now;
        S.stallStart = 0;
        S.win = null;
        act('buffered');
        sendStatus(true);
      }
    }
  }

  // ---------------------------------------------------------------- события видео
  video.addEventListener('loadedmetadata', () => {
    S.mediaError = null;
    applySubs();
    applyRoom();
    renderSource();
    sendStatus(true);
  });
  video.addEventListener('play', () => {
    const now = performance.now();
    if (S.unlocking || !S.room || now < S.quietUntil || now < S.quietPlayUntil) return;
    // Запуск не от нас (кнопка на наушниках, экран блокировки) — сообщаем всем
    if (!S.room.playing) act('play', { position: video.currentTime });
  });
  video.addEventListener('pause', () => {
    const now = performance.now();
    if (S.unlocking || !S.room || video.ended || now < S.quietUntil || now < S.quietPauseUntil) return;
    // Пауза не от нас (звонок, наушники, свернули Safari) — ставим паузу всем
    if (S.room.playing) act('pause', { position: video.currentTime });
  });
  video.addEventListener('ended', () => {
    if (S.room && S.room.playing) act('pause', { position: video.duration });
  });
  video.addEventListener('error', () => {
    if (!S.sourceKey || !video.error) return;
    const code = video.error.code;
    const r = S.room;
    const isMkv = (r && r.mode === 'stream' && r.movie && r.movie.ext === 'mkv') ||
      (r && r.mode === 'local' && S.localFile && /\.mkv$/i.test(S.localFile.name));
    if (code === 2 && r && r.mode === 'stream') {
      // Сетевая ошибка — пробуем загрузить заново
      S.mediaError = 'Связь с видео прервалась, пробую ещё раз…';
      setTimeout(() => { S.sourceKey = null; applyRoom(); renderAll(); }, 3000);
    } else if (isMkv) {
      S.mediaError = 'Этот браузер не умеет играть MKV. Нужен MP4 (видео H.264, звук AAC) — см. README.';
    } else {
      S.mediaError = 'Браузер не поддерживает формат этого файла. Надёжнее всего MP4 (видео H.264, звук AAC).';
    }
    renderAll();
  });
  video.addEventListener('seeked', () => {
    if (!S.seekIssuedAt) return;
    const took = (performance.now() - S.seekIssuedAt) / 1000;
    S.seekIssuedAt = 0;
    if (took < 10) S.seekCost = S.seekCost * 0.5 + took * 0.5;
  });
  video.addEventListener('volumechange', renderMute);
  video.addEventListener('durationchange', renderSource);

  // ---------------------------------------------------------------- жесты (нужны iPhone для звука)
  function onGesture(e) {
    if (!S.room || !S.sourceKey || S.mediaError) return;
    const t = e && e.target;
    if (t && t.closest && t.closest('#pickFileBtn, #pickSubsBtn, #fileInput, #subsInput, #loginForm')) return;
    if (S.room.playing) {
      if (video.paused && !video.ended) { S.needsGesture = false; doPlay(); }
    } else if (!S.primed) {
      S.needsGesture = false;
      primeMedia();
    }
    renderOverlay();
  }
  document.addEventListener('click', onGesture, true);
  document.addEventListener('keydown', onGesture, true);

  // ---------------------------------------------------------------- действия пользователя
  function localPos() { return video.readyState >= 1 ? video.currentTime : expectedPos(); }

  function userPlayPause() {
    const r = S.room;
    if (!r || !S.sourceKey) return;
    if (r.playing) {
      act('pause', { position: Math.round(localPos() * 1000) / 1000 });
    } else {
      let pos = r.position;
      if (atEnd(pos)) pos = 0; // фильм закончился — начинаем сначала
      act('play', { position: pos });
    }
  }

  function userSeek(t) {
    const r = S.room;
    if (!r || !S.sourceKey) return;
    const d = video.duration;
    if (isFinite(d) && d > 0) t = Math.min(t, Math.max(0, d - 0.5));
    t = Math.max(0, t);
    seekTo(t);
    S.holdSyncUntil = performance.now() + 2500;
    act('seek', { position: Math.round(t * 1000) / 1000 });
  }

  function userSkip(delta) { userSeek((S.dragging ? S.dragTime : localPos()) + delta); }

  // ================================================================ отрисовка
  function renderAll() {
    renderMode();
    renderPlayBtn();
    renderSource();
    renderWait();
    renderOverlay();
    renderPeople();
    renderFsBtn();
  }

  function renderMode() {
    E.modeBtns.forEach((b) => b.classList.toggle('on', !!S.room && b.dataset.mode === S.room.mode));
  }

  function renderPlayBtn() {
    const playing = !!(S.room && S.room.playing);
    setIcon(E.playBtn, playing ? 'pause' : 'play');
    E.playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизведение');
  }

  function renderMute() {
    setIcon(E.muteBtn, video.muted || video.volume === 0 ? 'volOff' : 'vol');
  }

  function renderFsBtn() {
    const imm = document.body.classList.contains('immersive');
    setIcon(E.fsBtn, imm ? 'fsExit' : 'fs');
    E.fsBtn.hidden = IS_IPHONE && PHONE_LANDSCAPE.matches && !S.pseudoFs;
  }

  function updateTimeUI() {
    const d = video.duration;
    const known = isFinite(d) && d > 0;
    let cur;
    if (S.dragging) cur = S.dragTime;
    else if (S.sourceKey && video.readyState >= 1) cur = video.currentTime;
    else cur = S.room ? expectedPos() : 0;
    const pct = known ? Math.min(100, (cur / d) * 100) : 0;
    E.scrubProg.style.width = pct + '%';
    E.scrubKnob.style.left = pct + '%';
    let bufEnd = 0;
    if (known && S.sourceKey) {
      const b = video.buffered;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= cur + 0.5 && b.end(i) >= cur) bufEnd = b.end(i);
    }
    E.scrubBuf.style.width = (known ? Math.min(100, (bufEnd / d) * 100) : 0) + '%';
    E.time.textContent = fmt(cur) + ' / ' + (known ? fmt(d) : '--:--');
    if (S.dragging) { E.scrubTip.textContent = fmt(cur); E.scrubTip.style.left = pct + '%'; }
  }

  function peerState(p) {
    if (p.buffering) return { cls: 'warn', text: 'Подгружается видео…' };
    if (p.needsTap && S.room && S.room.playing) return { cls: 'warn', text: 'Нужно нажать «Присоединиться»' };
    if (S.room && S.room.mode === 'local' && !p.file) return { cls: 'off', text: 'Файл ещё не выбран' };
    return { cls: '', text: 'Всё готово' };
  }

  function renderPeople() {
    E.people.textContent = '';
    for (const p of S.presence) {
      const st = peerState(p);
      const chip = el('span', 'chip' + (p.cid === S.cid ? ' me' : ''));
      chip.appendChild(el('span', 'dot ' + st.cls));
      chip.appendChild(el('span', 'n', p.name));
      if (p.cid === S.cid) chip.appendChild(el('span', 'you', '(ты)'));
      chip.title = p.name + ': ' + st.text;
      E.people.appendChild(chip);
    }
  }

  function renderSource() {
    const r = S.room;
    if (!r) return;
    const stream = r.mode === 'stream';
    E.pickMovieBtn.hidden = !stream;
    E.pickFileBtn.hidden = stream;
    E.pickSubsBtn.hidden = stream || !S.localFile;
    const d = video.duration;
    const known = S.sourceKey && isFinite(d) && d > 0;
    E.srcPeers.textContent = '';
    if (stream) {
      if (r.movie) {
        E.srcTitle.textContent = r.movie.name;
        const parts = [fmtSize(r.movie.size)];
        if (known) {
          parts.push(fmt(d));
          parts.push('битрейт ≈ ' + ((r.movie.size * 8) / d / 1e6).toFixed(1) + ' Мбит/с');
        }
        if (r.movie.subs && r.movie.subs.length) parts.push('субтитры: ' + r.movie.subs.map((s) => s.label).join(', '));
        E.srcMeta.textContent = parts.join(' · ');
      } else {
        E.srcTitle.textContent = 'Фильм не выбран';
        E.srcMeta.textContent = 'Видео пойдёт с компьютера, где запущен сервер';
      }
    } else {
      if (S.localFile) {
        E.srcTitle.textContent = S.localFile.name;
        const parts = ['твой файл', fmtSize(S.localFile.size)];
        if (known) parts.push(fmt(d));
        if (S.localSubs) parts.push('субтитры: ' + S.localSubs.label);
        E.srcMeta.textContent = parts.join(' · ');
      } else {
        E.srcTitle.textContent = 'Файл не выбран';
        E.srcMeta.textContent = 'У каждого должен быть одинаковый фильм';
      }
      renderPeers(known ? d : null);
    }
    renderEmpty();
  }

  function renderPeers(myDuration) {
    const others = S.presence.filter((p) => p.uid !== S.uid);
    others.forEach((p, i) => {
      if (i) E.srcPeers.appendChild(document.createTextNode(' · '));
      let text;
      let cls = '';
      if (!p.file) {
        text = p.name + ': файл не выбран';
      } else {
        text = p.name + ': ' + p.file.name + (p.file.duration ? ' (' + fmt(p.file.duration) + ')' : '');
        if (myDuration && p.file.duration) {
          const diff = Math.abs(myDuration - p.file.duration);
          if (diff <= 2) { text += ' ✓'; cls = 'ok'; }
          else { text += ' — длительность отличается на ' + fmt(diff) + ', возможно, другая версия'; cls = 'warn'; }
        }
      }
      E.srcPeers.appendChild(el('span', cls, text));
    });
  }

  function renderEmpty() {
    const r = S.room;
    let show = false;
    let title = '';
    let text = '';
    let btn = '';
    let action = null;
    if (r && S.mediaError && S.sourceKey) {
      show = true;
      title = 'Видео не открывается';
      text = S.mediaError;
      btn = r.mode === 'stream' ? 'Выбрать другой фильм' : 'Выбрать другой файл';
      action = r.mode === 'stream' ? openPicker : pickFile;
    } else if (r && r.mode === 'stream' && !r.movie) {
      show = true;
      title = 'Выберите фильм';
      text = 'Фильмы лежат в папке movies на компьютере, где запущен сервер. Видео пойдёт оттуда всем.';
      btn = 'Выбрать фильм';
      action = openPicker;
    } else if (r && r.mode === 'local' && !S.localFile) {
      show = true;
      title = 'Открой свой файл';
      text = IS_IOS
        ? 'Сохрани фильм в приложение «Файлы», нажми кнопку ниже и выбери «Обзор» (не «Фото» — оттуда iPhone сожмёт видео).'
        : 'У каждого должен быть одинаковый фильм. По сети идут только команды, поэтому скорость интернета почти не важна.';
      btn = 'Выбрать файл';
      action = pickFile;
    }
    E.empty.hidden = !show;
    E.stage.classList.toggle('no-source', show || !S.sourceKey);
    if (show) {
      E.emptyTitle.textContent = title;
      E.emptyText.textContent = text;
      E.emptyBtn.textContent = btn;
      S.emptyAction = action;
    }
  }

  function renderWait() {
    const r = S.room;
    const list = r && r.autoPaused && r.waitingFor ? r.waitingFor : [];
    E.wait.hidden = !list.length;
    if (!list.length) return;
    const me = list.some((x) => x.cid === S.cid);
    const others = list.filter((x) => x.cid !== S.cid).map((x) => x.name);
    E.waitText.textContent = me && !others.length
      ? 'Подгружаем видео…'
      : 'Ждём: ' + others.concat(me ? ['ты'] : []).join(', ') + ' — видео подгружается';
  }

  function renderOverlay() {
    const r = S.room;
    E.tapjoin.hidden = !(S.needsGesture && r && r.playing && S.sourceKey && !S.mediaError);
  }

  function setOffline(off) {
    E.conn.classList.toggle('bad', off);
    E.conn.title = off ? 'Нет связи с сервером' : 'Связь с сервером есть';
    if (off) {
      // Браузер повторяет попытки каждые ~2 с — таймер не перезапускаем, иначе плашка не появится
      if (!S.offlineTimer && E.offline.hidden) {
        S.offlineTimer = setTimeout(() => { S.offlineTimer = null; if (!S.ready) E.offline.hidden = false; }, 2500);
      }
    } else {
      clearTimeout(S.offlineTimer);
      S.offlineTimer = null;
      E.offline.hidden = true;
    }
  }

  function flash(text) {
    E.flash.textContent = text;
    E.flash.hidden = false;
    E.flash.style.animation = 'none';
    void E.flash.offsetWidth;
    E.flash.style.animation = '';
    clearTimeout(S.flashTimer);
    S.flashTimer = setTimeout(() => { E.flash.hidden = true; }, 1800);
  }

  function spawnReaction(emoji, from) {
    const f = el('div', 'floater', emoji);
    if (from) f.appendChild(el('small', null, from));
    f.style.left = (6 + Math.random() * 70) + '%';
    E.reactLayer.appendChild(f);
    setTimeout(() => f.remove(), 2900);
  }

  function buildReactBar() {
    E.reactBar.textContent = '';
    S.reactions.forEach((em) => {
      const b = el('button', null, em);
      b.type = 'button';
      b.title = 'Отправить реакцию';
      b.addEventListener('click', () => act('react', { emoji: em }));
      E.reactBar.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- чат
  const msgEls = new Map();

  function chatVisible() {
    const b = document.body.classList;
    return !b.contains('immersive') || b.contains('chat-open');
  }

  function buildMsg(m) {
    if (m.kind === 'system') {
      const d = el('div', 'sys', m.text);
      d.title = hhmm(m.ts);
      return d;
    }
    const mine = m.uid === S.uid;
    const d = el('div', 'msg' + (mine ? ' me' : ''));
    if (!mine) {
      const w = el('span', 'who', m.from);
      w.style.color = nameColor(m.from);
      d.appendChild(w);
    }
    d.appendChild(el('span', 'tx', m.text));
    d.appendChild(el('span', 't', hhmm(m.ts)));
    return d;
  }

  function renderChat(list) {
    E.messages.textContent = '';
    msgEls.clear();
    if (!list.length) E.messages.appendChild(el('div', 'chat-empty', 'Пока тихо. Напиши что-нибудь 🙂'));
    list.forEach((m) => addMsg(m, false));
    E.messages.scrollTop = E.messages.scrollHeight;
  }

  function addMsg(m, live) {
    const box = E.messages;
    const placeholder = box.querySelector('.chat-empty');
    if (placeholder) placeholder.remove();
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const node = buildMsg(m);
    const old = msgEls.get(m.id);
    if (old && old.parentNode) old.replaceWith(node);
    else box.appendChild(node);
    msgEls.set(m.id, node);
    while (box.childElementCount > 400) {
      const first = box.firstElementChild;
      first.remove();
    }
    if (near || (m.uid === S.uid && m.kind === 'user')) box.scrollTop = box.scrollHeight;
    if (live && !old && m.uid !== S.uid && !chatVisible()) {
      showToast(m);
      bumpUnread();
    }
  }

  function showToast(m) {
    const t = el('div', 'toast' + (m.kind === 'system' ? ' sys' : ''));
    if (m.kind === 'user') {
      const b = el('b', null, m.from + ': ');
      b.style.color = nameColor(m.from);
      t.appendChild(b);
      t.appendChild(document.createTextNode(m.text));
    } else {
      t.textContent = m.text;
    }
    E.toasts.appendChild(t);
    while (E.toasts.childElementCount > 4) E.toasts.firstElementChild.remove();
    setTimeout(() => t.remove(), 6200);
  }

  function bumpUnread() {
    S.unread++;
    E.chatBadge.hidden = false;
    E.chatBadge.textContent = S.unread > 9 ? '9+' : String(S.unread);
  }
  function clearUnread() {
    S.unread = 0;
    E.chatBadge.hidden = true;
  }

  E.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = E.chatInput.value.trim();
    if (!text) return;
    if (!S.ready) { flash('Нет связи с сервером'); return; }
    E.chatInput.value = '';
    act('chat', { text });
  });

  // ================================================================ полноэкранный режим
  function isNativeFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  function updateImmersive() {
    const on = isNativeFs() || S.pseudoFs || PHONE_LANDSCAPE.matches;
    const body = document.body.classList;
    const was = body.contains('immersive');
    body.toggle('immersive', on);
    if (on && !was && S.chatOpen == null) S.chatOpen = window.innerWidth >= 1100;
    body.toggle('chat-open', on && !!S.chatOpen);
    if (!on || S.chatOpen) clearUnread();
    if (!on) body.remove('idle');
    renderFsBtn();
    poke();
  }

  function toggleFullscreen() {
    if (isNativeFs()) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      try { const p = ex && ex.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
      return;
    }
    if (S.pseudoFs) { S.pseudoFs = false; updateImmersive(); return; }
    const target = E.layout;
    const req = target.requestFullscreen || target.webkitRequestFullscreen;
    const fallback = () => {
      S.pseudoFs = true;
      updateImmersive();
      if (IS_IPHONE && !PHONE_LANDSCAPE.matches) flash('Поверни телефон боком');
    };
    if (req && !IS_IPHONE) {
      try {
        const p = req.call(target);
        if (p && p.catch) p.catch(fallback);
      } catch (e) { fallback(); }
    } else {
      fallback();
    }
  }

  document.addEventListener('fullscreenchange', updateImmersive);
  document.addEventListener('webkitfullscreenchange', updateImmersive);
  if (PHONE_LANDSCAPE.addEventListener) PHONE_LANDSCAPE.addEventListener('change', updateImmersive);
  else if (PHONE_LANDSCAPE.addListener) PHONE_LANDSCAPE.addListener(updateImmersive);

  // Панель управления прячется во время просмотра на весь экран
  function poke() {
    document.body.classList.remove('idle');
    clearTimeout(S.idleTimer);
    S.idleTimer = setTimeout(() => {
      const b = document.body.classList;
      if (b.contains('immersive') && S.room && S.room.playing && !S.dragging &&
          document.activeElement !== E.chatInput && E.picker.hidden) b.add('idle');
    }, COARSE ? 3500 : 2500);
  }

  // ================================================================ элементы управления
  let clickTimer = null;
  E.stage.addEventListener('click', (e) => {
    if (e.target !== video) return;
    if (COARSE) {
      const b = document.body.classList;
      if (b.contains('idle')) poke();
      else if (b.contains('immersive') && S.room && S.room.playing) { clearTimeout(S.idleTimer); b.add('idle'); }
      else poke();
      return;
    }
    if (clickTimer) return;
    clickTimer = setTimeout(() => { clickTimer = null; userPlayPause(); }, 230);
  });
  E.stage.addEventListener('dblclick', (e) => {
    if (e.target !== video || COARSE) return;
    clearTimeout(clickTimer);
    clickTimer = null;
    toggleFullscreen();
  });
  E.stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') poke(); });
  E.controls.addEventListener('pointerdown', poke);

  E.playBtn.addEventListener('click', userPlayPause);
  E.backBtn.addEventListener('click', () => userSkip(-10));
  E.fwdBtn.addEventListener('click', () => userSkip(10));
  E.fsBtn.addEventListener('click', toggleFullscreen);
  E.ccBtn.addEventListener('click', toggleSubs);
  E.chatBtn.addEventListener('click', () => {
    S.chatOpen = !document.body.classList.contains('chat-open');
    updateImmersive();
    if (S.chatOpen && !COARSE) E.chatInput.focus();
  });
  E.chatClose.addEventListener('click', () => { S.chatOpen = false; updateImmersive(); });
  E.tapjoinBtn.addEventListener('click', () => renderOverlay());
  E.waitSkip.addEventListener('click', () => { if (S.room) act('play', { position: S.room.position }); });
  E.emptyBtn.addEventListener('click', () => { if (S.emptyAction) S.emptyAction(); });
  E.pickMovieBtn.addEventListener('click', openPicker);
  E.modeBtns.forEach((b) => b.addEventListener('click', () => {
    if (!S.room || S.room.mode === b.dataset.mode) return;
    act('setMode', { mode: b.dataset.mode });
  }));

  // Громкость
  function restoreVolume() {
    if (!VOLUME_OK) { E.vol.hidden = true; renderMute(); return; }
    const v = parseFloat(store.get('tg_vol'));
    if (isFinite(v)) { video.volume = Math.min(1, Math.max(0, v)); E.vol.value = String(video.volume); }
    renderMute();
  }
  E.vol.addEventListener('input', () => {
    video.volume = parseFloat(E.vol.value);
    video.muted = video.volume === 0;
    store.set('tg_vol', E.vol.value);
  });
  E.muteBtn.addEventListener('click', toggleMute);
  function toggleMute() {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) { video.volume = 0.5; E.vol.value = '0.5'; }
  }

  // Субтитры
  function toggleSubs() {
    const n = video.textTracks.length;
    if (!n) {
      if (S.room && S.room.mode === 'local' && S.localFile) { E.subsInput.click(); return; }
      flash(S.room && S.room.mode === 'stream'
        ? 'Субтитров нет. Положи .srt рядом с фильмом с тем же именем'
        : 'Субтитров нет');
      return;
    }
    S.subsIndex = S.subsIndex + 1 >= n ? -1 : S.subsIndex + 1;
    applySubs();
    flash(S.subsIndex < 0 ? 'Субтитры выключены' : 'Субтитры: ' + (video.textTracks[S.subsIndex].label || 'вкл'));
  }

  // Полоса перемотки (работает и мышью, и пальцем)
  function scrubTimeAt(clientX) {
    const rect = E.scrub.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const d = video.duration;
    return isFinite(d) && rect.width ? (x / rect.width) * d : 0;
  }
  E.scrub.addEventListener('pointerdown', (e) => {
    if (!S.sourceKey || !isFinite(video.duration)) return;
    S.dragging = true;
    S.dragTime = scrubTimeAt(e.clientX);
    try { E.scrub.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    E.scrub.classList.add('drag');
    updateTimeUI();
    e.preventDefault();
  });
  E.scrub.addEventListener('pointermove', (e) => {
    if (S.dragging) { S.dragTime = scrubTimeAt(e.clientX); updateTimeUI(); return; }
    if (e.pointerType === 'mouse' && isFinite(video.duration)) {
      const rect = E.scrub.getBoundingClientRect();
      const t = scrubTimeAt(e.clientX);
      E.scrubTip.textContent = fmt(t);
      E.scrubTip.style.left = (rect.width ? ((e.clientX - rect.left) / rect.width) * 100 : 0) + '%';
      E.scrub.classList.add('hovering');
    }
  });
  E.scrub.addEventListener('pointerleave', () => E.scrub.classList.remove('hovering'));
  E.scrub.addEventListener('pointerup', () => {
    if (!S.dragging) return;
    S.dragging = false;
    E.scrub.classList.remove('drag');
    userSeek(S.dragTime);
  });
  E.scrub.addEventListener('pointercancel', () => {
    S.dragging = false;
    E.scrub.classList.remove('drag');
  });

  // Горячие клавиши (e.code не зависит от раскладки)
  document.addEventListener('keydown', (e) => {
    if (!S.room || E.app.hidden) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (e.key === 'Escape' && t === E.chatInput) t.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!E.picker.hidden) { if (e.key === 'Escape') closePicker(); return; }
    if ((e.code === 'Space' || e.key === 'Enter') && t && t.tagName === 'BUTTON') return;
    switch (e.code) {
      case 'Space': case 'KeyK': e.preventDefault(); userPlayPause(); break;
      case 'ArrowLeft': case 'KeyJ': e.preventDefault(); userSkip(-10); break;
      case 'ArrowRight': case 'KeyL': e.preventDefault(); userSkip(10); break;
      case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyC': toggleSubs(); break;
      case 'Enter':
        e.preventDefault();
        if (document.body.classList.contains('immersive') && !document.body.classList.contains('chat-open')) {
          S.chatOpen = true;
          updateImmersive();
        }
        E.chatInput.focus();
        break;
      default: break;
    }
  });

  // ================================================================ свой файл (режим «Свой файл»)
  function pickFile() { E.fileInput.click(); }

  E.fileInput.addEventListener('change', () => {
    const f = E.fileInput.files && E.fileInput.files[0];
    E.fileInput.value = '';
    if (!f) return;
    const old = S.localFile;
    S.localFile = { id: rid(8), name: f.name, size: f.size, url: URL.createObjectURL(f) };
    if (S.localSubs) { const u = S.localSubs.src; setTimeout(() => URL.revokeObjectURL(u), 3000); S.localSubs = null; }
    S.subsIndex = -1;
    applyRoom();
    renderAll();
    sendStatus(true);
    if (old) setTimeout(() => URL.revokeObjectURL(old.url), 3000);
  });

  function decodeText(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1251').decode(bytes); }
  }
  function toVtt(text) {
    let t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (/^WEBVTT/.test(t)) return t;
    t = t.replace(/(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/g,
      (_, h, m, s, ms) => h.padStart(2, '0') + ':' + m.padStart(2, '0') + ':' + s.padStart(2, '0') + '.' + ms.padEnd(3, '0'));
    t = t.replace(/\{\\[^}]*\}/g, '');
    return 'WEBVTT\n\n' + t.trim() + '\n';
  }

  E.subsInput.addEventListener('change', async () => {
    const f = E.subsInput.files && E.subsInput.files[0];
    E.subsInput.value = '';
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const vtt = toVtt(decodeText(bytes));
      if (S.localSubs) URL.revokeObjectURL(S.localSubs.src);
      S.localSubs = {
        label: f.name.replace(/\.[^.]+$/, '').slice(-32) || 'Субтитры',
        src: URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })),
      };
      S.preferSubs = 0;
      ensureTracks();
      renderSource();
      flash('Субтитры подключены');
    } catch (e) {
      flash('Не получилось прочитать субтитры');
    }
  });

  // ================================================================ выбор фильма с компьютера
  async function openPicker() {
    if (isNativeFs()) toggleFullscreen();
    if (S.pseudoFs) { S.pseudoFs = false; updateImmersive(); }
    E.picker.hidden = false;
    await loadMovies();
  }
  function closePicker() { E.picker.hidden = true; }

  async function loadMovies() {
    E.pickerList.textContent = '';
    E.pickerList.appendChild(el('div', 'picker-empty', 'Загружаю список…'));
    try {
      const r = await api('/api/movies');
      renderMovies(r);
    } catch (e) {
      E.pickerList.textContent = '';
      E.pickerList.appendChild(el('div', 'picker-empty', 'Не удалось получить список фильмов'));
    }
  }

  function renderMovies(r) {
    E.pickerList.textContent = '';
    E.pickerFoot.textContent = 'Папка: ' + r.dir + '. Положи туда видео (лучше MP4) и нажми «Обновить». Субтитры .srt/.vtt клади рядом с тем же именем.';
    if (!r.movies.length) {
      E.pickerList.appendChild(el('div', 'picker-empty', 'Здесь пока пусто. Скопируй фильмы в папку, указанную ниже, и обнови список.'));
      return;
    }
    const cur = S.room && S.room.movie ? S.room.movie.id : null;
    r.movies.forEach((m) => {
      const row = el('div', 'movie' + (m.id === cur ? ' current' : ''));
      const info = el('div', 'mi');
      info.appendChild(el('div', 'mt', m.name));
      const meta = el('div', 'mm');
      meta.appendChild(el('span', null, fmtSize(m.size)));
      meta.appendChild(el('span', 'tag', m.ext.toUpperCase()));
      if (m.subs.length) meta.appendChild(el('span', 'tag', 'субтитры: ' + m.subs.map((s) => s.label).join(', ')));
      if (m.ext === 'mkv') meta.appendChild(el('span', 'tag warn', 'iPhone не откроет MKV'));
      const slash = m.id.lastIndexOf('/');
      if (slash > 0) meta.appendChild(el('span', null, m.id.slice(0, slash)));
      info.appendChild(meta);
      const dl = el('a', 'ib');
      dl.href = '/media/' + encodeURIComponent(m.id) + '?t=' + encodeURIComponent(S.token) + '&dl=1';
      dl.setAttribute('download', '');
      dl.title = 'Скачать на это устройство (для режима «Свой файл»)';
      dl.setAttribute('aria-label', 'Скачать');
      dl.innerHTML = svgIcon('download');
      dl.addEventListener('click', (e) => e.stopPropagation());
      row.appendChild(info);
      row.appendChild(dl);
      row.addEventListener('click', () => { act('setMovie', { id: m.id }); closePicker(); });
      E.pickerList.appendChild(row);
    });
  }
  E.pickerClose.addEventListener('click', closePicker);
  E.pickerRefresh.addEventListener('click', loadMovies);
  E.picker.addEventListener('click', (e) => { if (e.target === E.picker) closePicker(); });

  // ================================================================ статус для собеседника
  function fileInfo() {
    const r = S.room;
    if (!r || !S.sourceKey) return null;
    const d = video.duration;
    const dur = isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : null;
    if (r.mode === 'local') return S.localFile ? { name: S.localFile.name, size: S.localFile.size, duration: dur } : null;
    return r.movie ? { name: r.movie.name, size: r.movie.size, duration: dur } : null;
  }

  function sendStatus(force) {
    if (!S.ready) return;
    const st = {
      file: fileInfo(),
      buffering: S.bufferingReported,
      needsTap: !!(S.needsGesture && S.room && S.room.playing),
      mobile: COARSE,
    };
    const key = JSON.stringify(st);
    const now = Date.now();
    if (!force && key === S.lastStatusKey && now - S.lastStatusAt < 5000) return;
    S.lastStatusKey = key;
    S.lastStatusAt = now;
    act('status', { status: st });
  }

  // ================================================================ экран блокировки / наушники
  function setMediaSessionTitle(title) {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    try { navigator.mediaSession.metadata = title ? new window.MediaMetadata({ title, artist: 'Together' }) : null; } catch (e) { /* ignore */ }
  }
  if ('mediaSession' in navigator) {
    const h = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* ignore */ } };
    h('play', () => { if (S.room && !S.room.playing) userPlayPause(); });
    h('pause', () => { if (S.room && S.room.playing) userPlayPause(); });
    h('seekbackward', () => userSkip(-10));
    h('seekforward', () => userSkip(10));
  }

  // ================================================================ вход
  function setToken(t) {
    S.token = t;
    S.authed = true;
    store.set('tg_token', t);
  }

  function showLogin(errText) {
    E.app.hidden = true;
    E.login.hidden = false;
    document.body.classList.remove('in-app', 'immersive', 'chat-open', 'idle');
    E.passLabel.hidden = !!S.authed;
    E.nameInput.value = S.name || '';
    const msg = errText || S.loginErrorText;
    E.loginError.hidden = !msg;
    E.loginError.textContent = msg || '';
    S.loginErrorText = '';
    if (!COARSE) setTimeout(() => ((S.name && !S.authed) ? E.passInput : E.nameInput).focus(), 60);
  }

  function logout() {
    store.del('tg_token');
    S.token = '';
    S.authed = false;
    S.ready = false;
    S.room = null;
    if (S.es) { S.es.close(); S.es = null; }
    try { video.pause(); } catch (e) { /* ignore */ }
    showLogin('Нужно войти заново (возможно, поменялся пароль комнаты)');
  }

  E.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const showErr = (t) => { E.loginError.textContent = t; E.loginError.hidden = false; };
    const name = E.nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) { showErr('Напиши имя — его увидит собеседник'); E.nameInput.focus(); return; }
    if (!S.authed) {
      const pass = E.passInput.value.trim();
      if (!pass) { showErr('Введи пароль комнаты'); E.passInput.focus(); return; }
      try {
        const r = await api('/api/login', { password: pass });
        setToken(r.token);
      } catch (err) {
        showErr(err.status === 429 ? 'Слишком много попыток. Подожди 15 минут.'
          : err.status === 401 ? 'Неверный пароль' : 'Сервер недоступен');
        return;
      }
    }
    S.name = name;
    store.set('tg_name', name);
    startApp();
  });

  function startApp() {
    E.login.hidden = true;
    E.app.hidden = false;
    document.body.classList.add('in-app');
    connect();
    if (S.started) return;
    S.started = true;
    buildReactBar();
    restoreVolume();
    renderPlayBtn();
    updateImmersive();
    syncClock();
    setInterval(syncClock, 60000);
    setInterval(tick, 250);
    setInterval(() => sendStatus(false), 1000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !S.started || !S.authed) return;
    syncClock();
    if (!S.es || S.es.readyState === 2) connect();
    applyRoom();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && S.started && S.authed) connect(); });

  async function boot() {
    fillIcons(document);
    renderMute();
    const params = new URLSearchParams(location.search);
    const k = params.get('k');
    if (k !== null) history.replaceState(null, '', location.pathname);
    if (k) {
      try { const r = await api('/api/login', { password: k }); setToken(r.token); }
      catch (err) {
        S.loginErrorText = err.status === 429 ? 'Слишком много попыток. Подожди 15 минут.' : 'Пароль из ссылки не подошёл, введи его вручную';
      }
    }
    if (!S.authed) {
      try { const r = await api('/api/session'); setToken(r.token); } catch (err) { /* ещё не входили */ }
    }
    if (S.authed && S.name) startApp();
    else showLogin();
  }

  boot();
})();
