/* =====================================================================
 *  Šílená kuchyně 3D – klient (Three.js + Socket.io + Web Audio)
 *  Žádné externí modely, obrázky ani zvuky: vše se staví a syntetizuje v kódu.
 *  Stejný soubor běží na Renderu i na itch.io (server má absolutní adresu).
 * ===================================================================== */
(() => {
'use strict';

// Adresa herního serveru na Renderu. Díky ní funguje klient i hostovaný jinde (itch.io).
const SERVER_URL = 'https://threedvareni.onrender.com';

const LIBS = {
  three: [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
  ],
  io: [
    'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js',
    'https://cdn.jsdelivr.net/npm/socket.io-client@4.7.5/dist/socket.io.min.js',
    SERVER_URL + '/socket.io/socket.io.js',
  ],
};

const $ = (id) => document.getElementById(id);

// Hned na začátku "probudíme" server na Renderu (free plán usíná), ať se nečeká zbytečně.
try { fetch(SERVER_URL + '/healthz', { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (e) { /* nic */ }

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error(url)); };
    document.head.appendChild(s);
  });
}
async function loadFirst(urls, ready) {
  for (const u of urls) {
    try { await loadScript(u); if (ready()) return true; } catch (e) { /* zkus další zdroj */ }
  }
  return false;
}

(async () => {
  const ok = (await loadFirst(LIBS.three, () => !!window.THREE)) && (await loadFirst(LIBS.io, () => typeof window.io === 'function'));
  if (!ok) {
    const st = $('netStatus');
    if (st) { st.textContent = 'Nepodařilo se načíst knihovny (Three.js / Socket.io). Zkontroluj připojení a obnov stránku.'; st.className = 'net bad'; }
    return;
  }
  start();
})();

function start() {
const THREE = window.THREE;

/* ---------------------------------------------------------------------
 *  Konstanty (shodné se serverem)
 * ------------------------------------------------------------------- */
const COLS = 16, ROWS = 10;
const SPEED = 4.6, HALF = 0.3, REACH = 0.75;
const TOP = 0.98;                                   // výška pracovních desek
const NAMES = { bun: 'Houska', meat: 'Maso', cheese: 'Sýr', lettuce: 'Salát', tomato: 'Rajče' };
const ICONS = { bun: '🍞', meat: '🥩', cheese: '🧀', lettuce: '🥬', tomato: '🍅' };
const CRATE = { B: 'bun', M: 'meat', S: 'cheese', L: 'lettuce', T: 'tomato' };
const PLATE_STATE = { bun: 'raw', meat: 'cooked', cheese: 'raw', lettuce: 'chopped', tomato: 'chopped' };

const canvas = $('game');

/* ---------------------------------------------------------------------
 *  Zvuky (Web Audio API)
 * ------------------------------------------------------------------- */
const Sound = (() => {
  let ac = null;
  let muted = false;
  try { muted = localStorage.getItem('kuchyne-muted') === '1'; } catch (e) { /* nic */ }
  const lastPlayed = {};
  const MIN_GAP = { chop: 70, wash: 110, warn: 700, pick: 40, drop: 40, tick: 300 };

  function init() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume();
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ac || muted) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(dur, vol, freq, delay) {
    if (!ac || muted) return;
    const t0 = ac.currentTime + (delay || 0);
    const n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.1;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(ac.destination);
    src.start(t0);
  }
  const FX = {
    chop() { noise(0.05, 0.16, 2000); tone(780, 0.05, 'square', 0.05, 420); },   // pípnutí při krájení
    pick() { tone(520, 0.07, 'sine', 0.12, 800); },
    drop() { tone(430, 0.08, 'sine', 0.12, 260); },
    serve() {                                                                      // cinknutí při odevzdání
      tone(1318, 0.55, 'sine', 0.17); tone(1760, 0.8, 'sine', 0.13, null, 0.09); tone(2637, 0.6, 'triangle', 0.05, null, 0.09);
    },
    no() { tone(160, 0.2, 'sawtooth', 0.09, 100); },
    done() { tone(880, 0.12, 'triangle', 0.13); tone(1175, 0.2, 'triangle', 0.13, null, 0.1); },
    warn() { tone(1000, 0.09, 'square', 0.07); tone(1000, 0.09, 'square', 0.07, null, 0.15); },
    burn() { tone(300, 0.55, 'sawtooth', 0.11, 70); noise(0.4, 0.1, 500); },
    trash() { noise(0.25, 0.12, 700); tone(230, 0.15, 'sine', 0.08, 90); },
    wash() { noise(0.12, 0.07, 3200); },
    order() { tone(660, 0.12, 'sine', 0.1); tone(990, 0.2, 'sine', 0.1, null, 0.11); },
    expire() { tone(260, 0.4, 'sawtooth', 0.11, 120); },
    tick() { tone(900, 0.05, 'square', 0.045); },
    count() { tone(520, 0.14, 'sine', 0.13); },
    go() { tone(784, 0.3, 'triangle', 0.14); tone(1175, 0.45, 'triangle', 0.14, null, 0.13); },
    end() { tone(660, 0.25, 'triangle', 0.13); tone(520, 0.25, 'triangle', 0.13, null, 0.22); tone(392, 0.5, 'triangle', 0.13, null, 0.44); },
  };
  return {
    init,
    play(name) {
      if (!ac || muted || !FX[name]) return;
      const now = performance.now();
      if (lastPlayed[name] && now - lastPlayed[name] < (MIN_GAP[name] || 0)) return;
      lastPlayed[name] = now;
      FX[name]();
    },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('kuchyne-muted', muted ? '1' : '0'); } catch (e) { /* nic */ }
      return muted;
    },
    isMuted: () => muted,
  };
})();

/* ---------------------------------------------------------------------
 *  Stav klienta
 * ------------------------------------------------------------------- */
let view = 'menu';              // menu | lobby | game | end
let myId = null;
let roomInfo = null;
let map = null;                 // pole řetězců ze serveru
let recipes = {};
let snap = null;                // poslední snapshot ze serveru
let me = null;                  // předpovídaná pozice lokálního hráče
const actors = new Map();       // všichni kuchaři (vyhlazené pozice)
let floaters = [];
let lastCd = null, lastTick = null;
let gameMode = 'classic', dayNo = 1;   // režim aktuální hry
let menuMode = 'classic';               // režim vybraný v menu
let shopData = null;

/* ---------------------------------------------------------------------
 *  Socket + stav připojení
 * ------------------------------------------------------------------- */
const socket = window.io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
const sameOrigin = location.origin === SERVER_URL;
let connected = false;

function setNet(kind, text) {
  const st = $('netStatus');
  st.textContent = text;
  st.className = 'net ' + kind;
  $('createBtn').disabled = !connected;
  $('joinBtn').disabled = !connected;
  $('soloBtn').disabled = !connected;
}
setNet('wait', '⏳ Připojuji k serveru… (první start na Renderu může trvat až minutu)');
socket.on('connect', () => { connected = true; setNet('ok', '✅ Připojeno k serveru'); });
socket.on('connect_error', () => { connected = false; setNet('wait', '⏳ Server se probouzí… ještě chvilku strpení'); });

// V iframe (itch.io) nemusí být replaceState povolen – chyby ignorujeme.
function setUrl(url) { try { history.replaceState(null, '', url); } catch (e) { /* nic */ } }

/* ---------------------------------------------------------------------
 *  Přepínání obrazovek, toast
 * ------------------------------------------------------------------- */
function setView(v) {
  view = v;
  $('menu').classList.toggle('hidden', v !== 'menu');
  $('lobby').classList.toggle('hidden', v !== 'lobby');
  if (v !== 'game') releaseMouse();
  updateLockHint();
  $('gameWrap').classList.toggle('hidden', !(v === 'game' || v === 'end' || v === 'shop'));
  $('endScreen').classList.toggle('hidden', v !== 'end');
  $('shopScreen').classList.toggle('hidden', v !== 'shop');
  if (v === 'game' || v === 'end' || v === 'shop') resize();
}

let toastTimer = null;
function toast(msg, bad) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
}

/* ---------------------------------------------------------------------
 *  Menu a lobby
 * ------------------------------------------------------------------- */
const nameInput = $('nameInput'), codeInput = $('codeInput');
try { nameInput.value = localStorage.getItem('kuchyne-name') || ''; } catch (e) { /* nic */ }
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) codeInput.value = urlRoom.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

function getName() {
  const n = nameInput.value.trim();
  try { localStorage.setItem('kuchyne-name', n); } catch (e) { /* nic */ }
  return n;
}
function menuError(m) { $('menuError').textContent = m || ''; }

const MODE_INFO = {
  classic: 'Klasika: jedno kolo 180 s, hrajete o týmové skóre.',
  days: 'Dny: každý den 120 s. Suroviny se spotřebovávají, mezi dny je objednáváš za peníze z objednávek a platíš nájem.',
};
function paintModes() {
  $('modeClassic').classList.toggle('active', menuMode === 'classic');
  $('modeDays').classList.toggle('active', menuMode === 'days');
  $('modeInfo').textContent = MODE_INFO[menuMode];
}
$('modeClassic').onclick = () => { menuMode = 'classic'; paintModes(); };
$('modeDays').onclick = () => { menuMode = 'days'; paintModes(); };
paintModes();

$('createBtn').onclick = () => {
  Sound.init(); menuError('');
  socket.emit('create', { name: getName(), mode: menuMode });
};
$('soloBtn').onclick = () => {
  Sound.init(); menuError('');
  socket.emit('create', { name: getName(), mode: menuMode, solo: true });
};
$('joinBtn').onclick = () => {
  Sound.init(); menuError('');
  const code = codeInput.value.trim();
  if (!code) return menuError('Zadej kód místnosti, nebo vytvoř novou.');
  socket.emit('join', { name: getName(), code });
};
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value.trim() ? $('joinBtn') : $('createBtn')).click(); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') codeInput.focus(); });

function leaveRoom() {
  socket.emit('leave');
  roomInfo = null; myId = null; snap = null; me = null;
  clearActors();
  setUrl(location.pathname);
  setView('menu');
}
$('leaveLobby').onclick = leaveRoom;
$('leaveGame').onclick = leaveRoom;
$('endLeaveBtn').onclick = leaveRoom;
$('startBtn').onclick = () => { Sound.init(); socket.emit('start'); };
$('againBtn').onclick = () => { Sound.init(); socket.emit('start'); };
$('toLobbyBtn').onclick = () => socket.emit('toLobby');
$('muteBtn').textContent = Sound.isMuted() ? '🔇' : '🔊';
$('muteBtn').onclick = () => { $('muteBtn').textContent = Sound.toggle() ? '🔇' : '🔊'; Sound.init(); };
$('copyLink').onclick = () => {
  if (!roomInfo) return;
  // Na vlastní adrese serveru kopírujeme odkaz, jinde (itch.io) jen kód místnosti.
  const text = sameOrigin ? location.origin + '/?room=' + roomInfo.code : roomInfo.code;
  const done = () => toast(sameOrigin ? 'Odkaz zkopírován – pošli ho kamarádům!' : 'Kód ' + text + ' zkopírován – pošli ho kamarádům!');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Kód místnosti: ' + roomInfo.code));
  else toast('Kód místnosti: ' + roomInfo.code);
};

$('lobbyClassic').onclick = () => socket.emit('setMode', { mode: 'classic' });
$('lobbyDays').onclick = () => socket.emit('setMode', { mode: 'days' });

function renderLobby(info) {
  $('roomCode').textContent = info.code;
  const isHost = info.host === myId;
  $('lobbyClassic').classList.toggle('active', info.mode === 'classic');
  $('lobbyDays').classList.toggle('active', info.mode === 'days');
  $('lobbyClassic').disabled = !isHost;
  $('lobbyDays').disabled = !isHost;
  $('lobbyModeInfo').textContent = MODE_INFO[info.mode] + (isHost ? '' : ' (režim volí hostitel)');
  const ul = $('playerList');
  ul.innerHTML = '';
  info.players.forEach((p) => {
    const li = document.createElement('li');
    const hat = document.createElement('span');
    hat.className = 'hat';
    hat.style.background = p.c;
    const nm = document.createElement('span');
    nm.textContent = p.n + (p.id === myId ? ' (ty)' : '');
    li.appendChild(hat); li.appendChild(nm);
    ul.appendChild(li);
  });
  for (let i = info.players.length; i < info.max; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Čeká se na hráče…';
    ul.appendChild(li);
  }
  const ok = info.players.length >= info.min;
  $('startBtn').disabled = !ok;
  $('lobbyHint').textContent = ok
    ? 'Můžete začít – ostatní se mohou připojit ještě před startem.'
    : 'Pro start jsou potřeba aspoň ' + info.min + ' hráči (zatím ' + info.players.length + ').';
}

socket.on('joined', (d) => {
  myId = d.id;
  setUrl('?room=' + d.code);
  setView('lobby');
});

socket.on('room', (info) => {
  roomInfo = info;
  if (info.state === 'lobby' && (view === 'end' || view === 'game' || view === 'shop')) setView('lobby');
  if (view === 'lobby') renderLobby(info);
  if (view === 'end') $('againBtn').disabled = info.players.length < info.min;
  updateRoomLabel();
});

socket.on('err', (d) => { menuError(d.m); toast(d.m, true); });

socket.on('disconnect', () => {
  connected = false;
  setNet('wait', '⏳ Spojení přerušeno, zkouším se znovu připojit…');
  toast('Spojení se serverem bylo přerušeno.', true);
  roomInfo = null; myId = null; snap = null; me = null;
  clearActors();
  setView('menu');
});

socket.on('gameStart', (d) => {
  map = d.map; recipes = d.recipes;
  gameMode = d.mode || 'classic'; dayNo = d.day || 1;
  snap = null; me = null; floaters.forEach((f) => f.el.remove()); floaters = [];
  clearActors();
  lastCd = null; lastTick = null;
  buildKitchen();
  resetKeys();
  $('countdown').classList.add('hidden');
  $('goText').classList.remove('show');
  clearOrders();
  updateRoomLabel();
  setView('game');
});

socket.on('gameEnd', (r) => {
  resetKeys();
  const days = r.mode === 'days';
  $('endTitle').textContent = days ? 'Restaurace zavřela' : 'Konec směny!';
  $('endLabel').textContent = days ? 'Přežité dny' : 'Týmové skóre';
  $('stars').textContent = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  $('endScore').textContent = days ? r.days : r.score;
  $('endStats').textContent = days
    ? r.reason + '  ·  Odevzdaná jídla: ' + r.delivered + '  ·  Propadlé: ' + r.expired + '  ·  Zbylo: ' + r.money + ' Kč'
    : 'Odevzdaná jídla: ' + r.delivered + '  ·  Propadlé objednávky: ' + r.expired;
  $('againBtn').disabled = !roomInfo || roomInfo.players.length < roomInfo.min;
  setView('end');
});

/* ---------------------------------------------------------------------
 *  Obchod mezi dny (režim „Dny“)
 * ------------------------------------------------------------------- */
const SHOP_ORDER = ['bun', 'meat', 'cheese', 'lettuce', 'tomato'];

socket.on('shop', (d) => {
  shopData = d;
  if (view !== 'shop') { resetKeys(); setView('shop'); }
  renderShop(d);
});

function renderShop(d) {
  const sm = d.summary;
  $('shopTitle').textContent = sm ? 'Den ' + sm.day + ' skončil' : 'Objednávka surovin';
  $('shopSummary').textContent = sm
    ? 'Výdělek ' + (sm.net >= 0 ? '+' : '') + sm.net + ' Kč  ·  Nájem −' + sm.rent + ' Kč  ·  Odevzdáno ' + sm.delivered + '  ·  Propadlo ' + sm.expired
    : '';
  $('shopMoney').textContent = d.money;
  $('shopRent').textContent = 'Nájem za den ' + d.day + ': ' + d.rent + ' Kč – nech si na něj!';
  const box = $('shopItems');
  box.innerHTML = '';
  SHOP_ORDER.forEach((k) => {
    const have = d.stock[k] || 0, price = d.prices[k];
    const row = document.createElement('div');
    row.className = 'shoprow';
    const nm = document.createElement('span');
    nm.className = 'sname'; nm.textContent = ICONS[k] + ' ' + NAMES[k];
    const st = document.createElement('span');
    st.className = 'sstock' + (have === 0 ? ' zero' : ''); st.textContent = 'sklad ' + have;
    const pr = document.createElement('span');
    pr.className = 'sprice'; pr.textContent = price + ' Kč';
    row.append(nm, st, pr);
    [1, 5].forEach((n) => {
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = '+' + n;
      b.disabled = price * n > d.money || have + n > d.cap;
      b.onclick = () => { Sound.init(); socket.emit('buy', { k, n }); };
      row.appendChild(b);
    });
    box.appendChild(row);
  });
  const mine = d.ready.includes(myId);
  $('readyBtn').textContent = mine ? '✔ Připraven (zrušit)' : 'Připraven na den ' + d.day;
  $('readyBtn').classList.toggle('primary', !mine);
  $('shopReady').textContent = d.players > 1 ? 'Připraveno ' + d.ready.length + ' / ' + d.players + ' – den začne, až budou všichni.' : '';
}
$('readyBtn').onclick = () => { Sound.init(); socket.emit('ready'); };
$('shopLeave').onclick = leaveRoom;

function updateRoomLabel() {
  let t = roomInfo ? 'MÍSTNOST ' + roomInfo.code : '';
  if (gameMode === 'days') t += '  ·  DEN ' + dayNo;
  $('roomLbl').textContent = t;
}

/* ---------------------------------------------------------------------
 *  Vstup: klávesnice + myš (pohled z první osoby)
 * ------------------------------------------------------------------- */
const KEYMAP = { KeyW: 'U', ArrowUp: 'U', KeyS: 'D', ArrowDown: 'D', KeyA: 'L', KeyD: 'R' };   // chůze / úkrok
const TURN = { ArrowLeft: 1, ArrowRight: -1 };                                                  // otáčení šipkami
const keys = new Set();
const turnKeys = new Set();
let holdKey = false, holdMouse = false;
let lastSent = { dx: 0, dy: 0, fx: 0, fy: 1, hold: false };
let lastSendT = 0;
const holdNow = () => holdKey || holdMouse;

// směr chůze a pohledu ve světových souřadnicích (x, z)
function currentInput() {
  const fwd = (keys.has('U') ? 1 : 0) - (keys.has('D') ? 1 : 0);
  const str = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
  const fx = Math.sin(yaw), fy = Math.cos(yaw);
  const rx = -Math.cos(yaw), ry = Math.sin(yaw);
  let dx = fwd * fx + str * rx, dy = fwd * fy + str * ry;
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  return { dx, dy, fx, fy };
}
const r3 = (n) => Math.round(n * 1000) / 1000;

function sendInput(force) {
  const v = currentInput(), h = holdNow();
  const changed = Math.abs(v.dx - lastSent.dx) > 0.001 || Math.abs(v.dy - lastSent.dy) > 0.001 ||
    Math.abs(v.fx - lastSent.fx) > 0.01 || Math.abs(v.fy - lastSent.fy) > 0.01 || h !== lastSent.hold;
  if (!changed) return;
  const now = performance.now();
  if (!force && now - lastSendT < 50) return;
  lastSendT = now;
  lastSent = { dx: r3(v.dx), dy: r3(v.dy), fx: r3(v.fx), fy: r3(v.fy), hold: h };
  socket.emit('input', lastSent);
}
function resetKeys() {
  keys.clear(); turnKeys.clear(); holdKey = false; holdMouse = false;
  sendInput(true);
}
function press() { sendInput(true); socket.emit('press'); }

window.addEventListener('keydown', (e) => {
  if (view !== 'game') return;
  if (KEYMAP[e.code]) { e.preventDefault(); keys.add(KEYMAP[e.code]); sendInput(true); return; }
  if (TURN[e.code]) { e.preventDefault(); turnKeys.add(e.code); return; }
  if (e.code === 'Space' || e.code === 'KeyE') {
    e.preventDefault();
    Sound.init();
    if (!e.repeat) { holdKey = true; sendInput(true); press(); }
  }
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) { keys.delete(KEYMAP[e.code]); sendInput(true); }
  if (TURN[e.code]) turnKeys.delete(e.code);
  if (e.code === 'Space' || e.code === 'KeyE') { holdKey = false; sendInput(true); }
});
window.addEventListener('blur', resetKeys);

// myš: pointer lock (klik do hry); když ho prostředí nepovolí, jde se rozhlížet tažením
const locked = () => document.pointerLockElement === canvas;
let dragging = false;
function updateLockHint() { $('lockHint').classList.toggle('hidden', view !== 'game' || locked()); }
document.addEventListener('pointerlockchange', () => { updateLockHint(); if (!locked()) { holdMouse = false; sendInput(true); } });
canvas.addEventListener('mousedown', (e) => {
  if (view !== 'game' || e.button !== 0) return;
  Sound.init();
  if (!locked()) {
    dragging = true;
    try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* nic */ }
    return;
  }
  holdMouse = true; sendInput(true); press();      // levé tlačítko = interakce (jako E)
});
window.addEventListener('mouseup', () => { dragging = false; if (holdMouse) { holdMouse = false; sendInput(true); } });
window.addEventListener('mousemove', (e) => {
  if (view !== 'game' || !(locked() || dragging)) return;
  yaw -= (e.movementX || 0) * 0.0024;
  pitch = Math.max(-1.35, Math.min(1.2, pitch - (e.movementY || 0) * 0.0024));
});
function releaseMouse() { dragging = false; try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { /* nic */ } }

/* ---------------------------------------------------------------------
 *  Pohyb (predikce lokálního hráče – stejná pravidla jako na serveru)
 * ------------------------------------------------------------------- */
const isSolid = (x, y) => !map || y < 0 || y >= ROWS || x < 0 || x >= COLS || map[y][x] !== '.';

function blocked(x, y) {
  const x0 = Math.floor(x - HALF), x1 = Math.floor(x + HALF);
  const y0 = Math.floor(y - HALF), y1 = Math.floor(y + HALF);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(tx, ty)) return true;
  return false;
}
function moveBy(o, dx, dy) {
  if (!blocked(o.x + dx, o.y)) o.x += dx;
  if (!blocked(o.x, o.y + dy)) o.y += dy;
}
const targetTile = (o) => [Math.floor(o.x + o.fx * REACH), Math.floor(o.y + o.fy * REACH)];

/* ---------------------------------------------------------------------
 *  Příjem stavu ze serveru
 * ------------------------------------------------------------------- */
socket.on('state', (s) => {
  if (!map) return;
  snap = s;
  const seen = new Set();
  for (const p of s.pl) {
    seen.add(p.id);
    let a = actors.get(p.id);
    if (!a) { a = { id: p.id, x: p.x, y: p.y, phase: 0, moving: false, ang: Math.atan2(p.fx, p.fy) }; actors.set(p.id, a); }
    a.n = p.n; a.c = p.c; a.tx = p.x; a.ty = p.y; a.fx = p.fx; a.fy = p.fy; a.h = p.h;
    if (p.id === myId) reconcile(p);
  }
  for (const id of [...actors.keys()]) if (!seen.has(id)) removeActor(id);

  handleEvents(s.ev || []);
  if (s.cd > 0) {
    const c = Math.ceil(s.cd);
    if (c !== lastCd) { lastCd = c; Sound.play('count'); }
  } else if (s.t > 0 && s.t <= 10) {
    const c = Math.ceil(s.t);
    if (c !== lastTick) { lastTick = c; Sound.play('tick'); }
  }
  updateHud();
});

function reconcile(p) {
  if (!me) { me = { x: p.x, y: p.y, fx: p.fx, fy: p.fy }; yaw = Math.atan2(p.fx, p.fy); return; }
  const err = Math.hypot(p.x - me.x, p.y - me.y);
  const v = currentInput();
  const moving = Math.hypot(v.dx, v.dy) > 0.01;
  if (err > 1.5 || snap.cd > 0) { me.x = p.x; me.y = p.y; }
  else if (!moving && err > 0.001) { me.x += (p.x - me.x) * 0.3; me.y += (p.y - me.y) * 0.3; }
  else if (moving && err > 0.6) { me.x += (p.x - me.x) * 0.15; me.y += (p.y - me.y) * 0.15; }
}

function handleEvents(list) {
  for (const e of list) {
    switch (e.e) {
      case 'serve': Sound.play('serve'); float(e.x, 1.5, e.y, '+' + e.v + (gameMode === 'days' ? ' Kč' : ''), '#8dff9f'); break;
      case 'no': Sound.play('no'); if (e.m) float(e.x, 1.5, e.y, e.m, '#ff9a90'); break;
      case 'expire': Sound.play('expire'); floatFixed('Objednávka propadla!  −5' + (gameMode === 'days' ? ' Kč' : ''), '#ff9a90'); break;
      case 'go': {
        Sound.play('go');
        const g = $('goText');
        g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
        break;
      }
      default: Sound.play(e.e);
    }
  }
}

/* =====================================================================
 *  3D scéna
 * ===================================================================== */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x120a06);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x120a06, 22, 44);
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(camera);
const EYE = 1.6;
let yaw = 0, pitch = -0.25;       // yaw 0 = pohled na +z (dolů po mapě); doleva = přibývá
const fpHeld = new THREE.Group(); // předmět v ruce, připevněný ke kameře
fpHeld.position.set(0.32, -0.38, -0.8);
fpHeld.rotation.set(0.25, -0.35, 0);
camera.add(fpHeld);
let fpSig = '';

scene.add(new THREE.HemisphereLight(0xfff2dd, 0x6a5646, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 0.75);
sun.position.set(4, 14, 9);
sun.target.position.set(8, 0, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);

function resize() {
  const wrap = $('gameWrap');
  const w = Math.max(320, wrap.clientWidth || window.innerWidth);
  const h = Math.max(240, wrap.clientHeight || window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { if (view === 'game' || view === 'end' || view === 'shop') resize(); });

/* ---------- pomocníci pro tvorbu mesh ---------- */
const matCache = {}, geoCache = {};
const mat = (c, o) => {
  const k = c + (o ? JSON.stringify(o) : '');
  return matCache[k] || (matCache[k] = new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {})));
};
function geo(kind, ...a) {
  const k = kind + a.join(',');
  return geoCache[k] || (geoCache[k] = new THREE[kind + 'Geometry'](...a));
}
function M(g, color, x, y, z, parent, o) {
  const m = new THREE.Mesh(g, mat(color, o && o.mat));
  m.position.set(x, y, z);
  m.castShadow = !(o && o.noShadow);
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
function clearGroup(g) { while (g.children.length) g.remove(g.children[0]); }

function labelSprite(text, color, w) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px "Trebuchet MS","Segoe UI",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,.85)'; x.strokeText(text, 128, 34);
  x.fillStyle = color || '#fff'; x.fillText(text, 128, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  const k = w || 1;
  sp.scale.set(k, k / 4, 1);
  sp.renderOrder = 10;
  return sp;
}

/* ---------- suroviny a talíře ---------- */
function makeIng(k, s) {
  const g = new THREE.Group();
  if (k === 'bun') {
    M(geo('Cylinder', 0.5, 0.46, 0.2, 18), '#c98a3e', 0, 0.1, 0, g);
    const top = M(geo('Sphere', 0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#ebb460', 0, 0.2, 0, g);
    top.scale.y = 0.85;
    [[-0.22, -0.1], [0.12, -0.22], [0.26, 0.1], [-0.1, 0.2], [0.02, 0]].forEach((q) => {
      const r2 = q[0] * q[0] + q[1] * q[1];
      const y = 0.2 + 0.85 * Math.sqrt(Math.max(0, 0.25 - r2)) + 0.01;
      const sm = M(geo('Sphere', 0.04, 6, 4), '#fff3d6', q[0], y, q[1], g, { noShadow: true });
      sm.scale.y = 0.5;
    });
  } else if (k === 'meat') {
    if (s === 'raw') {
      M(geo('Box', 0.84, 0.2, 0.6), '#c4453f', 0, 0.1, 0, g);
      M(geo('Box', 0.34, 0.03, 0.18), '#f0a79f', -0.1, 0.21, -0.05, g, { noShadow: true }).rotation.y = 0.4;
    } else if (s === 'chopped') {
      M(geo('Cylinder', 0.42, 0.42, 0.14, 16), '#e8837a', 0, 0.07, 0, g);
      for (let i = -1; i <= 1; i++) M(geo('Box', 0.6, 0.01, 0.04), '#b5524b', 0, 0.145, i * 0.14, g, { noShadow: true });
    } else if (s === 'cooked') {
      M(geo('Cylinder', 0.42, 0.42, 0.16, 16), '#80502a', 0, 0.08, 0, g);
      for (let i = -1; i <= 1; i++) M(geo('Box', 0.6, 0.01, 0.05), '#4a290f', 0, 0.165, i * 0.14, g, { noShadow: true }).rotation.y = 0.5;
    } else {
      M(geo('Cylinder', 0.42, 0.42, 0.16, 16), '#262321', 0, 0.08, 0, g);
      M(geo('Sphere', 0.1, 6, 4), '#46413d', -0.12, 0.17, -0.08, g, { noShadow: true });
      M(geo('Sphere', 0.07, 6, 4), '#3a3532', 0.14, 0.16, 0.1, g, { noShadow: true });
    }
  } else if (k === 'cheese') {
    const c = M(geo('Box', 0.92, 0.07, 0.92), '#f6c73c', 0, 0.035, 0, g);
    c.rotation.y = 0.35;
    [[-0.2, -0.15], [0.2, 0.12], [0, 0.28]].forEach((q) => {
      const h = M(geo('Cylinder', 0.07, 0.07, 0.01, 8), '#d9a21b', q[0], 0.075, q[1], g, { noShadow: true });
      h.rotation.y = 0.35;
    });
  } else if (k === 'lettuce') {
    if (s === 'raw') {
      [[-0.22, 0.05, '#4fa63d'], [0.22, 0.05, '#5fb94a'], [0, -0.18, '#78cf5c']].forEach((q) => {
        const b = M(geo('Sphere', 0.3, 10, 8), q[2], q[0], 0.26, q[1], g);
        b.scale.y = 0.9;
      });
    } else {
      [[-0.3, -0.2, 0.3], [0.15, -0.3, -0.6], [0.3, 0.1, 0.8], [-0.1, 0.1, -0.2], [-0.3, 0.3, 0.5], [0.05, 0.32, -0.9]].forEach((q, i) => {
        const l = M(geo('Box', 0.34, 0.05, 0.2), i % 2 ? '#8bd16a' : '#74c256', q[0], 0.03 + (i % 3) * 0.03, q[1], g);
        l.rotation.y = q[2];
      });
    }
  } else if (k === 'tomato') {
    if (s === 'raw') {
      M(geo('Sphere', 0.38, 14, 10), '#e53935', 0, 0.36, 0, g);
      M(geo('Cone', 0.14, 0.1, 6), '#3c9d3c', 0, 0.75, 0, g, { noShadow: true });
    } else {
      [[-0.28, -0.15], [0.28, -0.1], [0, 0.3]].forEach((q) => {
        M(geo('Cylinder', 0.23, 0.23, 0.07, 14), '#e53935', q[0], 0.035, q[1], g);
        M(geo('Cylinder', 0.15, 0.15, 0.01, 12), '#ff8a80', q[0], 0.075, q[1], g, { noShadow: true });
      });
    }
  }
  return g;
}

const PLATE_LAYOUT = {
  1: [[0, 0]],
  2: [[-0.38, 0], [0.38, 0]],
  3: [[-0.38, -0.3], [0.38, -0.3], [0, 0.4]],
  4: [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]],
};
function makePlate(content, dirty) {
  const g = new THREE.Group();
  M(geo('Cylinder', 0.5, 0.42, 0.05, 24), dirty ? '#cbbf9b' : '#f4f6f8', 0, 0.025, 0, g);
  M(geo('Cylinder', 0.33, 0.33, 0.012, 24), dirty ? '#8e8461' : '#d5dde2', 0, 0.056, 0, g, { noShadow: true });
  const n = content ? content.length : 0;
  if (n) {
    const L = PLATE_LAYOUT[Math.min(n, 4)];
    const sz = n === 1 ? 0.62 : n === 2 ? 0.48 : 0.4;
    content.forEach((k, i) => {
      const it = makeIng(k, PLATE_STATE[k]);
      it.scale.setScalar(sz);
      it.position.set(L[i][0] * 0.5, 0.06, L[i][1] * 0.5);
      g.add(it);
    });
  }
  return g;
}
// item = { t:'i', k, s } nebo { t:'p', c:[...] }
function makeItem(item) {
  if (item.t === 'p') { const p = makePlate(item.c, false); p.scale.setScalar(0.74); return p; }
  const i = makeIng(item.k, item.s);
  i.scale.setScalar(0.5);
  return i;
}

/* ---------- kuchyně ---------- */
let kitchen = null;
let dyn = {};                 // key -> { ch, g, sig, ... }
let barEls = [];              // { key, ch, el, fill, txt }
let textEls = [];             // { el, wx, wy, wz, key, kind }
let hilite = null;
const world = $('world');

function mkEl(cls, html) {
  const e = document.createElement('div');
  e.className = cls;
  if (html) e.innerHTML = html;
  world.appendChild(e);
  return e;
}

function counter(parent, x, z, topColor) {
  M(geo('Box', 1, TOP - 0.08, 1), '#7d4f25', x + 0.5, (TOP - 0.08) / 2, z + 0.5, parent);
  M(geo('Box', 1.02, 0.08, 1.02), topColor || '#c68f52', x + 0.5, TOP - 0.04, z + 0.5, parent);
}

function buildKitchen() {
  if (kitchen) scene.remove(kitchen);
  world.innerHTML = '';
  barEls = []; textEls = []; dyn = {};
  kitchen = new THREE.Group();
  scene.add(kitchen);

  // podklad + zadní zeď
  const ground = M(geo('Plane', 60, 40), '#1b110c', 8, -0.06, 5, kitchen, { noShadow: true });
  ground.rotation.x = -Math.PI / 2;
  const WH = 2.8;
  M(geo('Box', 17, WH, 0.5), '#8c8aa6', 8, WH / 2, -0.25, kitchen);          // zadní zeď
  M(geo('Box', 17, WH, 0.5), '#8c8aa6', 8, WH / 2, 10.25, kitchen);          // přední zeď
  M(geo('Box', 0.5, WH, 11), '#8c8aa6', -0.25, WH / 2, 5, kitchen);          // levá zeď
  M(geo('Box', 0.5, WH, 11), '#8c8aa6', 16.25, WH / 2, 5, kitchen);          // pravá zeď
  M(geo('Box', 17, 0.3, 0.55), '#46455a', 8, 0.15, -0.0, kitchen, { noShadow: true });
  const ceil = M(geo('Plane', 17, 11), '#e9dfc8', 8, WH, 5, kitchen, { noShadow: true });
  ceil.rotation.x = Math.PI / 2;
  for (let lx = 0; lx < 3; lx++) {
    for (let lz = 0; lz < 2; lz++) {
      const lamp = M(geo('Box', 1.6, 0.06, 0.7), '#fffbe8', 3 + lx * 5, WH - 0.04, 2.6 + lz * 4.8, kitchen, { noShadow: true, mat: { emissive: '#fff2c0' } });
      lamp.castShadow = false;
    }
  }

  const wTiles = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = map[y][x];
      const cx = x + 0.5, cz = y + 0.5;
      if (ch === '.') {
        const f = M(geo('Box', 1, 0.1, 1), (x + y) % 2 ? '#e6d6b2' : '#eddfbf', cx, -0.05, cz, kitchen, { noShadow: true });
        f.castShadow = false;
        continue;
      }
      if (ch === '#') {
        M(geo('Box', 1, WH, 1), '#8c8aa6', cx, WH / 2, cz, kitchen);
        M(geo('Box', 1.02, 0.14, 1.02), '#46455a', cx, 0.07, cz, kitchen);
        continue;
      }
      if (CRATE[ch]) {
        counter(kitchen, x, y);
        M(geo('Box', 0.74, 0.34, 0.74), '#a9743c', cx, TOP + 0.17, cz, kitchen);
        M(geo('Box', 0.78, 0.05, 0.78), '#8a5c2b', cx, TOP + 0.34, cz, kitchen);
        M(geo('Box', 0.76, 0.04, 0.02), '#6f4a20', cx, TOP + 0.12, cz + 0.375, kitchen, { noShadow: true });
        const k = CRATE[ch];
        [[-0.17, -0.1], [0.17, -0.1], [0, 0.17]].forEach((q, i) => {
          const it = makeIng(k, 'raw');
          it.scale.setScalar(0.38);
          it.position.set(cx + q[0], TOP + 0.36, cz + q[1]);
          it.rotation.y = i * 1.3;
          kitchen.add(it);
        });
        const lb = labelSprite(NAMES[k], '#fff', 0.95);
        lb.position.set(cx, TOP + 0.75, cz + 0.2);
        kitchen.add(lb);
        addText(x, y, 'stock', k);
        continue;
      }
      switch (ch) {
        case 'C':
          counter(kitchen, x, y);
          dyn[x + ',' + y] = { ch, x, y };
          break;
        case 'K':
          counter(kitchen, x, y);
          M(geo('Box', 0.8, 0.07, 0.62), '#efd9a8', cx - 0.04, TOP + 0.035, cz, kitchen);
          M(geo('Box', 0.05, 0.03, 0.34), '#cfd8dc', cx + 0.34, TOP + 0.085, cz - 0.04, kitchen);
          M(geo('Box', 0.06, 0.04, 0.14), '#8d6e63', cx + 0.34, TOP + 0.09, cz + 0.2, kitchen);
          dyn[x + ',' + y] = { ch, x, y };
          addBar(x, y, ch);
          break;
        case 'F': {
          M(geo('Box', 1, TOP - 0.08, 1), '#2b2d33', cx, (TOP - 0.08) / 2, cz, kitchen);
          M(geo('Box', 1.02, 0.08, 1.02), '#3d4048', cx, TOP - 0.04, cz, kitchen);
          const ring = M(geo('Torus', 0.27, 0.04, 8, 22), '#5a5e68', cx, TOP + 0.03, cz, kitchen, { noShadow: true });
          ring.rotation.x = Math.PI / 2;
          M(geo('Cylinder', 0.22, 0.22, 0.02, 18), '#17181c', cx, TOP + 0.02, cz, kitchen, { noShadow: true });
          dyn[x + ',' + y] = { ch, x, y };
          addBar(x, y, ch);
          break;
        }
        case 'P': {
          counter(kitchen, x, y, '#3a9b78');
          M(geo('Cylinder', 0.36, 0.36, 0.05, 20), '#c99a2e', cx, TOP + 0.025, cz, kitchen);
          const dome = M(geo('Sphere', 0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#e8c15a', cx, TOP + 0.05, cz, kitchen);
          dome.scale.y = 0.8;
          M(geo('Sphere', 0.05, 8, 6), '#c99a2e', cx, TOP + 0.31, cz, kitchen);
          const lb = labelSprite('VÝDEJ', '#e9fff5', 0.95);
          lb.position.set(cx, TOP + 0.75, cz);
          kitchen.add(lb);
          break;
        }
        case 'X':
          counter(kitchen, x, y);
          M(geo('Cylinder', 0.3, 0.24, 0.52, 14), '#6b7a86', cx, TOP + 0.26, cz, kitchen);
          M(geo('Cylinder', 0.34, 0.34, 0.06, 14), '#8a9aa6', cx, TOP + 0.55, cz, kitchen);
          M(geo('Box', 0.16, 0.04, 0.05), '#56626c', cx, TOP + 0.6, cz, kitchen);
          break;
        case 'D':
          counter(kitchen, x, y);
          dyn[x + ',' + y] = { ch, x, y };
          addText(x, y, 'plates');
          break;
        case 'W':
          counter(kitchen, x, y, '#6d93ad');
          M(geo('Box', 0.9, 0.1, 0.9), '#4a6f88', cx, TOP + 0.03, cz, kitchen);
          M(geo('Box', 0.76, 0.02, 0.76), '#a5dcf5', cx, TOP + 0.085, cz, kitchen, { noShadow: true });
          M(geo('Cylinder', 0.035, 0.035, 0.4, 8), '#9aa5ad', cx, TOP + 0.3, cz - 0.38, kitchen);
          M(geo('Box', 0.05, 0.05, 0.22), '#9aa5ad', cx, TOP + 0.5, cz - 0.28, kitchen);
          wTiles.push({ x, y });
          dyn[x + ',' + y] = { ch, x, y, wi: wTiles.length - 1 };
          addBar(x, y, ch);
          break;
        default:
          counter(kitchen, x, y);
      }
    }
  }
  wTiles.forEach((t, i) => { dyn[t.x + ',' + t.y].wn = wTiles.length; if (i === 0) addText(t.x, t.y, 'dirty'); });

  for (const key in dyn) {
    const d = dyn[key];
    d.g = new THREE.Group();
    d.g.position.set(d.x + 0.5, TOP, d.y + 0.5);
    d.sig = null;
    kitchen.add(d.g);
  }

  // zvýraznění políčka, na které hráč míří
  hilite = new THREE.Group();
  const hp = new THREE.Mesh(geo('Plane', 0.98, 0.98), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  hp.rotation.x = -Math.PI / 2;
  const he = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.98, 0.98)), new THREE.LineBasicMaterial({ color: 0xffffff }));
  he.rotation.x = -Math.PI / 2;
  hilite.add(hp, he);
  hilite.visible = false;
  kitchen.add(hilite);
}

function addBar(x, y, ch) {
  const el = mkEl('bar hidden', '<i></i><span></span>');
  barEls.push({ key: x + ',' + y, ch, x, y, el, fill: el.firstChild, txt: el.lastChild });
}
function addText(x, y, kind, k) {
  textEls.push({ x, y, kind, k, el: mkEl('tag hidden'), last: '' });
}

/* ---------- dynamické předměty na stanicích ---------- */
function updateStations(tm) {
  if (!snap) return;
  for (const key in dyn) {
    const d = dyn[key], s = snap.s[key];
    let sig = '';
    if (d.ch === 'C' || d.ch === 'K' || d.ch === 'F') sig = s && s.i ? JSON.stringify(s.i) : '';
    else if (d.ch === 'D') sig = String(Math.min(snap.d, 8));
    else if (d.ch === 'W') sig = String(Math.floor((snap.w + (d.wn - 1 - d.wi)) / d.wn));
    if (sig !== d.sig) { d.sig = sig; rebuildStation(d, s); }
    if (d.ch === 'F') animateStove(d, tm);
  }
}

function rebuildStation(d, s) {
  clearGroup(d.g);
  d.flames = null; d.smoke = null;
  if (d.ch === 'C' || d.ch === 'K') {
    if (s && s.i) {
      const it = makeItem(s.i);
      it.position.set(d.ch === 'K' ? -0.04 : 0, d.ch === 'K' ? 0.07 : 0, 0);
      d.g.add(it);
    }
  } else if (d.ch === 'F') {
    if (!s || !s.i) return;
    M(geo('Cylinder', 0.36, 0.3, 0.09, 18), '#15161a', 0, 0.06, 0, d.g);
    M(geo('Box', 0.34, 0.04, 0.08), '#15161a', -0.45, 0.1, 0, d.g);
    const meat = makeIng('meat', s.i.s);
    meat.scale.setScalar(0.5);
    meat.position.y = 0.1;
    d.g.add(meat);
    const st = s.i.s;
    if (st === 'chopped' || st === 'cooked') {
      d.flames = [];
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const f = M(geo('Cone', 0.06, 0.2, 6), i % 2 ? '#ffb300' : '#ff6d00', Math.cos(a) * 0.27, 0.06, Math.sin(a) * 0.27, d.g, { noShadow: true, mat: { emissive: i % 2 ? '#aa6600' : '#aa3300' } });
        d.flames.push(f);
      }
    }
    if (st === 'burnt') {
      d.smoke = [];
      for (let i = 0; i < 3; i++) {
        const sm = M(geo('Sphere', 0.12, 8, 6), '#555555', 0, 0.3, 0, d.g, { noShadow: true, mat: { transparent: true, opacity: 0.5 } });
        sm.material = sm.material.clone();
        sm.userData.i = i;
        d.smoke.push(sm);
      }
    }
  } else if (d.ch === 'D') {
    const n = Number(d.sig);
    for (let i = 0; i < n; i++) {
      const p = makePlate(null, false);
      p.scale.setScalar(0.7);
      p.position.y = i * 0.045;
      d.g.add(p);
    }
  } else if (d.ch === 'W') {
    const n = Math.min(Number(d.sig), 4);
    for (let i = 0; i < n; i++) {
      const p = makePlate(null, true);
      p.scale.setScalar(0.62);
      p.position.set(0, 0.1 + i * 0.045, 0);
      d.g.add(p);
    }
  }
}

function animateStove(d, tm) {
  if (d.flames) d.flames.forEach((f, i) => { f.scale.y = 0.8 + Math.sin(tm * 12 + i * 1.7) * 0.35; });
  if (d.smoke) {
    d.smoke.forEach((sm) => {
      const ph = (tm * 0.7 + sm.userData.i / 3) % 1;
      sm.position.set(Math.sin(ph * 6 + sm.userData.i) * 0.12, 0.3 + ph * 0.8, 0);
      sm.scale.setScalar(0.7 + ph * 1.2);
      sm.material.opacity = 0.5 * (1 - ph);
    });
  }
}

/* ---------- kuchaři ---------- */
const chefs = new Map();      // id -> { g, body, holder, heldSig, tag, color }

function makeChef(color) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  M(geo('Cylinder', 0.2, 0.25, 0.5, 14), '#ffffff', 0, 0.45, 0, body);
  M(geo('Sphere', 0.045, 6, 4), color, -0.07, 0.55, 0.22, body, { noShadow: true });
  M(geo('Sphere', 0.045, 6, 4), color, 0.07, 0.55, 0.22, body, { noShadow: true });
  M(geo('Cylinder', 0.08, 0.08, 0.2, 8), '#33405a', -0.1, 0.1, 0, body);
  M(geo('Cylinder', 0.08, 0.08, 0.2, 8), '#33405a', 0.1, 0.1, 0, body);
  M(geo('Sphere', 0.17, 16, 12), '#f5cfa0', 0, 0.86, 0, body);
  M(geo('Sphere', 0.025, 6, 4), '#2b1b10', -0.06, 0.89, 0.15, body, { noShadow: true });
  M(geo('Sphere', 0.025, 6, 4), '#2b1b10', 0.06, 0.89, 0.15, body, { noShadow: true });
  M(geo('Cylinder', 0.18, 0.17, 0.12, 14), color, 0, 1.02, 0, body);
  M(geo('Sphere', 0.14, 10, 8), color, -0.08, 1.14, 0, body);
  M(geo('Sphere', 0.14, 10, 8), color, 0.08, 1.14, 0, body);
  M(geo('Sphere', 0.15, 10, 8), color, 0, 1.2, 0, body);
  // ruce
  M(geo('Box', 0.07, 0.07, 0.34), '#ffffff', -0.2, 0.62, 0.2, body);
  M(geo('Box', 0.07, 0.07, 0.34), '#ffffff', 0.2, 0.62, 0.2, body);
  const holder = new THREE.Group();
  holder.position.set(0, 0.7, 0.46);
  body.add(holder);
  return { g, body, holder, heldSig: '', tag: mkEl('nametag'), color };
}

function removeActor(id) {
  actors.delete(id);
  const c = chefs.get(id);
  if (c) { scene.remove(c.g); c.tag.remove(); chefs.delete(id); }
}
function clearActors() {
  for (const id of [...chefs.keys()]) removeActor(id);
  actors.clear();
}

function syncChefs(dt) {
  for (const a of actors.values()) {
    let c = chefs.get(a.id);
    if (!c) { c = makeChef(a.c); scene.add(c.g); c.tag.textContent = a.n; chefs.set(a.id, c); }
    const bob = a.moving ? Math.abs(Math.sin(a.phase)) * 0.06 : 0;
    c.g.position.set(a.x, bob, a.y);
    const mine = a.id === myId;
    c.body.visible = !mine;
    // plynulé otáčení do směru pohybu
    const target = Math.atan2(a.fx, a.fy);
    let diff = target - a.ang;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    a.ang += diff * Math.min(1, dt * 16);
    c.body.rotation.y = a.ang;
    c.body.rotation.x = a.moving ? 0.1 : 0;
    const sig = a.h ? JSON.stringify(a.h) : '';
    if (sig !== c.heldSig) {
      c.heldSig = sig;
      clearGroup(c.holder);
      if (a.h) c.holder.add(makeItem(a.h));
    }
    if (c.tag.textContent !== a.n) c.tag.textContent = a.n;
    if (mine && sig !== fpSig) {
      fpSig = sig;
      clearGroup(fpHeld);
      if (a.h) fpHeld.add(makeItem(a.h));
    }
  }
}

/* =====================================================================
 *  HUD (HTML nad plátnem)
 * ===================================================================== */
const ordersEl = $('orders');
const orderEls = new Map();
function clearOrders() { ordersEl.innerHTML = ''; orderEls.clear(); }

let hudCache = { t: '', sc: '', cd: '' };
function updateHud() {
  if (!snap) return;
  const total = Math.ceil(snap.t);
  const ts = '⏱ ' + Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  if (ts !== hudCache.t) { hudCache.t = ts; $('timer').textContent = ts; }
  $('timer').classList.toggle('low', snap.t <= 10 && snap.cd === 0);
  const sc = gameMode === 'days' ? '💰 ' + snap.sc + ' Kč' : 'Skóre ' + snap.sc;
  if (sc !== hudCache.sc) { hudCache.sc = sc; $('score').textContent = sc; }

  const cdEl = $('countdown');
  if (snap.cd > 0) {
    const c = String(Math.ceil(snap.cd));
    if (c !== hudCache.cd) { hudCache.cd = c; cdEl.querySelector('b').textContent = c; }
    cdEl.classList.remove('hidden');
  } else { hudCache.cd = ''; cdEl.classList.add('hidden'); }

  // objednávky
  const live = new Set();
  snap.o.forEach((o) => {
    const rec = recipes[o.r];
    if (!rec) return;
    live.add(o.id);
    let e = orderEls.get(o.id);
    if (!e) {
      const el = document.createElement('div');
      el.className = 'order';
      el.innerHTML = '<b></b><div class="oi"></div><div class="ot"><i></i></div>';
      el.firstChild.textContent = rec.name;
      el.querySelector('.oi').textContent = rec.items.map((k) => ICONS[k]).join(' ');
      ordersEl.appendChild(el);
      e = { el, fill: el.querySelector('i') };
      orderEls.set(o.id, e);
    }
    const frac = Math.max(0, o.t / o.l);
    e.fill.style.width = Math.max(3, frac * 100) + '%';
    e.fill.style.background = frac > 0.5 ? '#66bb6a' : frac > 0.25 ? '#ffca28' : '#ef5350';
    e.el.classList.toggle('urgent', frac <= 0.25);
  });
  for (const [id, e] of [...orderEls]) if (!live.has(id)) { e.el.remove(); orderEls.delete(id); }
  ordersEl.classList.toggle('empty', snap.o.length === 0);
}

/* ---------- plovoucí texty ---------- */
function float(x, y, z, text, color) {
  const el = mkEl('float');
  el.textContent = text; el.style.color = color;
  floaters.push({ el, x, y, z, life: 1.4, fixed: false });
}
function floatFixed(text, color) {
  const el = mkEl('float');
  el.textContent = text; el.style.color = color;
  floaters.push({ el, life: 1.6, fixed: true });
}

/* ---------- projekce 3D → obrazovka ---------- */
const tmpV = new THREE.Vector3();
function place(el, x, y, z, dxPx, dyPx) {
  tmpV.set(x, y, z).project(camera);
  if (tmpV.z > 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const sx = (tmpV.x * 0.5 + 0.5) * w + (dxPx || 0);
  const sy = (-tmpV.y * 0.5 + 0.5) * h + (dyPx || 0);
  el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-50%)';
}

function updateOverlays() {
  // ukazatele postupu
  for (const b of barEls) {
    const d = snap.s[b.key];
    let frac = -1, color = '#4fc3f7', txt = '';
    if (d) {
      if (b.ch === 'K' && d.i && d.p > 0) frac = d.p;
      else if (b.ch === 'W' && d.p > 0) frac = d.p;
      else if (b.ch === 'F' && d.i) {
        const st = d.i.s;
        if (st === 'chopped') { frac = d.p; color = '#66bb6a'; }
        else if (st === 'cooked') {
          const warn = d.b > 0.55;
          const blink = warn && Math.floor(performance.now() / 160) % 2 === 0;
          frac = 1 - d.b;
          color = blink ? '#ff1744' : (warn ? '#ff7043' : '#ffb300');
          if (warn) txt = '🔥';
        } else { frac = 1; color = '#5d1111'; txt = 'SPÁLENO!'; }
      }
    }
    if (frac < 0) { b.el.classList.add('hidden'); continue; }
    b.el.classList.remove('hidden');
    b.fill.style.width = Math.max(4, Math.min(1, frac) * 100) + '%';
    b.fill.style.background = color;
    b.txt.textContent = txt;
    place(b.el, b.x + 0.5, TOP + 0.6, b.y + 0.5);
  }
  // počty talířů
  for (const t of textEls) {
    if (t.kind === 'stock') {
      if (!snap.sk) { t.el.classList.add('hidden'); continue; }
      const n = snap.sk[t.k] || 0;
      const label = '×' + n;
      if (label !== t.last) { t.last = label; t.el.textContent = label; t.el.classList.toggle('zero', n === 0); }
      t.el.classList.remove('hidden');
      place(t.el, t.x + 0.5, TOP + 1.05, t.y + 0.5);
      continue;
    }
    const n = t.kind === 'plates' ? snap.d : snap.w;
    const label = (t.kind === 'plates' ? '🍽 ×' : '🧼 ×') + n;
    if (t.kind === 'dirty' && n === 0) { t.el.classList.add('hidden'); continue; }
    if (label !== t.last) { t.last = label; t.el.textContent = label; }
    t.el.classList.remove('hidden');
    place(t.el, t.x + (t.kind === 'dirty' ? 1 : 0.5), TOP + 0.55, t.y + 0.5);
  }
  // jména kuchařů
  for (const [id, c] of chefs) {
    const a = actors.get(id);
    if (a && id !== myId) place(c.tag, a.x, 1.75, a.y);
    else c.tag.style.display = 'none';
  }
}

function updateFloaters(dt) {
  for (const f of floaters) {
    f.life -= dt;
    const rise = (1.4 - f.life) * 34;
    if (f.fixed) {
      f.el.style.transform = 'translate(' + (canvas.clientWidth / 2).toFixed(1) + 'px,' + (110 - rise * 0.4).toFixed(1) + 'px) translate(-50%,-50%)';
    } else place(f.el, f.x, f.y, f.z, 0, -rise);
    f.el.style.opacity = Math.max(0, Math.min(1, f.life / 0.6));
    if (f.life <= 0) f.el.remove();
  }
  floaters = floaters.filter((f) => f.life > 0);
}

/* =====================================================================
 *  Hlavní smyčka
 * ===================================================================== */
function update(dt) {
  const playing = view === 'game' && snap && snap.cd === 0;
  let turn = 0;
  for (const code of turnKeys) turn += TURN[code];
  if (turn) yaw += turn * 2.4 * dt;
  const v = currentInput();
  const walking = Math.hypot(v.dx, v.dy) > 0.01;
  if (me) {
    me.fx = v.fx; me.fy = v.fy;
    if (playing && walking) moveBy(me, v.dx * SPEED * dt, v.dy * SPEED * dt);
  }
  for (const a of actors.values()) {
    if (a.id === myId && me) {
      a.x = me.x; a.y = me.y; a.fx = me.fx; a.fy = me.fy;
      a.moving = !!(playing && walking);
    } else {
      const k = Math.min(1, dt * 14), ox = a.x, oy = a.y;
      a.x += (a.tx - a.x) * k; a.y += (a.ty - a.y) * k;
      a.moving = dt > 0 && Math.hypot(a.x - ox, a.y - oy) / dt > 0.5;
    }
    if (a.moving) a.phase += dt * 14;
  }
  sendInput(false);
}

function updateCamera(tm) {
  if (!me) return;
  const a = actors.get(myId);
  const bob = a && a.moving ? Math.sin(a.phase) * 0.035 : 0;
  camera.position.set(me.x, EYE + bob, me.y);
  camera.rotation.set(pitch, yaw + Math.PI, 0);
}

function updateHighlight() {
  if (!me || view !== 'game') { hilite.visible = false; return; }
  const [tx, ty] = targetTile(me);
  const ch = tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS ? map[ty][tx] : '#';
  if (ch === '.' || ch === '#') { hilite.visible = false; return; }
  hilite.visible = true;
  hilite.position.set(tx + 0.5, TOP + 0.015, ty + 0.5);
}

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if ((view !== 'game' && view !== 'end' && view !== 'shop') || !map || !snap || !kitchen) return;
  update(dt);
  updateCamera(now / 1000);
  syncChefs(dt);
  updateStations(now / 1000);
  updateHighlight();
  renderer.render(scene, camera);
  updateOverlays();
  updateFloaters(dt);
}
requestAnimationFrame(frame);

setView('menu');
}   // start()
})();
