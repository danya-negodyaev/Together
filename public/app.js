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
  /** Первая буква имени — для кружка-аватарки. */
  function initialOf(name) {
    const ch = Array.from(String(name || '').trim())[0] || '?';
    return ch.toUpperCase();
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
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
    reply: '<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>',
    refresh: '<path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
    pip: '<path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/>',
    emoji: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/>',
    rewind: '<path d="M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z"/>',
    ffwd: '<path d="m4 18 8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>',
    phone: '<path d="M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>',
    tablet: '<path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 1.99-.9 1.99-2L23 6c0-1.1-.9-2-2-2zm-2 14H5V6h14v12z"/>',
    desktop: '<path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/>',
    tv: '<path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/>',
  };
  const svgIcon = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  const setIcon = (node, name) => { if (node.dataset.cur !== name) { node.innerHTML = svgIcon(name); node.dataset.cur = name; } };
  function fillIcons(root) {
    root.querySelectorAll('[data-icon]').forEach((n) => n.insertAdjacentHTML('afterbegin', svgIcon(n.dataset.icon)));
  }

  // ================================================================ окружение
  const UA = navigator.userAgent;
  // iPadOS 13+ представляется компьютером Mac — узнаём его по сенсорному экрану.
  // navigator.platform устарел, но другого способа в Safari нет — не заменять
  // noinspection JSDeprecatedSymbols
  const IS_IOS = /iP(hone|od|ad)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_IPHONE = /iP(hone|od)/.test(UA);
  const IS_TV = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|BRAVIA|Android TV|GoogleTV|AFT[A-Z]|CrKey/i.test(UA);
  // Основной ввод — палец (телефон, планшет). Может смениться на ходу: например, у планшета отстегнули клавиатуру
  const COARSE_MQ = window.matchMedia('(pointer: coarse)');
  const COARSE = COARSE_MQ.matches;
  const VOLUME_OK = (() => {
    try { const v = document.createElement('video'); v.volume = 0.5; return v.volume === 0.5; } catch (e) { return false; }
  })();
  // Низкое широкое окно на компьютере тоже считаем «телефоном боком»
  const PHONE_LANDSCAPE = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
  const WIDE = window.matchMedia('(min-width: 900px)'); // раскладка с чатом сбоку (как в style.css)
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** Подписка на смену медиазапроса. */
  const onMedia = (mq, fn) => {
    // addListener — запасной путь для Safari 13 и старее, не убирать
    // noinspection JSDeprecatedSymbols
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
  };

  /** Телефон, а не планшет: короткая сторона экрана меньше 600 точек. */
  function isPhone() {
    return COARSE_MQ.matches && Math.min(screen.width, screen.height) < 600;
  }
  /** Ориентация самого экрана, а не окна: клавиатура на Android уменьшает окно, но не поворачивает телефон. */
  function screenLandscape() {
    const o = screen.orientation;
    if (o && typeof o.type === 'string') return o.type.indexOf('landscape') === 0;
    // Старые iPhone (iOS до 16.4) не знают screen.orientation — тогда смотрим устаревший window.orientation
    // noinspection JSDeprecatedSymbols
    const angle = window.orientation;
    if (typeof angle === 'number') return Math.abs(angle) === 90;
    return window.innerWidth > window.innerHeight;
  }
  /** Телефон повёрнут боком — фильм сам разворачивается на весь экран. */
  function phoneLandscape() {
    return COARSE_MQ.matches ? isPhone() && screenLandscape() : PHONE_LANDSCAPE.matches;
  }
  /** Тип устройства — его видно в списке участников. */
  function deviceKind() {
    if (IS_TV) return 'tv';
    if (!COARSE_MQ.matches) return 'desktop';
    return isPhone() ? 'phone' : 'tablet';
  }

  // Пороги синхронизации (секунды)
  const HARD_SYNC = 1.0;    // при смене состояния: дальше — перематываем
  const DRIFT_HARD = 1.2;   // во время просмотра: дальше — перематываем
  const SOFT_START = 0.18;  // дальше — чуть ускоряем/замедляем
  const SOFT_STOP = 0.05;   // ближе — возвращаем нормальную скорость
  const STALL_MS = 1600;    // столько стоим на месте во время игры — значит, кончился буфер

  // ================================================================ элементы
  // Нестандартные возможности Safari: на iPhone и iPad полный экран и «картинка в картинке» работают только
  // через них. В стандартных описаниях DOM их нет — описываем сами, иначе редактор принимает их за опечатки.
  /**
   * @typedef {Object} SafariVideoExtras
   * @property {(mode: string) => boolean} [webkitSupportsPresentationMode]
   * @property {(mode: string) => void} [webkitSetPresentationMode]
   * @property {string} [webkitPresentationMode]
   */
  /** @typedef {HTMLVideoElement & SafariVideoExtras} SafariVideo */
  /**
   * @typedef {Object} SafariFullscreen
   * @property {Element|null} [webkitFullscreenElement] у документа
   * @property {() => void} [webkitExitFullscreen] у документа
   * @property {() => void} [webkitRequestFullscreen] у элемента
   */

  const video = /** @type {SafariVideo} */ ($('#video'));

  /**
   * Элементы страницы по id из index.html. Описание нужно редактору: по нему он знает тип каждого
   * элемента и замечает опечатки в именах. Новый элемент добавляется и сюда, и в список ниже.
   * @typedef {Object} Elements
   * @property {HTMLElement} login
   * @property {HTMLFormElement} loginForm
   * @property {HTMLInputElement} nameInput
   * @property {HTMLInputElement} passInput
   * @property {HTMLLabelElement} passLabel
   * @property {HTMLElement} loginError
   * @property {HTMLElement} app
   * @property {HTMLElement} layout
   * @property {HTMLElement} stage
   * @property {HTMLButtonElement} people
   * @property {HTMLElement} conn
   * @property {HTMLElement} empty
   * @property {HTMLElement} emptyTitle
   * @property {HTMLElement} emptyText
   * @property {HTMLButtonElement} emptyBtn
   * @property {HTMLElement} wait
   * @property {HTMLElement} waitText
   * @property {HTMLButtonElement} waitSkip
   * @property {HTMLElement} offline
   * @property {HTMLElement} reactLayer
   * @property {HTMLElement} toasts
   * @property {HTMLElement} flash
   * @property {HTMLElement} tapjoin
   * @property {HTMLButtonElement} tapjoinBtn
   * @property {HTMLElement} controls
   * @property {HTMLElement} scrub
   * @property {HTMLElement} scrubBuf
   * @property {HTMLElement} scrubProg
   * @property {HTMLElement} scrubKnob
   * @property {HTMLElement} scrubTip
   * @property {HTMLButtonElement} playBtn
   * @property {HTMLButtonElement} backBtn
   * @property {HTMLButtonElement} fwdBtn
   * @property {HTMLElement} time
   * @property {HTMLButtonElement} muteBtn
   * @property {HTMLInputElement} vol
   * @property {HTMLButtonElement} ccBtn
   * @property {HTMLButtonElement} chatBtn
   * @property {HTMLElement} chatBadge
   * @property {HTMLButtonElement} fsBtn
   * @property {HTMLElement} srcTitle
   * @property {HTMLElement} srcMeta
   * @property {HTMLElement} srcPeers
   * @property {HTMLButtonElement} pickMovieBtn
   * @property {HTMLLabelElement} pickFileBtn
   * @property {HTMLLabelElement} pickSubsBtn
   * @property {HTMLElement} chat
   * @property {HTMLButtonElement} chatClose
   * @property {HTMLElement} messages
   * @property {HTMLElement} reactBar
   * @property {HTMLFormElement} chatForm
   * @property {HTMLInputElement} chatInput
   * @property {HTMLElement} replyBar
   * @property {HTMLElement} replyWho
   * @property {HTMLElement} replyText
   * @property {HTMLButtonElement} replyCancel
   * @property {HTMLElement} picker
   * @property {HTMLElement} pickerList
   * @property {HTMLElement} pickerFoot
   * @property {HTMLButtonElement} pickerRefresh
   * @property {HTMLButtonElement} pickerClose
   * @property {HTMLInputElement} fileInput
   * @property {HTMLInputElement} subsInput
   * @property {HTMLElement} skipBack
   * @property {HTMLElement} skipFwd
   * @property {HTMLElement} pipNote
   * @property {HTMLButtonElement} pipBack
   * @property {HTMLButtonElement} reactBtn
   * @property {HTMLElement} reactTray
   * @property {HTMLButtonElement} pipBtn
   * @property {HTMLElement} peoplePop
   * @property {HTMLElement} peopleTitle
   * @property {HTMLElement} peopleList
   * @property {NodeListOf<HTMLElement>} modeBtns
   * @property {HTMLElement} topbar
   */
  const E = /** @type {Elements} */ ({});
  ['login', 'loginForm', 'nameInput', 'passInput', 'passLabel', 'loginError', 'app', 'layout', 'stage', 'people', 'conn',
    'empty', 'emptyTitle', 'emptyText', 'emptyBtn', 'wait', 'waitText', 'waitSkip', 'offline', 'reactLayer', 'toasts', 'flash',
    'tapjoin', 'tapjoinBtn', 'controls', 'scrub', 'scrubBuf', 'scrubProg', 'scrubKnob', 'scrubTip', 'playBtn', 'backBtn',
    'fwdBtn', 'time', 'muteBtn', 'vol', 'ccBtn', 'chatBtn', 'chatBadge', 'fsBtn', 'srcTitle', 'srcMeta', 'srcPeers',
    'pickMovieBtn', 'pickFileBtn', 'pickSubsBtn', 'chat', 'chatClose', 'messages', 'reactBar', 'chatForm', 'chatInput',
    'replyBar', 'replyWho', 'replyText', 'replyCancel',
    'picker', 'pickerList', 'pickerFoot', 'pickerRefresh', 'pickerClose', 'fileInput', 'subsInput',
    'skipBack', 'skipFwd', 'pipNote', 'pipBack', 'reactBtn', 'reactTray', 'pipBtn', 'peoplePop', 'peopleTitle', 'peopleList',
  ].forEach((id) => { E[id] = document.getElementById(id); });
  E.modeBtns = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-mode]'));
  E.topbar = /** @type {HTMLElement} */ (document.querySelector('.topbar'));

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
    lastPauseFixAt: 0,    // когда последний раз выравнивали кадр на паузе
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
    chatOpen: null,       // чат поверх фильма в полноэкранном режиме
    chatHidden: store.get('tg_chat_hidden') === '1', // чат спрятан на широком экране
    replyTo: null,        // { id, from } — на какое сообщение сейчас отвечаем
    pointer: COARSE ? 'touch' : 'mouse', // чем нажимали в последний раз: мышь, палец или перо
    skipTarget: null,     // куда ведёт серия быстрых перемоток (стрелки, двойные касания)
    skipTimer: 0,
    skipSum: 0,           // сколько секунд набралось в серии — для подсказки на экране
    skipDir: 0,
    lastPosStateAt: 0,    // когда последний раз сообщали системе позицию фильма
    lastMediaAt: 0,       // когда последний раз нажали медиакнопку (одно нажатие может прийти дважды)
    unread: 0,
    lastStatusKey: '',
    lastStatusAt: 0,
    loginErrorText: '',
    emptyAction: null,    // что делает кнопка на заставке «нет фильма»
    pickerFrom: null,     // откуда открыли выбор фильма — туда потом вернём фокус
    // таймеры интерфейса
    idleTimer: 0,         // спрятать панель управления
    flashTimer: 0,        // убрать подсказку в центре кадра
    trayTimer: 0,         // закрыть лоток реакций
    skipHintTimer: 0,     // спрятать подсказку «±N с» у края кадра
    offlineTimer: null,   // показать плашку «нет связи» (с задержкой: браузер переподключается сам)
  };
  if (!/^[a-z0-9]{16}$/.test(S.uid)) { S.uid = rid(16); store.set('tg_uid', S.uid); }
  if (!/^[a-z0-9]{16}$/.test(S.cid)) { S.cid = rid(16); sess.set('tg_cid', S.cid); }

  // Чем нажимают прямо сейчас: на ноутбуке с сенсорным экраном бывает и мышь, и палец
  document.addEventListener('pointerdown', (e) => { S.pointer = e.pointerType || 'mouse'; }, true);
  const touchInput = () => S.pointer !== 'mouse';

  // ================================================================ связь с сервером
  /**
   * Ошибка запроса к серверу; в status — код ответа (401 — нужно войти заново, 409 — нет подключения).
   * @typedef {Error & {status?: number}} HttpError
   */

  async function api(path, body) {
    /** @type {Record<string, string>} */
    const headers = {};
    if (S.token) headers['X-Token'] = S.token;
    /** @type {RequestInit} */
    const opts = { method: body ? 'POST' : 'GET', headers, cache: 'no-store', credentials: 'same-origin' };
    if (body) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) {
      const err = /** @type {HttpError} */ (new Error((data && data.error) || 'HTTP ' + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /**
   * Отправить действие на сервер. Ошибки обрабатываются здесь же, поэтому ответа можно не ждать:
   * такие вызовы помечены void — «результат не нужен намеренно».
   */
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
    void syncClock();
  }

  function onState(st) {
    if (!st) return;
    if (S.rtt == null && st.serverNow) S.offset = st.serverNow - Date.now();
    const wasPlaying = !!(S.room && S.room.playing);
    S.room = st;
    S.holdSyncUntil = 0;
    if (!st.playing) document.body.classList.remove('idle');
    applyRoom();
    renderAll();
    if (st.playing && !wasPlaying) poke(); // фильм пошёл — панель скоро спрячется сама
    updatePositionState();
    updateWakeLock();
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
      else { leavePip(); video.removeAttribute('src'); }
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
      t.addEventListener('load', () => placeCues(true));
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
    placeCues(true);
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
      renderMute(); // событие volumechange может потеряться при смене источника — обновляем значок сами
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
    // Пока идёт своя серия перемоток, не возвращаем плеер к старой позиции комнаты
    const skipping = S.skipTarget != null;
    if (r.playing) {
      if (video.readyState < 1) { if (video.paused) tryPlay(); return; }
      const target = expectedPos();
      if (!skipping && Math.abs(video.currentTime - target) > HARD_SYNC && !video.seeking) catchUpTo(target);
      if (video.paused && !video.ended && !atEnd(target)) tryPlay();
    } else {
      if (!video.paused && !S.unlocking) doPause();
      setRate(1);
      if (!skipping && video.readyState >= 1 && Math.abs(video.currentTime - expectedPos()) > 0.1) seekTo(expectedPos());
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
          now > S.holdSyncUntil && now - S.lastPauseFixAt > 1000 &&
          Math.abs(video.currentTime - expectedPos()) > 0.15) {
        S.lastPauseFixAt = now;
        seekTo(expectedPos());
      }
    } else if (video.paused) {
      S.stallStart = 0;
      if (!video.ended && !S.needsGesture) {
        if (video.readyState < 1) tryPlay();
        else if (!atEnd(expectedPos())) {
          if (S.skipTarget == null && Math.abs(video.currentTime - expectedPos()) > HARD_SYNC) catchUpTo(expectedPos());
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
        void act('buffering', { position: Math.round(ct * 1000) / 1000 });
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
        void act('buffered');
        sendStatus(true);
      }
    }

    // Полоса прогресса на экране блокировки и в уведомлении — изредка уточняем
    if (now - S.lastPosStateAt > 10000) updatePositionState();
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
    if (!S.room.playing) void act('play', { position: video.currentTime });
  });
  video.addEventListener('pause', () => {
    const now = performance.now();
    if (S.unlocking || !S.room || video.ended || now < S.quietUntil || now < S.quietPauseUntil) return;
    // Пауза не от нас (звонок, наушники, свернули Safari) — ставим паузу всем
    if (S.room.playing) void act('pause', { position: video.currentTime });
  });
  video.addEventListener('ended', () => {
    if (S.room && S.room.playing) void act('pause', { position: video.duration });
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
  // Позиция для экрана блокировки и системных медиа-кнопок — после каждого заметного события
  video.addEventListener('loadedmetadata', updatePositionState);
  video.addEventListener('play', updatePositionState);
  video.addEventListener('pause', updatePositionState);
  video.addEventListener('seeked', updatePositionState);

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
      void act('pause', { position: Math.round(localPos() * 1000) / 1000 });
    } else {
      let pos = r.position;
      if (atEnd(pos)) pos = 0; // фильм закончился — начинаем сначала
      void act('play', { position: pos });
    }
  }

  /** Перематывать можно не дальше, чем за полсекунды до конца. */
  function clampSeek(t) {
    const d = video.duration;
    if (isFinite(d) && d > 0) t = Math.min(t, Math.max(0, d - 0.5));
    return Math.max(0, t);
  }

  function userSeek(t) {
    const r = S.room;
    if (!r || !S.sourceKey) return;
    cancelSkip();
    t = clampSeek(t);
    if (Math.abs(video.currentTime - t) > 0.05) seekTo(t);
    S.holdSyncUntil = performance.now() + 2500;
    void act('seek', { position: Math.round(t * 1000) / 1000 });
  }

  /**
   * Перемотка серией: стрелка с автоповтором, несколько двойных касаний, кнопки ±10 подряд.
   * У себя видео прыгает сразу, а всем уходит одна итоговая перемотка, когда нажатия закончились.
   */
  function queueSeek(t) {
    if (!S.room || !S.sourceKey) return;
    t = clampSeek(t);
    S.skipTarget = t;
    seekTo(t);
    S.holdSyncUntil = performance.now() + 3000;
    clearTimeout(S.skipTimer);
    S.skipTimer = setTimeout(commitSkip, 450);
    updateTimeUI();
  }

  function commitSkip() {
    const t = S.skipTarget;
    S.skipTarget = null;
    S.skipTimer = 0;
    if (t == null || !S.room) return;
    // Если фильм шёл, за время серии он успел проиграть ещё чуть-чуть — отправляем фактическую позицию
    userSeek(S.room.playing && video.readyState >= 1 ? video.currentTime : t);
  }

  function cancelSkip() {
    clearTimeout(S.skipTimer);
    S.skipTimer = 0;
    S.skipTarget = null;
  }

  function userSkip(delta) {
    if (!S.room || !S.sourceKey) return;
    const series = S.skipTarget != null;
    const base = series ? S.skipTarget : (S.dragging ? S.dragTime : localPos());
    // Для подсказки на экране: сколько секунд набралось за серию в одну сторону
    const dir = Math.sign(delta);
    S.skipSum = (series && dir === S.skipDir ? S.skipSum : 0) + Math.abs(delta);
    S.skipDir = dir;
    queueSeek(base + delta);
    showSkip(dir, S.skipSum);
  }

  /** Полукруг у края кадра: «назад/вперёд на N секунд». */
  function showSkip(dir, sum) {
    const node = dir < 0 ? E.skipBack : E.skipFwd;
    const other = dir < 0 ? E.skipFwd : E.skipBack;
    other.classList.remove('show');
    node.querySelector('b').textContent = Math.round(sum) + ' с';
    node.classList.add('show');
    clearTimeout(S.skipHintTimer);
    S.skipHintTimer = setTimeout(() => node.classList.remove('show'), 650);
  }

  // ================================================================ отрисовка
  function renderAll() {
    renderMode();
    renderPlayBtn();
    renderSource();
    renderWait();
    renderOverlay();
    renderPeople();
    renderFsBtn();
    renderPip();
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
    // Телефон боком — это ещё не полный экран: кнопка по-прежнему прячет панели браузера (Android)
    const full = isNativeFs() || S.pseudoFs;
    setIcon(E.fsBtn, full ? 'fsExit' : 'fs');
    const label = full ? 'Выйти из полноэкранного режима' : 'Во весь экран';
    E.fsBtn.title = label + ' (F)';
    E.fsBtn.setAttribute('aria-label', label);
    E.fsBtn.hidden = IS_IPHONE && phoneLandscape() && !S.pseudoFs;
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

  /** Кружок с первой буквой имени. */
  function avatar(p) {
    const av = el('span', 'av', initialOf(p.name));
    av.style.background = nameColor(p.name);
    return av;
  }

  function renderPeople() {
    E.people.textContent = '';
    for (const p of S.presence) {
      const st = peerState(p);
      const chip = el('span', 'chip' + (p.cid === S.cid ? ' me' : ''));
      chip.appendChild(el('span', 'dot ' + st.cls));
      chip.appendChild(avatar(p));
      chip.appendChild(el('span', 'n', p.name));
      if (p.cid === S.cid) chip.appendChild(el('span', 'you', '(ты)'));
      chip.title = p.name + ': ' + st.text;
      E.people.appendChild(chip);
    }
    E.people.setAttribute('aria-label', 'В комнате: ' + S.presence.length + '. Показать список');
    fitPeople();
    if (!E.peoplePop.hidden) renderPeopleList();
  }

  /** Имена не помещаются в строку — показываем кружки с буквами, а лишних прячем за «+N». */
  function fitPeople() {
    const box = E.people;
    const chips = /** @type {HTMLElement[]} */ (Array.from(box.querySelectorAll('.chip')));
    box.classList.remove('compact');
    chips.forEach((c) => { c.hidden = false; });
    const old = box.querySelector('.more');
    if (old) old.remove();
    const fits = () => box.scrollWidth <= box.clientWidth + 1;
    if (!chips.length || !box.clientWidth || fits()) return;
    box.classList.add('compact');
    if (fits()) return;
    const more = el('span', 'more');
    box.appendChild(more);
    // Прячем участников с конца, но себя оставляем на виду
    let hidden = 0;
    for (let i = chips.length - 1; i >= 0 && !fits(); i--) {
      if (chips[i].classList.contains('me')) continue;
      chips[i].hidden = true;
      more.textContent = '+' + (++hidden);
    }
  }

  const DEVICE_NAMES = { phone: 'телефон', tablet: 'планшет', desktop: 'компьютер', tv: 'телевизор' };

  /** Список «Кто в комнате»: имя, статус и с какого устройства человек смотрит. */
  function renderPeopleList() {
    E.peopleTitle.textContent = 'В комнате: ' + S.presence.length;
    E.peopleList.textContent = '';
    for (const p of S.presence) {
      const st = peerState(p);
      const row = el('div', 'person');
      const av = avatar(p);
      av.appendChild(el('span', 'dot ' + st.cls));
      row.appendChild(av);
      const info = el('div', 'pi');
      const name = el('div', 'pn', p.name);
      if (p.cid === S.cid) name.appendChild(el('span', 'you', ' (ты)'));
      info.appendChild(name);
      info.appendChild(el('div', 'ps' + (st.cls === 'warn' ? ' warn' : ''), st.text));
      row.appendChild(info);
      const kind = DEVICE_NAMES[p.device] ? p.device : null;
      if (kind) {
        const dev = el('span', 'dev');
        dev.innerHTML = svgIcon(kind);
        dev.title = DEVICE_NAMES[kind];
        row.appendChild(dev);
      }
      E.peopleList.appendChild(row);
    }
  }

  function openPeople() {
    renderPeopleList();
    // Список выпадает прямо под верхней панелью, какой бы высоты она ни была
    E.peoplePop.style.top = Math.round(E.topbar.getBoundingClientRect().bottom + 6) + 'px';
    E.peoplePop.hidden = false;
    E.people.setAttribute('aria-expanded', 'true');
    pushLayer('people', hidePeople);
  }
  function hidePeople() {
    E.peoplePop.hidden = true;
    E.people.setAttribute('aria-expanded', 'false');
  }
  function closePeople() {
    if (E.peoplePop.hidden) return;
    hidePeople();
    dropLayer('people');
  }
  E.people.addEventListener('click', () => { if (E.peoplePop.hidden) openPeople(); else closePeople(); });
  // Нажатие мимо списка закрывает его
  document.addEventListener('pointerdown', (e) => {
    const t = /** @type {Node} */ (e.target);
    if (E.peoplePop.hidden || E.peoplePop.contains(t) || E.people.contains(t)) return;
    closePeople();
  }, true);

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

  /** Кнопки реакций: в чате и в лотке на панели плеера (когда чат скрыт). */
  function buildReactBar() {
    E.reactBar.textContent = '';
    E.reactTray.textContent = '';
    S.reactions.forEach((em) => {
      [E.reactBar, E.reactTray].forEach((box) => {
        const b = el('button', null, em);
        b.type = 'button';
        b.title = 'Отправить реакцию';
        b.setAttribute('aria-label', 'Реакция ' + em);
        b.addEventListener('click', () => {
          void act('react', { emoji: em });
          if (box === E.reactTray) bumpTray();
        });
        box.appendChild(b);
      });
    });
  }

  // ---------------------------------------------------------------- лоток реакций на панели плеера
  function openTray() {
    E.reactTray.hidden = false;
    E.reactBtn.classList.add('on');
    E.reactBtn.setAttribute('aria-expanded', 'true');
    bumpTray();
  }
  function closeTray() {
    clearTimeout(S.trayTimer);
    if (E.reactTray.hidden) return;
    E.reactTray.hidden = true;
    E.reactBtn.classList.remove('on');
    E.reactBtn.setAttribute('aria-expanded', 'false');
    poke();
  }
  /** Лоток закрывается сам через несколько секунд после последнего нажатия. */
  function bumpTray() {
    clearTimeout(S.trayTimer);
    S.trayTimer = setTimeout(closeTray, 4000);
    poke();
  }
  E.reactBtn.addEventListener('click', () => { if (E.reactTray.hidden) openTray(); else closeTray(); });

  // ---------------------------------------------------------------- чат
  const msgEls = new Map();   // id → DOM-узел сообщения
  const msgData = new Map();  // id → само сообщение (нужно, чтобы на него ответить)
  const SWIPE_REPLY = 56;     // на столько пикселей сдвинуть сообщение влево, чтобы ответить

  /** Виден ли сейчас чат: в полноэкранном режиме — если открыт, на широком экране — если не спрятан. */
  function chatVisible() {
    const b = document.body.classList;
    if (b.contains('immersive')) return b.contains('chat-open');
    return !(S.chatHidden && WIDE.matches);
  }

  /** От видимости чата зависят кнопки на панели, всплывающие сообщения и счётчик непрочитанного. */
  function renderChatState() {
    const b = document.body.classList;
    b.toggle('chat-hidden', S.chatHidden);
    const visible = chatVisible();
    b.toggle('chat-away', !visible);
    E.chatBtn.classList.toggle('on', visible);
    const label = visible ? 'Скрыть чат' : 'Показать чат';
    E.chatBtn.title = label + ' (T)';
    E.chatBtn.setAttribute('aria-label', label);
    if (visible) {
      clearUnread();
      closeTray();
    }
  }

  /** Показать чат, где бы он ни был спрятан. */
  function showChat() {
    const b = document.body.classList;
    if (b.contains('immersive')) {
      if (b.contains('chat-open')) return;
      S.chatOpen = true;
      // На телефоне и планшете чат поверх фильма закрывается кнопкой «Назад»
      if (COARSE_MQ.matches) pushLayer('chat', () => { S.chatOpen = false; updateImmersive(); });
      updateImmersive();
    } else if (S.chatHidden && WIDE.matches) {
      setChatHidden(false);
    }
  }

  function setChatHidden(hidden) {
    S.chatHidden = hidden;
    store.set('tg_chat_hidden', hidden ? '1' : '0');
    renderChatState();
    placeCues(true);
  }

  /** Кнопка 💬 и клавиша T: спрятать или показать чат. */
  function toggleChat() {
    const b = document.body.classList;
    if (b.contains('immersive')) {
      if (b.contains('chat-open')) { S.chatOpen = false; updateImmersive(); return; }
      showChat();
      if (!touchInput()) E.chatInput.focus();
      return;
    }
    if (WIDE.matches) setChatHidden(!S.chatHidden); // на узком экране чат всегда под видео
  }

  /** Текст в одну строку — для цитат. */
  function oneLine(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  /** Цитата исходного сообщения внутри ответа. По клику — прокрутка к оригиналу. */
  function buildQuote(r) {
    const q = el('div', 'quote');
    q.dataset.jump = r.id;
    q.title = 'Показать исходное сообщение';
    q.style.borderLeftColor = nameColor(r.from);
    const w = el('span', 'q-who', r.from);
    w.style.color = nameColor(r.from);
    q.appendChild(w);
    q.appendChild(el('span', 'q-tx', oneLine(r.text)));
    return q;
  }

  function buildMsg(m) {
    if (m.kind === 'system') {
      const d = el('div', 'sys', m.text);
      d.title = hhmm(m.ts);
      return d;
    }
    const mine = m.uid === S.uid;
    const toMe = !mine && !!m.reply && m.reply.uid === S.uid; // ответили на твоё сообщение
    const d = el('div', 'msg' + (mine ? ' me' : '') + (toMe ? ' to-me' : ''));
    if (!mine) {
      const w = el('span', 'who', m.from);
      w.style.color = nameColor(m.from);
      d.appendChild(w);
    }
    if (m.reply) d.appendChild(buildQuote(m.reply));
    d.appendChild(el('span', 'tx', m.text));
    d.appendChild(el('span', 't', hhmm(m.ts)));
    // Кнопка «Ответить»: на компьютере видна при наведении, на телефоне — после касания сообщения
    const rb = el('button', 'rp');
    rb.type = 'button';
    rb.title = 'Ответить';
    rb.setAttribute('aria-label', 'Ответить');
    rb.innerHTML = svgIcon('reply');
    d.appendChild(rb);
    return d;
  }

  function renderChat(list) {
    E.messages.textContent = '';
    msgEls.clear();
    msgData.clear();
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
    node.dataset.id = m.id;
    const old = msgEls.get(m.id);
    if (old && old.parentNode) old.replaceWith(node);
    else box.appendChild(node);
    msgEls.set(m.id, node);
    msgData.set(m.id, m);
    // Слишком старые сообщения убираем со страницы вместе с записями о них
    while (box.childElementCount > 400) {
      const first = /** @type {HTMLElement} */ (box.firstElementChild);
      if (first.dataset.id) { msgEls.delete(first.dataset.id); msgData.delete(first.dataset.id); }
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
      const b = el('b', null, m.from);
      b.style.color = nameColor(m.from);
      t.appendChild(b);
      // Если ответили именно тебе — подписываем, чтобы было понятно, к чему реплика
      if (m.reply && m.reply.uid === S.uid) t.appendChild(el('span', 'to-me', ' в ответ тебе'));
      t.appendChild(document.createTextNode(': ' + m.text));
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

  // ---------------------------------------------------------------- ответы на сообщения
  /** Сохраняет прокрутку у нижнего края, когда над полем ввода появляется или исчезает панель ответа. */
  function keepBottom(fn) {
    const box = E.messages;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    fn();
    if (near) box.scrollTop = box.scrollHeight;
  }

  function startReply(id) {
    const m = msgData.get(id);
    if (!m || m.kind !== 'user') return;
    S.replyTo = { id: m.id, from: m.from };
    E.replyWho.textContent = m.from;
    E.replyWho.style.color = nameColor(m.from);
    E.replyBar.style.borderLeftColor = nameColor(m.from);
    E.replyText.textContent = oneLine(m.text);
    keepBottom(() => { E.replyBar.hidden = false; });
    clearSelected();
    E.chatInput.focus();
  }

  function cancelReply() {
    if (!S.replyTo) return;
    S.replyTo = null;
    keepBottom(() => { E.replyBar.hidden = true; });
  }

  function clearSelected() {
    E.messages.querySelectorAll('.msg.sel').forEach((n) => n.classList.remove('sel'));
  }

  /** Прокрутить ленту к исходному сообщению и ненадолго подсветить его. */
  function jumpTo(id) {
    const node = msgEls.get(id);
    if (!node || !node.isConnected) { flash('Этого сообщения уже нет в истории'); return; }
    const box = E.messages;
    box.scrollTo({ top: node.offsetTop - (box.clientHeight - node.offsetHeight) / 2, behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth' });
    node.classList.add('hl');
    clearTimeout(node.hlTimer);
    node.hlTimer = setTimeout(() => node.classList.remove('hl'), 1400);
  }

  // Свайп сообщения влево на сенсорном экране — ответить на него (как в Telegram)
  let swipe = null;       // текущий жест: { node, pid, x, y, dx, active }
  let swipeEndAt = 0;     // когда закончился свайп — чтобы следом не сработало касание

  E.messages.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const t = /** @type {HTMLElement} */ (e.target);
    const node = t.closest('.msg');
    if (!node || t.closest('.rp')) return;
    swipe = { node, pid: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
  });

  E.messages.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.pid) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (!swipe.active) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;                     // пока непонятно, что за жест
      if (dx > -12 || Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }  // прокрутка ленты или свайп вправо
      swipe.active = true;
      swipe.node.classList.add('swiping');
    }
    swipe.dx = Math.max(-SWIPE_REPLY * 1.4, Math.min(0, dx));
    swipe.node.style.transform = 'translateX(' + swipe.dx + 'px)';
    const ok = swipe.dx <= -SWIPE_REPLY;
    // Лёгкий отклик вибрацией в момент, когда отпускание уже даст ответ (Android)
    if (ok && !swipe.node.classList.contains('swipe-ok') && navigator.vibrate) {
      try { navigator.vibrate(8); } catch (err) { /* ignore */ }
    }
    swipe.node.classList.toggle('swipe-ok', ok);
  });

  function endSwipe(e) {
    if (!swipe || e.pointerId !== swipe.pid) return;
    const s = swipe;
    swipe = null;
    if (!s.active) return;
    swipeEndAt = Date.now();
    s.node.classList.remove('swiping', 'swipe-ok');
    s.node.style.transform = '';
    if (e.type === 'pointerup' && s.dx <= -SWIPE_REPLY) startReply(s.node.dataset.id);
  }
  E.messages.addEventListener('pointerup', endSwipe);
  E.messages.addEventListener('pointercancel', endSwipe);

  // Нажатия в ленте: кнопка «Ответить», цитата, выбор сообщения пальцем
  E.messages.addEventListener('click', (e) => {
    if (Date.now() - swipeEndAt < 400) return; // это был свайп, а не касание
    const t = /** @type {HTMLElement} */ (e.target);
    const rb = t.closest('.rp');
    if (rb) { startReply(/** @type {HTMLElement} */ (rb.closest('.msg')).dataset.id); return; }
    const q = /** @type {HTMLElement|null} */ (t.closest('.quote'));
    if (q) { jumpTo(q.dataset.jump); return; }
    // На сенсорном экране касание сообщения показывает у него кнопку «Ответить»
    if (touchInput()) {
      const node = t.closest('.msg');
      const was = !!node && node.classList.contains('sel');
      clearSelected();
      if (node && !was) node.classList.add('sel');
    }
  });

  E.replyCancel.addEventListener('click', () => {
    cancelReply();
    if (!touchInput()) E.chatInput.focus();
  });

  // Лента «прилипает» к последнему сообщению, когда меняется её высота (клавиатура, поворот, панель ответа)
  let chatAtBottom = true;
  E.messages.addEventListener('scroll', () => {
    const box = E.messages;
    chatAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  }, { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (chatAtBottom) E.messages.scrollTop = E.messages.scrollHeight; }).observe(E.messages);
  }

  E.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = E.chatInput.value.trim();
    if (!text) return;
    if (!S.ready) { flash('Нет связи с сервером'); return; }
    E.chatInput.value = '';
    const payload = { text };
    if (S.replyTo) payload.replyTo = S.replyTo.id;
    cancelReply();
    void act('chat', payload);
  });

  // ================================================================ полноэкранный режим
  /** Документ вместе с нестандартными функциями Safari для полного экрана. */
  const doc = /** @type {Document & SafariFullscreen} */ (document);

  function isNativeFs() { return !!(document.fullscreenElement || doc.webkitFullscreenElement); }

  function updateImmersive() {
    const native = isNativeFs();
    const on = native || S.pseudoFs || phoneLandscape();
    const body = document.body.classList;
    const was = body.contains('immersive');
    body.toggle('immersive', on);
    body.toggle('native-fs', native);
    if (on && !was && S.chatOpen == null) S.chatOpen = window.innerWidth >= 1100;
    body.toggle('chat-open', on && !!S.chatOpen);
    if (!on) E.stage.classList.remove('fill');
    // Чат или псевдо-полный экран закрылись не через «Назад» — убираем и их запись в истории
    if (!(on && S.chatOpen)) dropLayer('chat');
    if (!S.pseudoFs) dropLayer('fs');
    renderChatState();
    renderFsBtn();
    if (on !== was) {
      poke();
      placeCues(true);
      if (!on) requestAnimationFrame(fitPeople); // шапка снова видна — раскладываем участников по её ширине
    }
  }

  function exitFullscreen() {
    const ex = document.exitFullscreen || doc.webkitExitFullscreen;
    try {
      const p = ex && ex.call(document);
      return p && p.then ? p.catch(() => {}) : Promise.resolve();
    } catch (e) { return Promise.resolve(); }
  }

  function toggleFullscreen() {
    if (isNativeFs()) { void exitFullscreen(); return; }
    if (S.pseudoFs) { S.pseudoFs = false; updateImmersive(); return; }
    const target = /** @type {HTMLElement & SafariFullscreen} */ (E.layout);
    // iPhone не даёт развернуть на весь экран ничего, кроме голого видео, — растягиваем страницу сами
    const fallback = () => {
      S.pseudoFs = true;
      pushLayer('fs', () => { S.pseudoFs = false; updateImmersive(); });
      updateImmersive();
      if (IS_IPHONE && !phoneLandscape()) flash('Поверни телефон боком');
    };
    if (IS_IPHONE || !(target.requestFullscreen || target.webkitRequestFullscreen)) { fallback(); return; }
    let p;
    try {
      // navigationUI: 'hide' — на Android прячется и системная панель навигации
      p = target.requestFullscreen ? target.requestFullscreen({ navigationUI: 'hide' }) : target.webkitRequestFullscreen();
    } catch (e) { fallback(); return; }
    if (p && p.then) p.then(lockLandscape, fallback);
    else setTimeout(lockLandscape, 300);
  }

  /** Телефон в полноэкранном режиме сам поворачивает фильм боком (Android; iPhone так не умеет). */
  function lockLandscape() {
    const o = screen.orientation;
    if (!isPhone() || !isNativeFs() || !o || typeof o.lock !== 'function') return;
    if (video.videoWidth && video.videoHeight && video.videoHeight > video.videoWidth) return; // вертикальное видео
    try { const p = o.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }

  function onFullscreenChange() {
    if (!isNativeFs() && screen.orientation && typeof screen.orientation.unlock === 'function') {
      try { screen.orientation.unlock(); } catch (e) { /* ignore */ }
    }
    updateImmersive();
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  onMedia(PHONE_LANDSCAPE, updateImmersive);
  // Поворот экрана: размеры окна меняются не мгновенно, поэтому проверяем чуть позже
  const onRotate = () => setTimeout(updateImmersive, 60);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', onRotate);
  else window.addEventListener('orientationchange', onRotate);
  // Изменился размер окна: раскладка, участники в шапке, положение субтитров
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      updateImmersive();
      fitPeople();
      placeCues(true);
    });
  });
  onMedia(WIDE, renderChatState);

  // ---------------------------------------------------------------- панель управления прячется сама
  /** Можно ли сейчас спрятать панель управления. */
  function canIdle() {
    if (!S.room || !S.room.playing || !S.sourceKey || S.mediaError || S.dragging) return false;
    if (!E.picker.hidden || !E.reactTray.hidden || !E.peoplePop.hidden) return false;
    const a = document.activeElement;
    // На кнопке панели стоит фокус с клавиатуры — не прячем, иначе не видно, где он
    return !(a && E.controls.contains(a) && isFocusVisible(a));
  }
  function isFocusVisible(node) {
    try { return node.matches(':focus-visible'); } catch (e) { return false; }
  }

  /** Показать панель и через пару секунд бездействия снова спрятать (если фильм идёт). */
  function poke(delay) {
    const b = document.body.classList;
    if (b.contains('idle')) { b.remove('idle'); placeCues(); }
    clearTimeout(S.idleTimer);
    S.idleTimer = setTimeout(hideControls, typeof delay === 'number' ? delay : (touchInput() ? 3500 : 2500));
  }
  function hideControls() {
    clearTimeout(S.idleTimer);
    if (!canIdle()) return;
    document.body.classList.add('idle');
    placeCues();
  }

  // ================================================================ касания и щелчки по кадру
  // Мышь: щелчок — пауза, двойной щелчок — полный экран.
  // Палец: касание — показать или спрятать панель; двойное касание слева/справа — назад/вперёд на 10 с
  // (каждое следующее касание той же стороны добавляет ещё 10 с); двойное касание в центре — пауза.
  const TAP_GAP = 320;     // мс между касаниями, чтобы считать их двойным
  const SERIES_GAP = 800;  // мс, пока продолжается серия перемотки касаниями
  let clickTimer = null;
  let stagePointer = 'mouse';
  let lastTap = null;      // { t, zone, idleBefore } — предыдущее касание
  let tapSeries = null;    // { t, zone } — идущая серия перемотки

  E.stage.addEventListener('pointerdown', (e) => { stagePointer = e.pointerType || 'mouse'; }, true);

  E.stage.addEventListener('click', (e) => {
    if (e.target !== video) return;
    if (stagePointer !== 'mouse') { onStageTap(e); return; }
    if (clickTimer) return;
    clickTimer = setTimeout(() => { clickTimer = null; userPlayPause(); }, 230);
  });
  E.stage.addEventListener('dblclick', (e) => {
    if (e.target !== video || stagePointer !== 'mouse') return;
    clearTimeout(clickTimer);
    clickTimer = null;
    toggleFullscreen();
  });

  /** Левая треть кадра — -1, правая — 1, середина — 0 (по видимой части, без чата поверх фильма). */
  function tapZone(e) {
    const r = E.controls.getBoundingClientRect();
    const x = (e.clientX - r.left) / (r.width || 1);
    return x < 0.35 ? -1 : x > 0.65 ? 1 : 0;
  }

  function onStageTap(e) {
    const now = performance.now();
    const zone = tapZone(e);
    const b = document.body.classList;
    // Серия: каждое следующее касание той же стороны — ещё 10 секунд
    if (tapSeries && zone !== 0 && zone === tapSeries.zone && now - tapSeries.t < SERIES_GAP) {
      tapSeries.t = now;
      userSkip(zone * 10);
      return;
    }
    tapSeries = null;
    if (lastTap && now - lastTap.t < TAP_GAP && zone === lastTap.zone) {
      // Двойное касание: панель возвращаем в то состояние, что было до первого касания
      if (lastTap.idleBefore) hideControls(); else poke();
      lastTap = null;
      if (zone === 0) { userPlayPause(); return; }
      tapSeries = { t: now, zone };
      userSkip(zone * 10);
      return;
    }
    lastTap = { t: now, zone, idleBefore: b.contains('idle') };
    if (b.contains('idle') || !canIdle()) poke(); else hideControls();
  }

  // Два пальца на кадре в полноэкранном режиме: развести — кадр заполняет экран (края обрежутся), свести — снова целиком
  const pinch = { pts: new Map(), start: 0, done: false };
  E.stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target !== video || !document.body.classList.contains('immersive')) return;
    pinch.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.pts.size === 2) { pinch.start = pinchDist(); pinch.done = false; }
  });
  E.stage.addEventListener('pointermove', (e) => {
    if (!pinch.pts.has(e.pointerId)) return;
    pinch.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.pts.size !== 2 || pinch.done || !pinch.start) return;
    const k = pinchDist() / pinch.start;
    if (k > 1.2 || k < 0.83) { pinch.done = true; setFill(k > 1); }
  });
  const endPinch = (e) => { pinch.pts.delete(e.pointerId); if (pinch.pts.size < 2) pinch.start = 0; };
  E.stage.addEventListener('pointerup', endPinch);
  E.stage.addEventListener('pointercancel', endPinch);
  function pinchDist() {
    const [a, b] = Array.from(pinch.pts.values());
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
  function setFill(on) {
    if (E.stage.classList.contains('fill') === on) return;
    E.stage.classList.toggle('fill', on);
    flash(on ? 'Кадр на весь экран' : 'Кадр целиком');
  }

  E.stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') poke(); });
  // Мышь ушла с кадра — панель прячется быстрее
  E.stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') poke(800); });
  E.controls.addEventListener('pointerdown', poke);

  // ================================================================ элементы управления
  E.playBtn.addEventListener('click', userPlayPause);
  E.backBtn.addEventListener('click', () => userSkip(-10));
  E.fwdBtn.addEventListener('click', () => userSkip(10));
  E.fsBtn.addEventListener('click', toggleFullscreen);
  E.ccBtn.addEventListener('click', toggleSubs);
  E.chatBtn.addEventListener('click', toggleChat);
  E.chatClose.addEventListener('click', () => { S.chatOpen = false; updateImmersive(); });
  E.tapjoinBtn.addEventListener('click', () => renderOverlay());
  E.waitSkip.addEventListener('click', () => { if (S.room) void act('play', { position: S.room.position }); });
  E.emptyBtn.addEventListener('click', () => { if (S.emptyAction) S.emptyAction(); });
  E.pickMovieBtn.addEventListener('click', openPicker);
  E.modeBtns.forEach((b) => b.addEventListener('click', () => {
    if (!S.room || S.room.mode === b.dataset.mode) return;
    void act('setMode', { mode: b.dataset.mode });
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
  /** Громкость стрелками ↑/↓. На iPhone и iPad её меняют только кнопки самого устройства. */
  function changeVolume(delta) {
    if (!VOLUME_OK) { flash('Громкость — кнопками на устройстве'); return; }
    const v = clamp(Math.round((video.volume + delta) * 20) / 20, 0, 1);
    video.volume = v;
    video.muted = v === 0;
    E.vol.value = String(v);
    store.set('tg_vol', String(v));
    flash('Громкость ' + Math.round(v * 100) + '%');
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
    poke();
  });
  E.scrub.addEventListener('pointercancel', () => {
    S.dragging = false;
    E.scrub.classList.remove('drag');
  });

  // Горячие клавиши (e.code не зависит от раскладки)
  document.addEventListener('keydown', (e) => {
    if (!S.room || E.app.hidden || e.defaultPrevented) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      // Esc в поле чата: сначала отменяет ответ, повторное нажатие убирает фокус
      if (e.key === 'Escape' && t === E.chatInput) { if (S.replyTo) cancelReply(); else t.blur(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!E.picker.hidden) { pickerKey(e); return; }
    if (e.key === 'Escape') {
      if (!E.peoplePop.hidden) closePeople();
      else if (!E.reactTray.hidden) closeTray();
      else if (S.pseudoFs) toggleFullscreen();
      return;
    }
    if (mediaKey(e)) return;
    if ((e.code === 'Space' || e.key === 'Enter') && t && t.tagName === 'BUTTON') return;
    switch (e.code) {
      case 'Space': case 'KeyK': e.preventDefault(); userPlayPause(); break;
      case 'ArrowLeft': case 'KeyJ': e.preventDefault(); userSkip(-10); break;
      case 'ArrowRight': case 'KeyL': e.preventDefault(); userSkip(10); break;
      case 'ArrowUp': e.preventDefault(); changeVolume(0.1); break;
      case 'ArrowDown': e.preventDefault(); changeVolume(-0.1); break;
      case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
      case 'KeyM': toggleMute(); break;
      case 'KeyC': toggleSubs(); break;
      case 'KeyP': e.preventDefault(); void togglePip(); break;
      case 'KeyT': toggleChat(); break;
      case 'Enter':
        e.preventDefault();
        showChat();
        E.chatInput.focus();
        return;
      default: return;
    }
    poke(); // после нажатия панель ненадолго видна: видно время и полосу перемотки
  });

  /** Медиаклавиши клавиатуры и пульта ТВ (если браузер не передал их системным медиа-кнопкам). */
  function mediaKey(e) {
    const playing = !!(S.room && S.room.playing);
    switch (e.key) {
      case 'MediaPlayPause': mediaOnce(userPlayPause); break;
      case 'MediaPlay': if (!playing) mediaOnce(userPlayPause); break;
      case 'MediaPause': case 'MediaStop': if (playing) mediaOnce(userPlayPause); break;
      case 'MediaRewind': case 'MediaTrackPrevious': mediaOnce(() => userSkip(-10)); break;
      case 'MediaFastForward': case 'MediaTrackNext': mediaOnce(() => userSkip(10)); break;
      default: return false;
    }
    e.preventDefault();
    return true;
  }

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
    t = t.replace(/\{\\[^}]*}/g, '');
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
    S.pickerFrom = document.activeElement;
    E.picker.hidden = false;
    pushLayer('picker', hidePicker);
    poke();
    await loadMovies();
  }
  function hidePicker() {
    E.picker.hidden = true;
    // Возвращаем фокус туда, откуда открывали (важно при управлении с клавиатуры)
    const from = S.pickerFrom;
    S.pickerFrom = null;
    if (from && from.isConnected && from.focus && !touchInput()) from.focus({ preventScroll: true });
  }
  function closePicker() {
    if (E.picker.hidden) return;
    hidePicker();
    dropLayer('picker');
  }

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
    let focusRow = null;
    r.movies.forEach((m) => {
      const row = el('div', 'movie' + (m.id === cur ? ' current' : ''));
      // Строку можно выбрать и с клавиатуры или пульта: стрелки ↑/↓ и Enter
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      if (m.id === cur || !focusRow) focusRow = row;
      const info = el('div', 'mi');
      info.appendChild(el('div', 'mt', m.name));
      const meta = el('div', 'mm');
      meta.appendChild(el('span', null, fmtSize(m.size)));
      meta.appendChild(el('span', 'tag', m.ext.toUpperCase()));
      if (m.subs.length) meta.appendChild(el('span', 'tag', 'субтитры: ' + m.subs.map((s) => s.label).join(', ')));
      if (m.ext === 'mkv') meta.appendChild(el('span', 'tag warn', 'не откроется на iPhone, iPad и в Safari'));
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
      dl.addEventListener('keydown', (e) => e.stopPropagation());
      row.appendChild(info);
      row.appendChild(dl);
      const choose = () => { void act('setMovie', { id: m.id }); closePicker(); };
      row.addEventListener('click', choose);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });
      E.pickerList.appendChild(row);
    });
    // С клавиатуры и пульта сразу можно листать список (на сенсорном экране фокус не нужен)
    if (focusRow && !touchInput()) focusRow.focus({ preventScroll: false });
  }

  /** Стрелки ↑/↓ в окне выбора фильма переходят между строками. */
  function pickerKey(e) {
    if (e.key === 'Escape') { closePicker(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(E.pickerList.querySelectorAll('.movie'));
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i < 0 ? 0 : Math.min(rows.length - 1, i + 1)) : (i < 0 ? rows.length - 1 : Math.max(0, i - 1));
    /** @type {HTMLElement} */ (rows[next]).focus();
  }

  E.pickerClose.addEventListener('click', closePicker);
  E.pickerRefresh.addEventListener('click', loadMovies);
  E.picker.addEventListener('click', (e) => { if (e.target === E.picker) closePicker(); });

  // ================================================================ статус для остальных участников
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
      mobile: COARSE_MQ.matches,
      device: deviceKind(),
    };
    const key = JSON.stringify(st);
    const now = Date.now();
    if (!force && key === S.lastStatusKey && now - S.lastStatusAt < 5000) return;
    S.lastStatusKey = key;
    S.lastStatusAt = now;
    void act('status', { status: st });
  }

  // ================================================================ экран блокировки, уведомление, медиакнопки
  function setMediaSessionTitle(title) {
    if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function') return;
    try {
      navigator.mediaSession.metadata = title ? new window.MediaMetadata({
        title,
        artist: 'Together',
        artwork: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      }) : null;
    } catch (e) { /* ignore */ }
  }

  /** Сообщает системе, где сейчас фильм: полоса прогресса на экране блокировки и в уведомлении Android. */
  function updatePositionState() {
    S.lastPosStateAt = performance.now();
    const ms = navigator.mediaSession;
    if (!ms) return;
    try { ms.playbackState = S.room && S.sourceKey ? (S.room.playing ? 'playing' : 'paused') : 'none'; } catch (e) { /* ignore */ }
    if (typeof ms.setPositionState !== 'function') return;
    const d = video.duration;
    try {
      if (S.sourceKey && isFinite(d) && d > 0) {
        ms.setPositionState({ duration: d, playbackRate: video.playbackRate || 1, position: clamp(video.currentTime, 0, d) });
      } else {
        ms.setPositionState();
      }
    } catch (e) { /* ignore */ }
  }

  /** Медиакнопка может прийти дважды: клавишей и через системные медиа-кнопки — второй раз пропускаем. */
  function mediaOnce(fn) {
    const now = performance.now();
    if (now - S.lastMediaAt < 350) return;
    S.lastMediaAt = now;
    fn();
  }

  if ('mediaSession' in navigator) {
    const h = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* ignore */ } };
    h('play', () => mediaOnce(() => { if (S.room && !S.room.playing) userPlayPause(); }));
    h('pause', () => mediaOnce(() => { if (S.room && S.room.playing) userPlayPause(); }));
    h('stop', () => mediaOnce(() => { if (S.room && S.room.playing) userPlayPause(); }));
    h('seekbackward', (d) => mediaOnce(() => userSkip(-((d && d.seekOffset) || 10))));
    h('seekforward', (d) => mediaOnce(() => userSkip((d && d.seekOffset) || 10)));
    // Перетаскивание полосы на экране блокировки: всем уходит только итоговая позиция
    h('seekto', (d) => { if (d && isFinite(d.seekTime)) queueSeek(d.seekTime); });
  }

  // ================================================================ картинка в картинке
  // Фильм в маленьком окне поверх других программ: можно ответить в мессенджере и не ставить паузу всем.
  const PIP_STD = !!(document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function');
  const PIP_WEBKIT = !PIP_STD && typeof video.webkitSupportsPresentationMode === 'function' &&
    typeof video.webkitSetPresentationMode === 'function' && video.webkitSupportsPresentationMode('picture-in-picture');

  function inPip() {
    if (PIP_STD) return document.pictureInPictureElement === video;
    return PIP_WEBKIT && video.webkitPresentationMode === 'picture-in-picture';
  }

  function renderPip() {
    const on = inPip();
    E.pipBtn.hidden = !(PIP_STD || PIP_WEBKIT) || !S.sourceKey || !!S.mediaError;
    E.pipBtn.classList.toggle('on', on);
    E.pipNote.hidden = !on;
  }

  async function togglePip() {
    if (!(PIP_STD || PIP_WEBKIT)) { flash('Этот браузер не умеет «картинку в картинке»'); return; }
    if (!S.sourceKey || video.readyState < 1) { flash('Сначала выбери фильм'); return; }
    try {
      if (inPip()) {
        if (PIP_STD) await document.exitPictureInPicture();
        else video.webkitSetPresentationMode('inline');
        return;
      }
      // Из полноэкранного режима выходим, иначе на месте фильма останется чёрный экран
      if (isNativeFs()) await exitFullscreen();
      if (S.pseudoFs) { S.pseudoFs = false; updateImmersive(); }
      if (PIP_STD) await video.requestPictureInPicture();
      else video.webkitSetPresentationMode('picture-in-picture');
    } catch (e) {
      flash('Не получилось открыть отдельное окно');
    }
  }

  function leavePip() {
    try {
      if (PIP_STD && document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      else if (PIP_WEBKIT && inPip()) video.webkitSetPresentationMode('inline');
    } catch (e) { /* ignore */ }
  }

  video.addEventListener('enterpictureinpicture', renderPip);
  video.addEventListener('leavepictureinpicture', renderPip);
  video.addEventListener('webkitpresentationmodechanged', renderPip);
  E.pipBtn.addEventListener('click', togglePip);
  E.pipBack.addEventListener('click', togglePip);

  // ================================================================ кнопка «Назад» (Android, жест на iPhone, кнопка мыши)
  // Открытое окно, список участников или чат поверх фильма закрываются «Назадом», а не уводят со страницы.
  const layers = [];   // открытые слои по порядку: { name, close }
  let expectPop = 0;   // сколько событий popstate вызвали мы сами
  let backPending = 0; // сколько записей истории убрать одним шагом

  function pushLayer(name, close) {
    if (layers.some((l) => l.name === name)) return;
    // Без нажатия пользователя запись в историю не добавляем: Chrome такие записи пропускает
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    layers.push({ name, close });
    try { history.pushState({ tgLayer: true }, ''); } catch (e) { layers.pop(); }
  }

  /** Слой закрыли кнопкой на экране — убираем и его запись из истории. */
  function dropLayer(name) {
    const i = layers.findIndex((l) => l.name === name);
    if (i === -1) return;
    layers.splice(i, 1);
    if (!backPending) {
      setTimeout(() => {
        const n = backPending;
        backPending = 0;
        if (n) { expectPop++; history.go(-n); }
      }, 0);
    }
    backPending++;
  }

  window.addEventListener('popstate', () => {
    if (expectPop) { expectPop--; return; }
    const top = layers.pop();
    if (top) top.close();
  });

  // ================================================================ экранная клавиатура
  // Пока пишешь сообщение на телефоне или планшете, страница сжимается до видимой части над клавиатурой:
  // фильм остаётся на виду, а поле ввода — прямо над клавиатурой (iPhone сам так не делает).
  const VV = window.visualViewport;
  let kbBase = { land: null, h: 0 }; // высота без клавиатуры для текущей ориентации экрана

  function updateKeyboard() {
    if (!VV) return;
    const land = screenLandscape();
    if (kbBase.land !== land) kbBase = { land, h: 0 };
    const h = VV.height;
    kbBase.h = Math.max(kbBase.h, h);
    const open = COARSE_MQ.matches && document.activeElement === E.chatInput && VV.scale < 1.05 && h < kbBase.h - 80;
    const b = document.body.classList;
    if (open) {
      const root = document.documentElement.style;
      root.setProperty('--vvh', Math.round(h) + 'px');
      root.setProperty('--vvt', Math.round(VV.offsetTop) + 'px');
    }
    if (b.contains('kb-open') !== open) {
      b.toggle('kb-open', open);
      if (!open) window.scrollTo(0, 0); // iPhone иногда оставляет страницу сдвинутой после клавиатуры
    }
  }
  if (VV) {
    VV.addEventListener('resize', updateKeyboard);
    VV.addEventListener('scroll', updateKeyboard);
  }
  E.chatInput.addEventListener('focus', updateKeyboard);
  E.chatInput.addEventListener('blur', () => setTimeout(updateKeyboard, 0));

  // ================================================================ экран не гаснет во время фильма
  // Браузер разрешает это только по HTTPS и на localhost (у хозяина), в остальных случаях экран держит само видео.
  let wakeLock = null;
  let wakePending = false;
  const wantWake = () => !document.hidden && !!S.room && !!S.sourceKey && (S.room.playing || S.room.autoPaused);

  function updateWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (wantWake()) {
      if (wakeLock || wakePending) return;
      wakePending = true;
      navigator.wakeLock.request('screen').then((lock) => {
        wakePending = false;
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
        if (!wantWake()) updateWakeLock();
      }, () => { wakePending = false; });
    } else if (wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      lock.release().catch(() => {});
    }
  }

  // ================================================================ субтитры не прячутся под панелью
  /**
   * Строка субтитров. tgAuto — положение строки выбирает браузер (в файле оно не задано), значит, её можно двигать.
   * @typedef {VTTCue & {tgAuto?: boolean}} MovableCue
   */
  /** @type {number|'auto'} */
  let cueLine = 'auto';

  /** Пока панель управления видна, строки субтитров приподнимаются над ней. */
  function placeCues(force) {
    const tt = video.textTracks;
    if (!tt || !tt.length) return;
    /** @type {number|'auto'} */
    let want = 'auto';
    if (!document.body.classList.contains('idle') && S.sourceKey) {
      const stage = E.stage.getBoundingClientRect();
      const ctl = stage.bottom - E.scrub.getBoundingClientRect().top; // высота нижней части панели
      const lineH = stage.height * 0.06;                               // строка субтитров ≈ 6% высоты кадра
      if (lineH > 0 && ctl > 0) {
        const n = Math.ceil(ctl / lineH) + 1;
        if (n <= 6) want = -n; // на совсем маленьком кадре не поднимаем — некуда
      }
    }
    if (want === cueLine && !force) return;
    cueLine = want;
    for (let i = 0; i < tt.length; i++) {
      const track = tt[i];
      const cues = track.mode === 'showing' ? track.cues : null;
      if (!cues) continue;
      let moved = false;
      for (let j = 0; j < cues.length; j++) {
        const c = /** @type {MovableCue} */ (cues[j]);
        if (c.tgAuto == null) c.tgAuto = c.line === 'auto'; // положение, заданное в самом файле, не трогаем
        if (c.tgAuto && c.line !== want) { c.line = want; moved = true; }
      }
      // Строку, которая уже на экране, браузер сам не перерисует — переставляем её заново
      if (moved && track.activeCues) {
        /** @type {MovableCue[]} */ (Array.from(track.activeCues)).forEach((c) => {
          if (!c.tgAuto) return;
          try { track.removeCue(c); track.addCue(c); } catch (e) { /* ignore */ }
        });
      }
    }
  }

  // ================================================================ сенсорный экран или мышь
  function applyInputMode() {
    document.body.classList.toggle('touch-ui', COARSE_MQ.matches);
    placeCues(true);
  }
  onMedia(COARSE_MQ, () => { applyInputMode(); updateImmersive(); sendStatus(true); });

  // ================================================================ вход
  function setToken(t) {
    S.token = t;
    S.authed = true;
    store.set('tg_token', t);
  }

  function showLogin(errText) {
    E.app.hidden = true;
    E.login.hidden = false;
    document.body.classList.remove('in-app', 'immersive', 'native-fs', 'chat-open', 'chat-away', 'idle', 'kb-open');
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
    layers.length = 0;
    hidePicker();
    hidePeople();
    showLogin('Нужно войти заново (возможно, поменялся пароль комнаты)');
  }

  E.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const showErr = (t) => { E.loginError.textContent = t; E.loginError.hidden = false; };
    const name = E.nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) { showErr('Напиши имя — его увидят остальные'); E.nameInput.focus(); return; }
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
    renderChatState();
    void syncClock();
    setInterval(syncClock, 60000);
    setInterval(tick, 250);
    setInterval(() => sendStatus(false), 1000);
  }

  document.addEventListener('visibilitychange', () => {
    updateWakeLock();
    if (document.hidden || !S.started || !S.authed) return;
    void syncClock();
    if (!S.es || S.es.readyState === 2) connect();
    applyRoom();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && S.started && S.authed) connect(); });

  async function boot() {
    fillIcons(document);
    applyInputMode();
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

  void boot();
})();
