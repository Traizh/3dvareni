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
const COLS = 16;
const SPEED = 4.6, HALF = 0.3, REACH = 0.75;
const TOP = 0.98;                                   // výška pracovních desek
const NAMES = {
  bun: 'Houska', meat: 'Maso', cheese: 'Sýr', lettuce: 'Salát', tomato: 'Rajče', cola: 'Cola', lemon: 'Limonáda', juice: 'Džus',
  rice: 'Rýže', fish: 'Ryba', nori: 'Nori', cucumber: 'Okurka', shrimp: 'Kreveta', dough: 'Těsto', sauce: 'Omáčka', pepperoni: 'Salám', mushroom: 'Houby',
};
const ICONS = {
  bun: '🍞', meat: '🥩', cheese: '🧀', lettuce: '🥬', tomato: '🍅', cola: '🥤', lemon: '🍋', juice: '🍊',
  rice: '🍚', fish: '🐟', nori: '🟩', cucumber: '🥒', shrimp: '🦐', dough: '🥖', sauce: '🥫', pepperoni: '🍕', mushroom: '🍄',
};
const DRINK_COL = { cola: '#3b1d0e', lemon: '#eef266', juice: '#ff9a1f' };
const TAP = { A: 'cola', E: 'lemon', O: 'juice' };
let rackMap = {};                       // regály ve skladu (písmeno -> surovina)
let crateMap = { B: 'bun', M: 'meat', S: 'cheese', L: 'lettuce', T: 'tomato' };   // bedny aktuální restaurace (ze serveru)
const PLATE_STATE = {
  bun: 'raw', meat: 'cooked', cheese: 'raw', lettuce: 'chopped', tomato: 'chopped',
  rice: 'cooked', fish: 'chopped', nori: 'raw', cucumber: 'chopped', shrimp: 'cooked',
  dough: 'cooked', sauce: 'raw', pepperoni: 'chopped', mushroom: 'chopped',
};
const DRINK_KEYS = ['cola', 'lemon', 'juice'];
const RESTS = {
  burger: { name: 'Burger bar', icon: '🍔' },
  sushi: { name: 'Sushi bar', icon: '🍣' },
  pizza: { name: 'Pizzerie', icon: '🍕' },
};
// vzhled postavy (indexy; stejné palety zná server)
const HAT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#ecf0f1', '#34495e'];
const SHIRT_COLORS = ['#ffffff', '#fdd835', '#90caf9', '#a5d6a7', '#f48fb1', '#ffcc80', '#b0bec5', '#37474f'];
const SKIN_COLORS = ['#f5cfa0', '#e0ac80', '#c68642', '#8d5524'];
const HAT_STYLES = ['Kuchařská čepice', 'Šátek', 'Kšiltovka'];
// motivy restaurací (kuchyně + jídelna)
const THEMES = {
  burger: { kwall: '#8c8aa6', wall: '#ead8b8', wains: '#6b4a2f', cloth: ['#d85a5a', '#f4efe6'], lamp: '#e65100', carpet: ['#8e2f3a', '#b8434f'], floor: [150, 105, 65], menu: 'JÍDELNÍČEK', sign: 'VÍTEJTE', stove: 'stove', ceil: '#efe4cc', win: '#bfe4ff', curtain: '#a83232' },
  sushi: { kwall: '#5f8179', wall: '#f1e8d6', wains: '#2b2623', cloth: ['#2b2b2b', '#b71c1c'], lamp: '#c62828', carpet: ['#1d1d1d', '#3a3a3a'], floor: [165, 150, 95], menu: 'SUSHI MENU', sign: 'IRASSHAI', stove: 'cooker', ceil: '#e9e2cf', win: '#d4ecff', curtain: '#b71c1c' },
  pizza: { kwall: '#9c4e38', wall: '#c8694a', wains: '#4a2f18', cloth: ['#d32f2f', '#ffffff'], lamp: '#2e7d32', carpet: ['#2e7d32', '#4caf50'], floor: [190, 100, 66], menu: 'PIZZA MENU', sign: 'BENVENUTI', stove: 'oven', ceil: '#ead7bd', win: '#bfe4ff', curtain: '#2e7d32' },
};
let restId = 'burger';
let theme = THEMES.burger;

const canvas = $('game');

/* ---------------------------------------------------------------------
 *  Zvuky (Web Audio API)
 * ------------------------------------------------------------------- */
const Sound = (() => {
  let ac = null;
  let muted = false;
  try { muted = localStorage.getItem('kuchyne-muted') === '1'; } catch (e) { /* nic */ }
  const lastPlayed = {};
  const MIN_GAP = { chop: 70, wash: 110, warn: 700, pick: 40, drop: 40, tick: 300, pour: 130, spray: 140, nibble: 350, fire: 500, squeak: 250 };

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
    pour() { noise(0.12, 0.08, 1800); tone(520, 0.1, 'sine', 0.05, 700); },
    fire() { noise(0.6, 0.14, 380); tone(180, 0.5, 'sawtooth', 0.09, 90); tone(520, 0.12, 'square', 0.06, null, 0.05); },
    spray() { noise(0.16, 0.13, 3800); },
    extinguish() { noise(0.5, 0.12, 2200); tone(660, 0.18, 'triangle', 0.12); tone(990, 0.28, 'triangle', 0.12, null, 0.12); },
    squeak() { tone(2100, 0.07, 'square', 0.05, 2900); tone(2600, 0.09, 'square', 0.05, 1900, 0.09); },
    nibble() { noise(0.04, 0.12, 2600); noise(0.04, 0.1, 2400, 0.07); },
    splat() { noise(0.14, 0.15, 500); tone(240, 0.16, 'sine', 0.12, 80); },
    ratsteal() { tone(300, 0.3, 'sawtooth', 0.1, 140); tone(2100, 0.07, 'square', 0.05, 2900, 0.2); },
    chaos() { tone(440, 0.18, 'sawtooth', 0.09); tone(330, 0.18, 'sawtooth', 0.09, null, 0.18); tone(550, 0.3, 'sawtooth', 0.09, null, 0.36); },
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
let speedMult = 1;                       // vylepšení bot

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

/* ---------- Vzhled postavy ---------- */
let myLook = { h: 0, s: 0, t: 0, c: 0 };
try {
  const sv = JSON.parse(localStorage.getItem('kuchyne-look') || 'null');
  if (sv) for (const k of ['h', 's', 't', 'c']) if (Number.isInteger(sv[k]) && sv[k] >= 0) myLook[k] = sv[k];
} catch (e) { /* nic */ }
const LOOK_LIMIT = { h: HAT_COLORS.length, s: SKIN_COLORS.length, t: HAT_STYLES.length, c: SHIRT_COLORS.length };
for (const k in LOOK_LIMIT) if (myLook[k] >= LOOK_LIMIT[k]) myLook[k] = 0;

function avatarEl(lk, scale) {
  lk = lk || { h: 0, s: 0, t: 0, c: 0 };
  const wrap = document.createElement('span');
  wrap.className = 'avwrap';
  const sc = scale || 1;
  wrap.style.width = 44 * sc + 'px'; wrap.style.height = 48 * sc + 'px';
  const el = document.createElement('span');
  el.className = 'av hs' + (lk.t || 0);
  el.style.setProperty('--hat', HAT_COLORS[lk.h] || HAT_COLORS[0]);
  el.style.setProperty('--skin', SKIN_COLORS[lk.s] || SKIN_COLORS[0]);
  el.style.setProperty('--shirt', SHIRT_COLORS[lk.c] || SHIRT_COLORS[0]);
  el.innerHTML = '<i class="av-body"></i><i class="av-head"></i><i class="av-hat"></i><i class="av-eyes"></i>';
  el.style.transform = 'scale(' + sc + ')';
  wrap.appendChild(el);
  return wrap;
}

function saveLook() { try { localStorage.setItem('kuchyne-look', JSON.stringify(myLook)); } catch (e) { /* nic */ } }
const LOOK_ROWS = [
  { id: 'lkHat', key: 'h', items: HAT_COLORS, color: true },
  { id: 'lkStyle', key: 't', items: HAT_STYLES, color: false },
  { id: 'lkSkin', key: 's', items: SKIN_COLORS, color: true },
  { id: 'lkShirt', key: 'c', items: SHIRT_COLORS, color: true },
];
function buildLookUi() {
  LOOK_ROWS.forEach((row) => {
    const box = $(row.id);
    box.innerHTML = '';
    row.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'swb' + (row.color ? '' : ' txt');
      if (row.color) { b.style.background = it; b.title = it; } else b.textContent = it;
      b.onclick = () => { myLook[row.key] = i; saveLook(); paintLook(); };
      box.appendChild(b);
    });
  });
  $('lookRandom').onclick = () => {
    for (const k in LOOK_LIMIT) myLook[k] = Math.floor(Math.random() * LOOK_LIMIT[k]);
    saveLook(); paintLook();
  };
}
function paintLook() {
  LOOK_ROWS.forEach((row) => [...$(row.id).children].forEach((b, i) => b.classList.toggle('active', myLook[row.key] === i)));
  const pv = $('lookPrev');
  pv.innerHTML = '';
  pv.appendChild(avatarEl(myLook, 2.2));
}
buildLookUi();
paintLook();

/* ---------- Výběr restaurace (menu + lobby) ---------- */
let menuRest = 'burger';
function buildRestButtons(boxId, onPick) {
  const box = $(boxId);
  box.innerHTML = '';
  Object.keys(RESTS).forEach((id) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mode'; b.dataset.rest = id;
    b.innerHTML = '<b>' + RESTS[id].icon + ' ' + RESTS[id].name + '</b>';
    b.onclick = () => onPick(id);
    box.appendChild(b);
  });
}
function paintRestButtons(boxId, selected, locked) {
  [...$(boxId).children].forEach((b) => {
    const id = b.dataset.rest;
    b.classList.toggle('active', id === selected);
    b.disabled = locked && id !== 'burger';
    b.classList.toggle('locked', locked && id !== 'burger');
  });
}

const MODE_INFO = {
  classic: 'Klasika: jedno kolo 180 s, hrajete o týmové skóre.',
  days: 'Dny: každý den 120 s. Suroviny se spotřebovávají, mezi dny je objednáváš za peníze z objednávek a platíš nájem.',
};
function paintModes() {
  $('modeClassic').classList.toggle('active', menuMode === 'classic');
  $('modeDays').classList.toggle('active', menuMode === 'days');
  $('modeInfo').textContent = MODE_INFO[menuMode];
  paintRestButtons('menuRests', menuMode === 'days' ? 'burger' : menuRest, menuMode === 'days');
  $('restInfo').textContent = menuMode === 'days'
    ? '🔒 Ve Dnech začínáš s burgerem, sushi bar a pizzerii koupíš v obchodě mezi dny.'
    : 'Restaurace si ve Klasice vybíráš zdarma.';
}
buildRestButtons('menuRests', (id) => { menuRest = id; paintModes(); });
$('modeClassic').onclick = () => { menuMode = 'classic'; paintModes(); };
$('modeDays').onclick = () => { menuMode = 'days'; paintModes(); };
paintModes();

$('createBtn').onclick = () => {
  Sound.init(); menuError('');
  socket.emit('create', { name: getName(), mode: menuMode, rest: menuMode === 'classic' ? menuRest : 'burger', look: myLook });
};
$('soloBtn').onclick = () => {
  Sound.init(); menuError('');
  socket.emit('create', { name: getName(), mode: menuMode, rest: menuMode === 'classic' ? menuRest : 'burger', look: myLook, solo: true });
};
$('joinBtn').onclick = () => {
  Sound.init(); menuError('');
  const code = codeInput.value.trim();
  if (!code) return menuError('Zadej kód místnosti, nebo vytvoř novou.');
  socket.emit('join', { name: getName(), code, look: myLook });
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
buildRestButtons('lobbyRests', (id) => socket.emit('setRest', { id }));

function renderLobby(info) {
  $('roomCode').textContent = info.code;
  const isHost = info.host === myId;
  $('lobbyClassic').classList.toggle('active', info.mode === 'classic');
  $('lobbyDays').classList.toggle('active', info.mode === 'days');
  $('lobbyClassic').disabled = !isHost;
  $('lobbyDays').disabled = !isHost;
  $('lobbyModeInfo').textContent = MODE_INFO[info.mode] + (isHost ? '' : ' (režim volí hostitel)');
  paintRestButtons('lobbyRests', info.rest || 'burger', !isHost || info.mode === 'days');
  if (!isHost) [...$('lobbyRests').children].forEach((b) => { b.disabled = true; b.classList.remove('locked'); });
  const ul = $('playerList');
  ul.innerHTML = '';
  info.players.forEach((p) => {
    const li = document.createElement('li');
    const hat = avatarEl(p.lk, 0.7);
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
  speedMult = 1 + 0.08 * ((d.up && d.up.boots) || 0);
  if (d.rest) { restId = d.rest.id; crateMap = d.rest.crates || crateMap; rackMap = d.rest.racks || {}; }
  theme = THEMES[restId] || THEMES.burger;
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
  renderMvp(r);
  $('againBtn').disabled = !roomInfo || roomInfo.players.length < roomInfo.min;
  setView('end');
});

const STAT_ICONS = { dishes: '🍽', drinks: '🥤', pours: '🫗', chops: '🔪', cooks: '🔥', washes: '🧼', rats: '🐀', fires: '🧯' };
function statLine(st) {
  const parts = [];
  for (const k in STAT_ICONS) if (st[k]) parts.push(STAT_ICONS[k] + ' ' + st[k]);
  return parts.join('  ·  ') || '—';
}
function renderMvp(r) {
  const box = $('mvpBox');
  box.innerHTML = '';
  if (!r.mvp) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const top = document.createElement('div');
  top.className = 'mvptop';
  const crown = document.createElement('div');
  crown.className = 'crown'; crown.textContent = '👑';
  const av = avatarEl(r.mvp.lk, 1.6);
  const info = document.createElement('div');
  info.className = 'mvpinfo';
  const t1 = document.createElement('b'); t1.textContent = 'MVP: ' + r.mvp.n + (r.mvp.id === myId ? ' (ty)' : '');
  const t2 = document.createElement('span'); t2.textContent = r.mvp.pts + ' bodů';
  const t3 = document.createElement('small'); t3.textContent = statLine(r.mvp.st);
  info.append(t1, t2, t3);
  top.append(crown, av, info);
  box.appendChild(top);
  if (r.board && r.board.length > 1) {
    const ol = document.createElement('ol');
    ol.className = 'board';
    r.board.forEach((b) => {
      const li = document.createElement('li');
      const nm = document.createElement('span'); nm.className = 'bn'; nm.textContent = b.n + (b.id === myId ? ' (ty)' : '');
      const pt = document.createElement('span'); pt.className = 'bp'; pt.textContent = b.pts + ' b.';
      const st = document.createElement('small'); st.textContent = statLine(b.st);
      li.append(avatarEl(b.lk, 0.6), nm, pt, st);
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }
}

/* ---------------------------------------------------------------------
 *  Obchod mezi dny (režim „Dny“)
 * ------------------------------------------------------------------- */

socket.on('shop', (d) => {
  shopData = d;
  if (view !== 'shop') { resetKeys(); setView('shop'); }
  renderShop(d);
});

function renderShop(d) {
  const sm = d.summary;
  $('shopTitle').textContent = sm ? 'Den ' + sm.day + ' skončil' : 'Objednávka surovin';
  const lines = [];
  if (sm) {
    lines.push('Výdělek ' + (sm.net >= 0 ? '+' : '') + sm.net + ' Kč  ·  Nájem −' + sm.rent + ' Kč  ·  Odevzdáno ' + sm.delivered + '  ·  Propadlo ' + sm.expired);
    if (sm.goal) lines.push('🎯 ' + sm.goal.text + ': ' + (sm.goal.ok ? '✔ splněno, bonus +' + sm.goal.reward + ' Kč' : '✘ nesplněno'));
    if (sm.mvp) lines.push('🏆 MVP dne: ' + sm.mvp.n + ' (' + sm.mvp.pts + ' b.)');
    if (sm.stat) lines.push('🍔 ' + sm.stat.dishes + '  ·  🥤 ' + sm.stat.drinks + '  ·  🐀 zabito ' + sm.stat.rats + '  ·  🧯 uhašeno ' + sm.stat.fires);
  }
  $('shopSummary').textContent = lines.join('\n');
  $('shopMoney').textContent = d.money;
  $('shopRent').textContent = 'Nájem za den ' + d.day + ': ' + d.rent + ' Kč – nech si na něj!';

  // zítřek: modifikátor a cíl
  const nx = $('shopNext');
  nx.innerHTML = '';
  if (d.today) {
    const t = document.createElement('div');
    t.className = 'nextline';
    const b1 = document.createElement('b'); b1.textContent = '📅 Den ' + d.day + ': ' + d.today.n;
    const sp = document.createElement('span'); sp.textContent = d.today.d;
    t.append(b1, sp);
    nx.appendChild(t);
  }
  if (d.goal) {
    const t = document.createElement('div');
    t.className = 'nextline';
    const b1 = document.createElement('b'); b1.textContent = '🎯 Cíl dne: ' + d.goal.text;
    const sp = document.createElement('span'); sp.textContent = 'Bonus +' + d.goal.reward + ' Kč při splnění.';
    t.append(b1, sp);
    nx.appendChild(t);
  }

  // restaurace (kupují se za peníze)
  const rb = $('shopRests');
  rb.innerHTML = '';
  (d.rests || []).forEach((r) => {
    const card = document.createElement('div');
    card.className = 'restcard' + (r.sel ? ' sel' : '') + (r.owned ? '' : ' locked');
    const hd = document.createElement('b');
    hd.textContent = r.icon + ' ' + r.name + (r.pay > 1 ? '  (tržby ×' + r.pay + ')' : '');
    const rc = document.createElement('small');
    rc.textContent = r.recipes.join(' · ');
    const b = document.createElement('button');
    b.className = 'btn small';
    if (r.owned) {
      b.textContent = r.sel ? '✔ Vybráno' : 'Vybrat';
      b.disabled = r.sel;
      b.onclick = () => { Sound.init(); socket.emit('pickRest', { id: r.id }); };
    } else {
      b.textContent = '🔒 Koupit ' + r.cost + ' Kč';
      b.disabled = r.cost > d.money;
      b.onclick = () => { Sound.init(); socket.emit('buyRest', { id: r.id }); };
    }
    const tx = document.createElement('div');
    tx.className = 'rtx';
    tx.append(hd, rc);
    card.append(tx, b);
    rb.appendChild(card);
  });

  // krabice se zásobami (ceny se každý den mění)
  const box = $('shopItems');
  box.innerHTML = '';
  const bs = d.boxSize || 10;
  (d.ings || []).concat(DRINK_KEYS).forEach((k) => {
    const have = (d.boxes && d.boxes[k]) || 0, price = d.boxPrice[k];
    const base = Math.max(1, Math.round((d.base ? d.base[k] : d.prices[k]) * bs * 0.8));
    const shelf = (d.shelves && d.shelves[k]) || 0;
    const row = document.createElement('div');
    row.className = 'shoprow';
    const nm = document.createElement('span');
    nm.className = 'sname';
    const t1 = document.createElement('b'); t1.textContent = ICONS[k] + ' ' + NAMES[k] + ' (' + bs + ' ks)';
    const t2 = document.createElement('small'); t2.textContent = 'na policích ' + shelf + ' ks';
    nm.append(t1, t2);
    const st = document.createElement('span');
    st.className = 'sstock' + (have === 0 ? ' zero' : ''); st.textContent = '📦 ' + have + ' / ' + d.boxCap;
    const pr = document.createElement('span');
    pr.className = 'sprice' + (price < base ? ' sale' : price > base ? ' dear' : '');
    pr.textContent = (price < base ? '▼ ' : price > base ? '▲ ' : '') + price + ' Kč';
    row.append(nm, st, pr);
    [1, 3].forEach((n) => {
      const b = document.createElement('button');
      b.className = 'btn small'; b.textContent = '+' + n;
      b.disabled = price * n > d.money || have + n > d.boxCap;
      b.onclick = () => { Sound.init(); socket.emit('buy', { k, n }); };
      row.appendChild(b);
    });
    box.appendChild(row);
  });

  // trvalá vylepšení
  const ub = $('shopUp');
  ub.innerHTML = '';
  (d.up || []).forEach((u) => {
    const row = document.createElement('div');
    row.className = 'shoprow upg';
    const nm = document.createElement('span');
    nm.className = 'sname';
    const t1 = document.createElement('b'); t1.textContent = u.icon + ' ' + u.name + '  ' + '●'.repeat(u.lvl) + '○'.repeat(u.max - u.lvl);
    const t2 = document.createElement('small'); t2.textContent = u.desc;
    nm.append(t1, t2);
    row.appendChild(nm);
    const b = document.createElement('button');
    b.className = 'btn small';
    if (u.next === null) { b.textContent = 'MAX'; b.disabled = true; }
    else { b.textContent = u.next + ' Kč'; b.disabled = u.next > d.money; b.onclick = () => { Sound.init(); socket.emit('upgrade', { id: u.id }); }; }
    row.appendChild(b);
    ub.appendChild(row);
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
  if (RESTS[restId]) t += '  ·  ' + RESTS[restId].icon + ' ' + RESTS[restId].name;
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
const isSolid = (x, y) => !map || y < 0 || y >= map.length || x < 0 || x >= COLS || map[y][x] !== '.';

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
    a.n = p.n; a.c = p.c; a.lk = p.lk; a.tx = p.x; a.ty = p.y; a.fx = p.fx; a.fy = p.fy; a.h = p.h;
    if (p.id === myId) reconcile(p);
  }
  for (const id of [...actors.keys()]) if (!seen.has(id)) removeActor(id);

  handleEvents(s.ev || []);
  if (kitchen) syncCustomers(s.o || []);
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
      case 'serve': if (e.o) restaurantServe(e); Sound.play('serve'); float(e.x, 1.5, e.y, '+' + e.v + (gameMode === 'days' ? ' Kč' : ''), '#8dff9f'); break;
      case 'no': Sound.play('no'); if (e.m) float(e.x, 1.5, e.y, e.m, '#ff9a90'); break;
      case 'expire': if (e.o) restaurantAngry(e.o); Sound.play('expire'); floatFixed('Objednávka propadla!  −5' + (gameMode === 'days' ? ' Kč' : ''), '#ff9a90'); break;
      case 'go': {
        Sound.play('go');
        const g = $('goText');
        g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
        break;
      }
      case 'drop': Sound.play('drop'); if (e.m) float(e.x, 1.4, e.y, e.m, '#8dff9f'); break;
      case 'fire': Sound.play('fire'); float(e.x, 1.6, e.y, '🔥 Hoří!', '#ffb347'); break;
      case 'extinguish': Sound.play('extinguish'); float(e.x, 1.6, e.y, '✔ Uhašeno!', '#8dff9f'); break;
      case 'splat': Sound.play('splat'); float(e.x, 0.6, e.y, '🐀 +' + e.v + (gameMode === 'days' ? ' Kč' : ''), '#8dff9f'); break;
      case 'ratsteal': Sound.play('ratsteal'); if (e.m) float(e.x, 1.5, e.y, '🐀 ' + e.m, '#ff9a90'); break;
      case 'chaos': Sound.play('chaos'); break;
      case 'order': Sound.play('order'); break;
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
scene.fog = new THREE.Fog(0x120a06, 50, 95);
const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 140);
camera.rotation.order = 'YXZ';
scene.add(camera);
const EYE = 1.6;
let yaw = 0, pitch = -0.25;       // yaw 0 = pohled na +z (dolů po mapě); doleva = přibývá
const fpHeld = new THREE.Group(); // předmět v ruce, připevněný ke kameře
fpHeld.position.set(0.32, -0.38, -0.8);
fpHeld.rotation.set(0.25, -0.35, 0);
camera.add(fpHeld);
let fpSig = '';

const hemi = new THREE.HemisphereLight(0xfff2dd, 0x6a5646, 1.0);
scene.add(hemi);
const torch = new THREE.PointLight(0xfff0cc, 0, 10);      // baterka při výpadku proudu
camera.add(torch);
let dark = 0;
const sun = new THREE.DirectionalLight(0xffffff, 0.75);
sun.position.set(14, 16, 9);
sun.target.position.set(17, 0, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 13, bottom: -13, near: 1, far: 50 });
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
  if (!g.children.length) makeIngExtra(k, s, g);
  return g;
}

/* ---------- modely surovin sushi a pizzerie ---------- */
function makeIngExtra(k, s, g) {
  if (k === 'rice') {
    if (s === 'cooked') {
      const m = M(geo('Sphere', 0.44, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#fbfbf4', 0, 0.02, 0, g);
      m.scale.y = 0.65;
      for (let i = 0; i < 8; i++) {
        const a = i * 2.4, r = 0.1 + (i % 3) * 0.09;
        M(geo('Sphere', 0.045, 5, 4), '#ffffff', Math.cos(a) * r, 0.2 + (i % 2) * 0.03, Math.sin(a) * r, g, { noShadow: true });
      }
    } else {
      M(geo('Cylinder', 0.4, 0.4, 0.07, 14), '#d8d3c0', 0, 0.035, 0, g);
      for (let i = 0; i < 16; i++) {
        const a = i * 2.1, r = 0.05 + (i % 5) * 0.07;
        M(geo('Sphere', 0.035, 4, 3), '#efe9d4', Math.cos(a) * r, 0.09, Math.sin(a) * r, g, { noShadow: true });
      }
    }
  } else if (k === 'fish') {
    if (s === 'raw') {
      const b = M(geo('Sphere', 0.3, 12, 8), '#7aa3b8', 0, 0.22, 0, g);
      b.scale.set(1.5, 0.8, 0.8);
      M(geo('Cone', 0.18, 0.3, 4), '#6a93a8', -0.52, 0.22, 0, g).rotation.z = Math.PI / 2;
      M(geo('Sphere', 0.035, 5, 4), '#101010', 0.34, 0.3, 0.14, g, { noShadow: true });
      M(geo('Box', 0.5, 0.04, 0.02), '#dfeaf0', 0, 0.2, 0.22, g, { noShadow: true });
    } else {
      [[-0.1, -0.2, 0.15], [0.1, 0.18, -0.12]].forEach((q) => {
        const f = M(geo('Box', 0.62, 0.1, 0.3), '#ff8a65', q[0], 0.05, q[1], g);
        f.rotation.y = q[2];
        M(geo('Box', 0.5, 0.012, 0.05), '#ffd9cc', q[0], 0.106, q[1], g, { noShadow: true }).rotation.y = q[2];
      });
    }
  } else if (k === 'nori') {
    M(geo('Box', 0.82, 0.03, 0.82), '#1f3d2b', 0, 0.015, 0, g);
    [-0.2, 0, 0.2].forEach((z) => M(geo('Box', 0.8, 0.005, 0.02), '#2f5a40', 0, 0.032, z, g, { noShadow: true }));
  } else if (k === 'cucumber') {
    if (s === 'raw') {
      const c = M(geo('Cylinder', 0.15, 0.15, 0.8, 10), '#3f9b4a', 0, 0.16, 0, g);
      c.rotation.z = Math.PI / 2;
      [-0.4, 0.4].forEach((x) => M(geo('Cylinder', 0.12, 0.12, 0.02, 10), '#bcd98a', x, 0.16, 0, g, { noShadow: true }).rotation.z = Math.PI / 2);
    } else {
      [[-0.28, -0.12], [0, 0.18], [0.28, -0.1], [-0.05, -0.3]].forEach((q) => {
        M(geo('Cylinder', 0.19, 0.19, 0.05, 12), '#3f9b4a', q[0], 0.025, q[1], g);
        M(geo('Cylinder', 0.15, 0.15, 0.01, 12), '#a6db8f', q[0], 0.055, q[1], g, { noShadow: true });
      });
    }
  } else if (k === 'shrimp') {
    const col = s === 'cooked' ? '#ff7043' : s === 'burnt' ? '#2a2a2a' : '#d9c2c0';
    [[-0.3, 0.1, 0.16], [-0.12, 0.2, 0.18], [0.08, 0.24, 0.17], [0.26, 0.18, 0.14], [0.38, 0.07, 0.11]].forEach((q) => {
      const sp = M(geo('Sphere', q[2], 8, 6), col, q[0], q[1], 0, g);
      sp.scale.set(1.1, 0.9, 0.9);
    });
    M(geo('Cone', 0.12, 0.18, 4), col, -0.44, 0.04, 0, g).rotation.z = Math.PI / 2;
    M(geo('Sphere', 0.025, 5, 4), '#111111', 0.44, 0.12, 0.08, g, { noShadow: true });
  } else if (k === 'dough') {
    if (s === 'raw') {
      const b = M(geo('Sphere', 0.36, 12, 9), '#f5e2b8', 0, 0.3, 0, g);
      b.scale.y = 0.85;
    } else if (s === 'chopped') {
      M(geo('Cylinder', 0.46, 0.46, 0.06, 20), '#f2d99b', 0, 0.03, 0, g);
    } else {
      M(geo('Cylinder', 0.46, 0.46, 0.07, 20), s === 'burnt' ? '#2a2a2a' : '#d9a34b', 0, 0.035, 0, g);
      const rim = M(geo('Torus', 0.44, 0.04, 6, 22), s === 'burnt' ? '#1a1a1a' : '#c58f3a', 0, 0.07, 0, g, { noShadow: true });
      rim.rotation.x = Math.PI / 2;
    }
  } else if (k === 'sauce') {
    M(geo('Cylinder', 0.4, 0.4, 0.05, 18), '#c62828', 0, 0.025, 0, g);
    M(geo('Cylinder', 0.28, 0.28, 0.012, 18), '#e53935', 0, 0.055, 0, g, { noShadow: true });
  } else if (k === 'pepperoni') {
    if (s === 'raw') {
      const st = M(geo('Cylinder', 0.13, 0.13, 0.8, 10), '#a33a2e', 0, 0.14, 0, g);
      st.rotation.z = Math.PI / 2;
      [-0.4, 0.4].forEach((x) => M(geo('Cylinder', 0.1, 0.1, 0.02, 10), '#d9776a', x, 0.14, 0, g, { noShadow: true }).rotation.z = Math.PI / 2);
    } else {
      [[-0.25, -0.15], [0.05, -0.28], [0.3, -0.05], [-0.1, 0.12], [0.18, 0.28]].forEach((q) => {
        M(geo('Cylinder', 0.17, 0.17, 0.045, 12), '#b23a2f', q[0], 0.022, q[1], g);
        M(geo('Sphere', 0.025, 4, 3), '#7a1f18', q[0] + 0.04, 0.05, q[1] + 0.03, g, { noShadow: true });
      });
    }
  } else if (k === 'mushroom') {
    if (s === 'raw') {
      [[-0.18, 0, 0.2], [0.2, 0.08, 0.16]].forEach((q) => {
        M(geo('Cylinder', 0.07, 0.08, 0.2, 8), '#efe6d2', q[0], 0.1, q[1], g);
        const cap = M(geo('Sphere', q[2], 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#c9a47a', q[0], 0.2, q[1], g);
        cap.scale.y = 0.8;
      });
    } else {
      [[-0.25, -0.12], [0.05, -0.28], [0.28, 0.0], [-0.08, 0.2], [0.2, 0.26]].forEach((q) => {
        M(geo('Cylinder', 0.12, 0.12, 0.03, 8), '#e8dcc3', q[0], 0.015, q[1], g);
        M(geo('Cylinder', 0.12, 0.12, 0.005, 8), '#b99a72', q[0], 0.033, q[1], g, { noShadow: true });
      });
    }
  }
}

// pizza se na talíři skládá do vrstev (těsto → omáčka → sýr → feferonky/houby)
function makePizzaPart(k) {
  const g = new THREE.Group();
  if (k === 'dough') {
    M(geo('Cylinder', 0.46, 0.46, 0.05, 22), '#d9a34b', 0, 0.025, 0, g);
    const rim = M(geo('Torus', 0.44, 0.04, 6, 24), '#c58f3a', 0, 0.05, 0, g, { noShadow: true });
    rim.rotation.x = Math.PI / 2;
  } else if (k === 'sauce') {
    M(geo('Cylinder', 0.38, 0.38, 0.015, 20), '#c62828', 0, 0.008, 0, g, { noShadow: true });
  } else if (k === 'cheese') {
    M(geo('Cylinder', 0.36, 0.36, 0.02, 20), '#f9d65c', 0, 0.01, 0, g, { noShadow: true });
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9, r = 0.1 + (i % 3) * 0.09;
      M(geo('Sphere', 0.05, 5, 4), '#fbe48a', Math.cos(a) * r, 0.03, Math.sin(a) * r, g, { noShadow: true });
    }
  } else if (k === 'pepperoni') {
    [[0.2, 0.1], [-0.2, 0.15], [0, -0.22], [0.15, -0.2], [-0.22, -0.1], [0, 0.05]].forEach((q) => M(geo('Cylinder', 0.08, 0.08, 0.025, 10), '#a8322a', q[0], 0.015, q[1], g, { noShadow: true }));
  } else if (k === 'mushroom') {
    [[-0.1, 0.22], [0.22, -0.12], [-0.25, -0.05], [0.1, 0.0], [0.05, -0.28]].forEach((q) => M(geo('Cylinder', 0.07, 0.07, 0.02, 8), '#eadfc9', q[0], 0.015, q[1], g, { noShadow: true }));
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
  if (n && content.includes('dough')) {
    let y = 0.06;
    ['dough', 'sauce', 'cheese', 'pepperoni', 'mushroom'].forEach((k) => {
      if (!content.includes(k)) return;
      const part = makePizzaPart(k);
      part.position.y = y;
      part.scale.setScalar(0.95);
      g.add(part);
      y += k === 'dough' ? 0.05 : 0.025;
    });
    return g;
  }
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
function makeCup(d) {
  const g = new THREE.Group();
  M(geo('Cylinder', 0.3, 0.22, 0.7, 14, 1, true), '#ffffff', 0, 0.35, 0, g, { noShadow: true, mat: { transparent: true, opacity: 0.32, side: THREE.DoubleSide } });
  M(geo('Cylinder', 0.22, 0.22, 0.03, 14), '#dfe8ee', 0, 0.015, 0, g);
  M(geo('Cylinder', 0.31, 0.31, 0.03, 14), '#ffffff', 0, 0.7, 0, g, { noShadow: true, mat: { transparent: true, opacity: 0.55 } });
  if (d) {
    M(geo('Cylinder', 0.27, 0.225, 0.5, 14), DRINK_COL[d] || '#888', 0, 0.28, 0, g, { noShadow: true });
    M(geo('Box', 0.04, 0.55, 0.04), '#ff4d6d', 0.1, 0.72, 0, g, { noShadow: true }).rotation.z = -0.25;
  }
  return g;
}
function makeExt() {
  const g = new THREE.Group();
  M(geo('Cylinder', 0.17, 0.17, 0.62, 14), '#d32f2f', 0, 0.34, 0, g);
  M(geo('Cylinder', 0.17, 0.17, 0.05, 14), '#222222', 0, 0.04, 0, g);
  M(geo('Cylinder', 0.06, 0.12, 0.14, 10), '#222222', 0, 0.71, 0, g);
  M(geo('Box', 0.08, 0.06, 0.26), '#222222', 0, 0.82, 0.06, g);
  M(geo('Box', 0.05, 0.05, 0.2), '#555555', 0, 0.74, 0.16, g);
  M(geo('Sphere', 0.045, 8, 6), '#fdd835', 0.12, 0.55, 0.1, g, { noShadow: true });
  return g;
}
const iconTexCache = {};
function iconTex(k) {
  if (iconTexCache[k]) return iconTexCache[k];
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff7e0'; x.fillRect(0, 0, 64, 64);
  x.font = '44px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(ICONS[k] || '?', 32, 36);
  return (iconTexCache[k] = new THREE.CanvasTexture(cv));
}
function makeBoxModel(k) {
  const g = new THREE.Group();
  M(geo('Box', 0.44, 0.34, 0.4), '#b98b4f', 0, 0.17, 0, g);
  M(geo('Box', 0.46, 0.03, 0.1), '#d9b87a', 0, 0.345, 0, g, { noShadow: true });
  const lbl = new THREE.Mesh(geo('Plane', 0.22, 0.22), new THREE.MeshBasicMaterial({ map: iconTex(k) }));
  lbl.position.set(0, 0.17, 0.205);
  g.add(lbl);
  return g;
}
function makeItem(item) {
  if (item.t === 'b') { const b = makeBoxModel(item.k); b.scale.setScalar(1.35); return b; }
  if (item.t === 'c') { const c = makeCup(item.d); c.scale.setScalar(0.8); return c; }
  if (item.t === 'x') { const e = makeExt(); e.scale.setScalar(0.75); return e; }
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
const fireObjs = new Map();   // 'x,y' -> { g, flames, smoke, bar, fill }
const ratObjs = new Map();    // id -> { g, x, y, tx, ty, a, ta, st, phase }

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
  fireObjs.clear(); ratObjs.clear();
  kitchen = new THREE.Group();
  scene.add(kitchen);

  // podklad + zadní zeď
  const ground = M(geo('Plane', 60, 40), '#1b110c', 8, -0.06, 5, kitchen, { noShadow: true });
  ground.rotation.x = -Math.PI / 2;
  const WH = 2.8;
  M(geo('Box', 17, WH, 0.5), theme.kwall, 8, WH / 2, -0.25, kitchen);          // zadní zeď
  M(geo('Box', 0.5, WH, 18), theme.kwall, -0.25, WH / 2, 8.5, kitchen);        // levá zeď (kuchyně + sklad)
  M(geo('Box', 0.5, WH, 7.5), '#9a9488', 16.25, WH / 2, 13.75, kitchen);       // pravá zeď skladu
  M(geo('Box', 17, WH, 0.5), '#9a9488', 8, WH / 2, 17.25, kitchen);            // zadní zeď skladu
  M(geo('Box', 17, 0.3, 0.55), '#46455a', 8, 0.15, -0.0, kitchen, { noShadow: true });
  const ceil = M(geo('Plane', 17, 11), theme.ceil, 8, WH, 5, kitchen, { noShadow: true });
  ceil.rotation.x = Math.PI / 2;
  const wceil = M(geo('Plane', 17, 7.5), '#d9d3c4', 8, WH, 13.75, kitchen, { noShadow: true });
  wceil.rotation.x = Math.PI / 2;
  [4, 12].forEach((lx) => M(geo('Box', 1.8, 0.06, 0.6), '#fffbe8', lx, WH - 0.04, 13.5, kitchen, { noShadow: true, mat: { emissive: '#fff2c0' } }));
  const skl = labelSprite('SKLAD', '#ffe9b0', 1.4);
  skl.position.set(3, 2.2, 10.9);
  kitchen.add(skl);
  for (let lx = 0; lx < 3; lx++) {
    for (let lz = 0; lz < 2; lz++) {
      const lamp = M(geo('Box', 1.6, 0.06, 0.7), '#fffbe8', 3 + lx * 5, WH - 0.04, 2.6 + lz * 4.8, kitchen, { noShadow: true, mat: { emissive: '#fff2c0' } });
      lamp.castShadow = false;
    }
  }

  const wTiles = [];
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < COLS; x++) {
      const ch = map[y][x];
      const cx = x + 0.5, cz = y + 0.5;
      if (ch === '.') {
        const f = M(geo('Box', 1, 0.1, 1), y >= 10 ? ((x + y) % 2 ? '#c9c1b1' : '#d2cabb') : ((x + y) % 2 ? '#e6d6b2' : '#eddfbf'), cx, -0.05, cz, kitchen, { noShadow: true });
        f.castShadow = false;
        continue;
      }
      if (ch === '#') {
        M(geo('Box', 1, WH, 1), theme.kwall, cx, WH / 2, cz, kitchen);
        M(geo('Box', 1.02, 0.14, 1.02), '#46455a', cx, 0.07, cz, kitchen);
        continue;
      }
      if (rackMap[ch]) {                                  // regál s krabicemi ve skladu
        const rk = rackMap[ch];
        [[-0.46, -0.44], [0.46, -0.44], [-0.46, 0.44], [0.46, 0.44]].forEach((q) => M(geo('Box', 0.06, 1.9, 0.06), '#8d949b', cx + q[0], 0.95, cz + q[1], kitchen));
        [0.5, 1.1, 1.7].forEach((yy) => M(geo('Box', 0.98, 0.05, 0.92), '#aab2b9', cx, yy, cz, kitchen));
        const lb = labelSprite(NAMES[rk], '#fff', 0.95);
        lb.position.set(cx, 2.15, cz + 0.2);
        kitchen.add(lb);
        dyn[x + ',' + y] = { ch: 'R', x, y, k: rk };
        addText(x, y, 'rack', rk);
        continue;
      }
      if (ch === '=') {                                   // palety (ozdoba)
        M(geo('Box', 0.96, 0.14, 0.96), '#a47a3f', cx, 0.07, cz, kitchen);
        [[-0.22, 0.34, -0.2, 0], [0.2, 0.34, 0.2, 0.5], [-0.18, 0.7, 0.18, 0.2]].forEach((q) => {
          const bx = M(geo('Box', 0.42, 0.34, 0.42), '#b98b4f', cx + q[0], q[1] + 0.07, cz + q[2], kitchen);
          bx.rotation.y = q[3];
        });
        continue;
      }
      if (crateMap[ch]) {
        counter(kitchen, x, y);
        M(geo('Box', 0.74, 0.34, 0.74), '#a9743c', cx, TOP + 0.17, cz, kitchen);
        M(geo('Box', 0.78, 0.05, 0.78), '#8a5c2b', cx, TOP + 0.34, cz, kitchen);
        M(geo('Box', 0.76, 0.04, 0.02), '#6f4a20', cx, TOP + 0.12, cz + 0.375, kitchen, { noShadow: true });
        const k = crateMap[ch];
        dyn[x + ',' + y] = { ch: 'S', x, y, k };          // vystavené kusy podle zásoby na polici
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
          if (theme.stove === 'cooker') {                 // sushi: rýžovar
            M(geo('Box', 1, TOP - 0.08, 1), '#b0bec5', cx, (TOP - 0.08) / 2, cz, kitchen);
            M(geo('Box', 1.02, 0.08, 1.02), '#eceff1', cx, TOP - 0.04, cz, kitchen);
            M(geo('Cylinder', 0.4, 0.4, 0.28, 18), '#fafafa', cx, TOP + 0.14, cz, kitchen);
            M(geo('Cylinder', 0.33, 0.33, 0.02, 18), '#3b4750', cx, TOP + 0.285, cz, kitchen, { noShadow: true });
            M(geo('Box', 0.2, 0.1, 0.06), '#455a64', cx, TOP + 0.1, cz + 0.4, kitchen, { noShadow: true });
            M(geo('Sphere', 0.03, 6, 5), '#ff5252', cx + 0.05, TOP + 0.1, cz + 0.43, kitchen, { noShadow: true, mat: { emissive: '#ff1744' } });
          } else if (theme.stove === 'oven') {            // pizza: kamnená pec
            M(geo('Box', 1, TOP - 0.08, 1), '#8d4a32', cx, (TOP - 0.08) / 2, cz, kitchen);
            M(geo('Box', 1.02, 0.08, 1.02), '#a86044', cx, TOP - 0.04, cz, kitchen);
            const dome = M(geo('Sphere', 0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#a1583a', cx, TOP, cz - 0.14, kitchen);
            dome.scale.y = 0.75;
            M(geo('Box', 0.4, 0.2, 0.1), '#1a0f0a', cx, TOP + 0.12, cz + 0.28, kitchen, { noShadow: true, mat: { emissive: '#7a1d00' } });
            M(geo('Cylinder', 0.34, 0.34, 0.03, 18), '#bdb6a6', cx, TOP + 0.015, cz + 0.16, kitchen, { noShadow: true });
          } else {
            M(geo('Box', 1, TOP - 0.08, 1), '#2b2d33', cx, (TOP - 0.08) / 2, cz, kitchen);
            M(geo('Box', 1.02, 0.08, 1.02), '#3d4048', cx, TOP - 0.04, cz, kitchen);
            const ring = M(geo('Torus', 0.27, 0.04, 8, 22), '#5a5e68', cx, TOP + 0.03, cz, kitchen, { noShadow: true });
            ring.rotation.x = Math.PI / 2;
            M(geo('Cylinder', 0.22, 0.22, 0.02, 18), '#17181c', cx, TOP + 0.02, cz, kitchen, { noShadow: true });
          }
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
        case 'U': {
          counter(kitchen, x, y);
          for (let i = 0; i < 4; i++) {
            const cup = makeCup(null);
            cup.scale.setScalar(0.62);
            cup.position.set(cx + (i % 2 ? 0.2 : -0.2), TOP, cz + (i < 2 ? -0.18 : 0.2));
            kitchen.add(cup);
          }
          const lb = labelSprite('KELÍMKY', '#fff', 0.95);
          lb.position.set(cx, TOP + 0.95, cz);
          kitchen.add(lb);
          break;
        }
        case 'A': case 'E': case 'O': {
          const dk = TAP[ch];
          counter(kitchen, x, y);
          M(geo('Box', 0.84, 0.8, 0.46), '#2f3640', cx, TOP + 0.4, cz - 0.24, kitchen);
          M(geo('Box', 0.7, 0.34, 0.04), DRINK_COL[dk], cx, TOP + 0.5, cz + 0.0, kitchen, { noShadow: true, mat: { emissive: DRINK_COL[dk] } });
          M(geo('Cylinder', 0.05, 0.05, 0.2, 8), '#aab4bd', cx, TOP + 0.7, cz + 0.06, kitchen);
          M(geo('Box', 0.5, 0.04, 0.4), '#555d66', cx, TOP + 0.02, cz + 0.2, kitchen, { noShadow: true });
          const lb = labelSprite(NAMES[dk], '#fff', 0.95);
          lb.position.set(cx, TOP + 1.05, cz);
          kitchen.add(lb);
          addBar(x, y, 'T');
          addText(x, y, 'stock', dk);
          break;
        }
        case 'Y': {
          counter(kitchen, x, y);
          M(geo('Box', 0.5, 0.05, 0.5), '#8d949b', cx, TOP + 0.025, cz, kitchen, { noShadow: true });
          dyn[x + ',' + y] = { ch, x, y };
          const lb = labelSprite('HASICÁK', '#ffb3a8', 0.95);
          lb.position.set(cx, TOP + 1.0, cz);
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
    d.g.position.set(d.x + 0.5, d.ch === 'R' ? 0 : TOP, d.y + 0.5);
    d.sig = null;
    kitchen.add(d.g);
  }

  buildDining();

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
    else if (d.ch === 'Y') sig = s && s.x ? '1' : '0';
    else if (d.ch === 'S') sig = !s || !s.n ? '0' : s.n <= 5 ? '1' : s.n <= 10 ? '2' : '3';
    else if (d.ch === 'R') sig = String(!s ? 0 : s.n < 0 ? 6 : Math.min(6, s.n));
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
    const style = theme.stove;
    const dz = style === 'oven' ? 0.16 : 0;
    const raise = style === 'cooker' ? 0.28 : style === 'oven' ? 0.04 : 0.1;
    if (style === 'stove') {
      M(geo('Cylinder', 0.36, 0.3, 0.09, 18), '#15161a', 0, 0.06, 0, d.g);
      M(geo('Box', 0.34, 0.04, 0.08), '#15161a', -0.45, 0.1, 0, d.g);
    }
    const food = makeIng(s.i.k, s.i.s);
    food.scale.setScalar(0.5);
    food.position.set(0, raise, dz);
    d.g.add(food);
    const st = s.i.s;
    if (st === 'burnt') {
      d.smoke = [];
      for (let i = 0; i < 3; i++) {
        const sm = M(geo('Sphere', 0.12, 8, 6), '#555555', 0, 0.3, dz, d.g, { noShadow: true, mat: { transparent: true, opacity: 0.5 } });
        sm.material = sm.material.clone();
        sm.userData.i = i;
        d.smoke.push(sm);
      }
    } else if (style === 'cooker') {                       // pára z rýžovaru
      d.smoke = [];
      for (let i = 0; i < 3; i++) {
        const sm = M(geo('Sphere', 0.1, 8, 6), '#ffffff', 0, 0.4, 0, d.g, { noShadow: true, mat: { transparent: true, opacity: 0.4 } });
        sm.material = sm.material.clone();
        sm.userData.i = i;
        d.smoke.push(sm);
      }
    } else {
      d.flames = [];
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const f = M(geo('Cone', 0.06, 0.2, 6), i % 2 ? '#ffb300' : '#ff6d00', Math.cos(a) * 0.27, 0.06, dz + Math.sin(a) * 0.27, d.g, { noShadow: true, mat: { emissive: i % 2 ? '#aa6600' : '#aa3300' } });
        d.flames.push(f);
      }
    }
  } else if (d.ch === 'S') {
    const cnt = Number(d.sig);
    [[-0.17, -0.1], [0.17, -0.1], [0, 0.17]].slice(0, cnt).forEach((q, i) => {
      const it = makeIng(d.k, 'raw');
      it.scale.setScalar(0.38);
      it.position.set(q[0], 0.36, q[1]);
      it.rotation.y = i * 1.3;
      d.g.add(it);
    });
  } else if (d.ch === 'R') {
    const cnt = Number(d.sig);
    for (let i = 0; i < cnt; i++) {
      const bx = makeBoxModel(d.k);
      bx.position.set(i % 2 ? 0.24 : -0.24, [0.525, 1.125, 1.725][Math.floor(i / 2)], 0);
      d.g.add(bx);
    }
  } else if (d.ch === 'Y') {
    if (d.sig === '1') { const e = makeExt(); e.scale.setScalar(0.8); e.position.y = 0.05; d.g.add(e); }
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

/* ---------- oheň ---------- */
const bmatCache = {};
const bmat = (c) => bmatCache[c] || (bmatCache[c] = new THREE.MeshBasicMaterial({ color: c }));

function makeFire(x, y) {
  const g = new THREE.Group();
  g.position.set(x + 0.5, TOP, y + 0.5);
  const flames = [];
  for (let i = 0; i < 10; i++) {
    const a = i * 2.4, r = i === 0 ? 0 : 0.12 + (i % 3) * 0.1;
    const f = new THREE.Mesh(geo('Cone', 0.13, 0.5, 6), bmat(['#ff5a00', '#ff9d00', '#ffd23a'][i % 3]));
    f.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
    g.add(f);
    flames.push(f);
  }
  const smoke = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(geo('Sphere', 0.16, 8, 6), new THREE.MeshBasicMaterial({ color: '#3a3a3a', transparent: true, opacity: 0.5 }));
    m.userData.i = i;
    g.add(m);
    smoke.push(m);
  }
  const bar = mkEl('bar firebar', '<i></i><span>🔥</span>');
  return { g, flames, smoke, bar, fill: bar.firstChild, x, y };
}

function updateFires(tm) {
  const live = new Set();
  for (const f of snap.fi || []) {
    const key = f.x + ',' + f.y;
    live.add(key);
    let o = fireObjs.get(key);
    if (!o) { o = makeFire(f.x, f.y); fireObjs.set(key, o); kitchen.add(o.g); }
    const size = 0.35 + 0.65 * f.h;
    o.flames.forEach((fl, i) => {
      const k = size * (0.75 + 0.45 * Math.sin(tm * 11 + i * 1.9));
      fl.scale.set(size, Math.max(0.15, k) * 1.5, size);
      fl.position.y = 0.05 + 0.25 * Math.max(0.15, k);
    });
    o.smoke.forEach((m) => {
      const ph = (tm * 0.6 + m.userData.i / 4) % 1;
      m.position.set(Math.sin(ph * 7 + m.userData.i * 2) * 0.15, 0.5 + ph * 1.1, Math.cos(ph * 5 + m.userData.i) * 0.15);
      m.scale.setScalar(0.8 + ph * 1.6);
      m.material.opacity = 0.55 * (1 - ph);
    });
    o.fill.style.width = Math.max(4, f.h * 100) + '%';
    place(o.bar, f.x + 0.5, TOP + 1.0, f.y + 0.5);
  }
  for (const [key, o] of [...fireObjs]) {
    if (live.has(key)) continue;
    kitchen.remove(o.g); o.bar.remove(); fireObjs.delete(key);
  }
}

/* ---------- krysy ---------- */
function makeRat() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const bd = M(geo('Sphere', 0.16, 10, 8), '#7b7b83', 0, 0.15, -0.02, body);
  bd.scale.set(1, 0.8, 1.6);
  M(geo('Sphere', 0.1, 10, 8), '#8d8d96', 0, 0.17, 0.26, body);
  M(geo('Cone', 0.045, 0.12, 6), '#e8a0b4', 0, 0.15, 0.37, body, { noShadow: true }).rotation.x = Math.PI / 2;
  M(geo('Sphere', 0.045, 6, 5), '#e8a0b4', -0.075, 0.27, 0.2, body, { noShadow: true });
  M(geo('Sphere', 0.045, 6, 5), '#e8a0b4', 0.075, 0.27, 0.2, body, { noShadow: true });
  M(geo('Sphere', 0.018, 5, 4), '#ff2a2a', -0.04, 0.2, 0.34, body, { noShadow: true });
  M(geo('Sphere', 0.018, 5, 4), '#ff2a2a', 0.04, 0.2, 0.34, body, { noShadow: true });
  const tail = M(geo('Cylinder', 0.014, 0.006, 0.42, 6), '#e8a0b4', 0, 0.1, -0.4, body, { noShadow: true });
  tail.rotation.x = Math.PI / 2;
  return { g, body, tail };
}

function updateRats(dt, tm) {
  const live = new Set();
  for (const r of snap.rt || []) {
    live.add(r.id);
    let o = ratObjs.get(r.id);
    if (!o) {
      const m = makeRat();
      o = { g: m.g, body: m.body, tail: m.tail, x: r.x, y: r.y, ang: r.a, phase: 0 };
      ratObjs.set(r.id, o);
      kitchen.add(o.g);
    }
    o.tx = r.x; o.ty = r.y; o.ta = r.a; o.st = r.s;
  }
  for (const [id, o] of [...ratObjs]) {
    if (!live.has(id)) { kitchen.remove(o.g); ratObjs.delete(id); continue; }
    const ox = o.x, oy = o.y, k = Math.min(1, dt * 12);
    o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
    const moving = dt > 0 && Math.hypot(o.x - ox, o.y - oy) / dt > 0.3;
    let diff = o.ta - o.ang;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    o.ang += diff * Math.min(1, dt * 14);
    if (moving) o.phase += dt * 24;
    o.g.position.set(o.x, moving ? Math.abs(Math.sin(o.phase)) * 0.03 : 0, o.y);
    o.g.rotation.y = o.ang;
    o.body.rotation.x = o.st === 1 ? Math.sin(tm * 18) * 0.18 : 0;      // hlodá
    o.tail.rotation.z = Math.sin(tm * 9 + o.x) * 0.5;
  }
}

/* ---------- sprej z hasicáku (u kamery) ---------- */
const sprayG = new THREE.Group();
sprayG.position.set(0.3, -0.35, -0.7);
sprayG.visible = false;
camera.add(sprayG);
const sprayDots = [];
for (let i = 0; i < 14; i++) {
  const d = new THREE.Mesh(geo('Sphere', 0.05, 6, 5), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
  d.userData.i = i;
  sprayG.add(d);
  sprayDots.push(d);
}
function updateSpray(tm) {
  const a = actors.get(myId);
  const ext = a && a.h && a.h.t === 'x' && a.h.c > 0;
  let on = false;
  if (ext && holdNow() && me && snap && snap.fi) {
    const [tx, ty] = targetTile(me);
    on = snap.fi.some((f) => f.x === tx && f.y === ty);
  }
  sprayG.visible = on;
  if (!on) return;
  sprayDots.forEach((d) => {
    const ph = (tm * 2.4 + d.userData.i / sprayDots.length) % 1;
    d.position.set((Math.random() - 0.5) * 0.05 * ph, (Math.random() - 0.5) * 0.05 * ph + 0.1 * ph, -ph * 1.4);
    d.scale.setScalar(0.6 + ph * 2.2);
    d.material.opacity = 0.75 * (1 - ph);
  });
}

/* =====================================================================
 *  Restaurace za výdejním oknem: jídelna, hosté u stolů a číšníci.
 *  Hosté se objeví s každou objednávkou, jídlo z výdeje se objeví na druhém
 *  pultu a číšník ho odnese k jejich stolu. Je to jen vizuální vrstva –
 *  řídí se událostmi a snapshotem ze serveru.
 * ===================================================================== */
const DWH = 2.8;                                         // výška stěn jídelny
const TABLE_X = [21.5, 26, 30.5], TABLE_Z = [2.2, 7.8];  // středy stolů
const AISLE_Z = 5.0;                                     // hlavní ulička
const DOOR = { x: 34.2, z: 5.0 };                        // vchod pro hosty
const SLOT_X = 16.95;                                    // vystavené jídlo na druhém pultu
const SLOT_Z = [3.4, 4.0, 4.6, 5.2, 5.8, 6.4];
const WAITER_HOME = [[18.7, 3.7], [18.7, 6.3]];
const SKINS = ['#f5cfa0', '#e0ac80', '#c68642', '#8d5524'];
const SHIRTS = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#a1887f', '#fff176'];
const HAIRS = ['#2b1b10', '#5a3b1e', '#c9a227', '#161616', '#8b2c1b', '#d9d9d9'];

let dining = null;                // skupina s dynamickými věcmi (hosté, číšníci, jídlo)
let seats = [];
let customers = new Map();        // id objednávky -> host
let waiters = [];
let jobs = [];                    // fronta rozvozu
let slots = [];                   // obsazení míst na výdejním pultu
let ambients = [];
let restClock = 0;               // herní čas jídelny (s)
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

/* ---------- postavy ---------- */
function makePerson(o) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  const legs = new THREE.Group();
  g.add(body, legs);
  M(geo('Cylinder', 0.2, 0.24, 0.5, 12), o.shirt, 0, 0.45, 0, body);
  M(geo('Sphere', 0.17, 14, 10), o.skin, 0, 0.86, 0, body);
  const hair = M(geo('Sphere', 0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), o.hair, 0, 0.88, -0.015, body);
  hair.rotation.x = -0.2;
  M(geo('Sphere', 0.022, 6, 4), '#222222', -0.06, 0.89, 0.15, body, { noShadow: true });
  M(geo('Sphere', 0.022, 6, 4), '#222222', 0.06, 0.89, 0.15, body, { noShadow: true });
  if (o.apron) {
    M(geo('Box', 0.36, 0.34, 0.04), '#1d1d1d', 0, 0.4, 0.22, body);
    M(geo('Box', 0.12, 0.05, 0.04), '#b71c1c', 0, 0.68, 0.2, body, { noShadow: true });
  }
  const mkArm = (x) => {
    const a = new THREE.Group();
    a.position.set(x, 0.66, 0);
    M(geo('Box', 0.08, 0.4, 0.08), o.apron ? '#ffffff' : o.shirt, 0, -0.18, 0, a);
    M(geo('Sphere', 0.05, 6, 5), o.skin, 0, -0.4, 0, a, { noShadow: true });
    body.add(a);
    return a;
  };
  const armL = mkArm(-0.27), armR = mkArm(0.27);
  const holder = new THREE.Group();
  holder.position.set(0, 0.7, 0.44);
  body.add(holder);
  const p = { g, body, legs, armL, armR, holder, seated: false, o };
  setSeated(p, false);
  return p;
}
function setSeated(p, seated) {
  p.seated = seated;
  clearGroup(p.legs);
  const pants = p.o.pants || '#33405a';
  if (seated) {
    p.body.position.y = 0.32;
    [-0.1, 0.1].forEach((x) => {
      M(geo('Box', 0.1, 0.1, 0.4), pants, x, 0.56, 0.22, p.legs);
      M(geo('Box', 0.1, 0.5, 0.1), pants, x, 0.27, 0.4, p.legs);
    });
    p.armL.rotation.x = -1.0; p.armR.rotation.x = -1.0;
  } else {
    p.body.position.y = 0;
    [-0.1, 0.1].forEach((x) => M(geo('Cylinder', 0.08, 0.08, 0.22, 8), pants, x, 0.11, 0, p.legs));
    p.armL.rotation.x = 0; p.armR.rotation.x = 0;
  }
}
function randomLook() { return { shirt: rnd(SHIRTS), skin: rnd(SKINS), hair: rnd(HAIRS), pants: rnd(['#33405a', '#4a3b2a', '#2d2d2d', '#5a4a6a']) }; }

// jednoduchý pohyb po cestě [[x,z], ...]
function npcStep(n, dt) {
  n.moving = false;
  if (n.path && n.path.length) {
    const t = n.path[0];
    const dx = t[0] - n.x, dz = t[1] - n.z, d = Math.hypot(dx, dz), step = n.speed * dt;
    if (d <= step) {
      n.x = t[0]; n.z = t[1]; n.path.shift();
      if (!n.path.length && n.onArrive) { const f = n.onArrive; n.onArrive = null; f(); }
    } else {
      n.x += dx / d * step; n.z += dz / d * step;
      n.tang = Math.atan2(dx, dz);
      n.moving = true;
    }
  } else if (n.look) n.tang = Math.atan2(n.look[0] - n.x, n.look[1] - n.z);
  let diff = n.tang - n.ang;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  n.ang += diff * Math.min(1, dt * 10);
  if (n.moving) n.phase += dt * n.speed * 5;
}
function npcApply(n) {
  const pr = n.person;
  pr.g.position.set(n.x, 0, n.z);
  pr.g.rotation.y = n.ang;
}
function animPerson(n, tm) {
  const pr = n.person;
  if (pr.seated) {
    pr.body.position.y = 0.32;
    if (n.eating) pr.armR.rotation.x = -1.0 + Math.sin(tm * 6) * 0.45;
    else pr.armR.rotation.x = -1.0;
    pr.body.rotation.x = n.angry ? Math.sin(tm * 25) * 0.04 : 0;
  } else {
    if (n.carry) { pr.armL.rotation.x = -1.15; pr.armR.rotation.x = -1.15; }
    else if (n.moving) { pr.armL.rotation.x = Math.sin(n.phase) * 0.7; pr.armR.rotation.x = -Math.sin(n.phase) * 0.7; }
    else { pr.armL.rotation.x = 0; pr.armR.rotation.x = 0; }
    pr.body.position.y = n.moving ? Math.abs(Math.sin(n.phase)) * 0.045 : 0;
  }
}

/* ---------- bublina s objednávkou ---------- */
function makeBubble() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 112;
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sp.scale.set(1.5, 0.66, 1);
  sp.position.set(0, 2.0, 0);
  sp.renderOrder = 5;
  return { cv, tex, sp, sig: '' };
}
function drawBubble(c, frac) {
  const b = c.bubble;
  const bucket = Math.floor(frac * 12);
  const sig = [c.state, c.delivered.food, c.delivered.drink, c.served.food, c.served.drink, c.angry, bucket].join('|');
  if (sig === b.sig) return;
  b.sig = sig;
  const x = b.cv.getContext('2d');
  x.clearRect(0, 0, 256, 112);
  x.fillStyle = 'rgba(255,255,255,0.96)';
  x.strokeStyle = c.angry ? '#d32f2f' : '#3a2615';
  x.lineWidth = 5;
  x.beginPath();
  if (x.roundRect) x.roundRect(8, 6, 240, 80, 20); else x.rect(8, 6, 240, 80);
  x.fill(); x.stroke();
  x.beginPath(); x.moveTo(110, 86); x.lineTo(128, 108); x.lineTo(146, 86); x.closePath(); x.fill();
  x.font = '40px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (c.angry) {
    x.fillText('😠', 128, 46);
  } else if (c.state === 'eat') {
    x.fillText('😋', 128, 46);
  } else {
    const parts = [];
    if (c.foodIcons) parts.push({ t: c.foodIcons, done: c.served.food || c.delivered.food });
    if (c.drinkIcon) parts.push({ t: c.drinkIcon, done: c.served.drink || c.delivered.drink });
    const widths = parts.map((p) => x.measureText(p.t).width);
    const total = widths.reduce((a, w) => a + w, 0) + (parts.length - 1) * 18;
    let cx = 128 - total / 2;
    parts.forEach((p, i) => {
      x.globalAlpha = p.done ? 0.3 : 1;
      x.textAlign = 'left';
      x.fillText(p.t, cx, 44);
      cx += widths[i] + 18;
    });
    x.globalAlpha = 1;
    // trpělivost
    x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(34, 66, 188, 9);
    x.fillStyle = frac > 0.5 ? '#66bb6a' : frac > 0.25 ? '#ffca28' : '#ef5350';
    x.fillRect(34, 66, 188 * Math.max(0.03, frac), 9);
  }
  b.tex.needsUpdate = true;
}

/* ---------- nábytek ---------- */
function makeChair(x, z, ang) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ang;
  M(geo('Box', 0.52, 0.06, 0.52), '#8a5a2b', 0, 0.47, 0, g);
  M(geo('Box', 0.52, 0.55, 0.06), '#8a5a2b', 0, 0.78, -0.24, g);
  [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach((q) => M(geo('Box', 0.06, 0.45, 0.06), '#5f3d1b', q[0], 0.225, q[1], g));
  return g;
}
function makeTable(x, z, cloth) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  M(geo('Cylinder', 0.66, 0.66, 0.06, 20), cloth, 0, 0.75, 0, g);
  M(geo('Cylinder', 0.1, 0.1, 0.72, 10), '#5f3d1b', 0, 0.38, 0, g);
  M(geo('Cylinder', 0.36, 0.4, 0.05, 14), '#5f3d1b', 0, 0.03, 0, g);
  M(geo('Cylinder', 0.03, 0.03, 0.12, 6), '#ffffff', 0.15, 0.84, 0.1, g, { noShadow: true });       // svíčka
  M(geo('Sphere', 0.02, 6, 4), '#ffd54f', 0.15, 0.91, 0.1, g, { noShadow: true, mat: { emissive: '#ffb300' } });
  return g;
}
function makePlant(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  M(geo('Cylinder', 0.28, 0.2, 0.45, 10), '#a1522a', 0, 0.225, 0, g);
  [[0, 0.8, 0, 0.3], [-0.15, 0.65, 0.1, 0.22], [0.16, 0.7, -0.08, 0.24]].forEach((q) => M(geo('Sphere', q[3], 8, 6), '#3d8f3a', q[0], q[1], q[2], g));
  return g;
}
function makeFloorTexture(tone) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const x = cv.getContext('2d');
  for (let r = 0; r < 16; r++) {
    let px = -((r * 37) % 90);
    while (px < 512) {
      const w = 70 + ((px * 13 + r * 7) % 60);
      const d = ((px * 31 + r * 17) % 40) - 20;
      x.fillStyle = 'rgb(' + (tone[0] + d) + ',' + (tone[1] + d) + ',' + (tone[2] + d) + ')';
      x.fillRect(px, r * 16, w - 1, 15);
      px += w;
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

function buildDining() {
  dining = new THREE.Group();
  kitchen.add(dining);
  customers = new Map(); waiters = []; jobs = []; ambients = [];
  slots = SLOT_Z.map(() => null);

  const K = kitchen;
  const MIDX = 25.75;
  // podlaha a koberec
  const fl = new THREE.Mesh(geo('Plane', 18, 10), new THREE.MeshLambertMaterial({ map: makeFloorTexture(theme.floor) }));
  fl.rotation.x = -Math.PI / 2; fl.position.set(25.5, 0.002, 5); fl.receiveShadow = true;
  K.add(fl);
  M(geo('Box', 17.2, 0.02, 1.7), theme.carpet[0], 25.6, 0.012, AISLE_Z, K, { noShadow: true });
  M(geo('Box', 17.2, 0.022, 1.3), theme.carpet[1], 25.6, 0.013, AISLE_Z, K, { noShadow: true });

  // stěny (zadní a přední s okny, pravá se vchodem)
  M(geo('Box', 18.6, DWH, 0.5), theme.wall, MIDX, DWH / 2, -0.25, K);
  M(geo('Box', 18.6, DWH, 0.5), theme.wall, MIDX, DWH / 2, 10.25, K);
  M(geo('Box', 0.5, DWH, 4.5), theme.wall, 34.75, DWH / 2, 1.75, K);
  M(geo('Box', 0.5, DWH, 4.5), theme.wall, 34.75, DWH / 2, 8.25, K);
  M(geo('Box', 0.5, 0.7, 2.0), theme.wall, 34.75, DWH - 0.35, 5.0, K);
  M(geo('Box', 18.6, 0.9, 0.06), theme.wains, MIDX, 0.45, 0.03, K, { noShadow: true });        // dřevěný lem
  M(geo('Box', 18.6, 0.9, 0.06), theme.wains, MIDX, 0.45, 9.97, K, { noShadow: true });
  // vchod
  M(geo('Box', 0.12, 2.1, 0.12), '#4a2f18', 34.45, 1.05, 3.94, K);
  M(geo('Box', 0.12, 2.1, 0.12), '#4a2f18', 34.45, 1.05, 6.06, K);
  M(geo('Box', 0.12, 0.12, 2.24), '#4a2f18', 34.45, 2.1, 5.0, K);
  M(geo('Box', 0.05, 1.95, 0.95), '#9ad4f5', 34.42, 1.0, 4.45, K, { noShadow: true, mat: { transparent: true, opacity: 0.45 } });
  M(geo('Box', 0.05, 1.95, 0.95), '#9ad4f5', 34.42, 1.0, 5.55, K, { noShadow: true, mat: { transparent: true, opacity: 0.45 } });
  M(geo('Box', 0.05, 2.4, 3.2), '#cfeaff', 36.3, 1.2, 5.0, K, { noShadow: true, mat: { emissive: '#8fc6f0' } });   // světlo z ulice
  const wel = labelSprite(theme.sign, '#ffe9b0', 1.3);
  wel.position.set(34.2, 2.45, 5.0);
  K.add(wel);
  // okna
  [19.8, 24, 28.2, 32.4].forEach((x) => {
    [[0.04, 1], [9.96, -1]].forEach(([z, s]) => {
      M(geo('Box', 2.1, 1.35, 0.05), theme.win, x, 1.65, z, K, { noShadow: true, mat: { emissive: '#6fa8d6' } });
      M(geo('Box', 2.3, 0.08, 0.1), '#5a3b1e', x, 2.36, z - s * 0.02, K, { noShadow: true });
      M(geo('Box', 2.3, 0.08, 0.1), '#5a3b1e', x, 0.95, z - s * 0.02, K, { noShadow: true });
      M(geo('Box', 0.08, 1.4, 0.1), '#5a3b1e', x - 1.1, 1.65, z - s * 0.02, K, { noShadow: true });
      M(geo('Box', 0.08, 1.4, 0.1), '#5a3b1e', x + 1.1, 1.65, z - s * 0.02, K, { noShadow: true });
      M(geo('Box', 0.05, 1.35, 0.1), '#5a3b1e', x, 1.65, z - s * 0.02, K, { noShadow: true });
      M(geo('Box', 0.35, 1.4, 0.08), theme.curtain, x - 1.35, 1.6, z - s * 0.05, K, { noShadow: true });     // závěsy
      M(geo('Box', 0.35, 1.4, 0.08), theme.curtain, x + 1.35, 1.6, z - s * 0.05, K, { noShadow: true });
    });
  });
  const menu = labelSprite(theme.menu, '#fff3d0', 1.6);
  menu.position.set(18.2, 2.3, 0.2);
  K.add(menu);
  const ceil = M(geo('Plane', 18.6, 11), theme.ceil, MIDX, DWH, 5, K, { noShadow: true });
  ceil.rotation.x = Math.PI / 2;

  // okénko mezi kuchyní a jídelnou: stěna kuchyně s otvorem nad pultem
  M(geo('Box', 0.5, DWH, 3.5), theme.kwall, 16.25, DWH / 2, 1.25, K);
  M(geo('Box', 0.5, DWH, 3.5), theme.kwall, 16.25, DWH / 2, 8.75, K);
  M(geo('Box', 0.5, 0.8, 4.0), theme.kwall, 16.25, DWH - 0.4, 5.0, K);
  M(geo('Box', 0.52, TOP - 0.08, 4.0), '#7d4f25', 16.25, (TOP - 0.08) / 2, 5.0, K);
  M(geo('Box', 0.52, 0.08, 4.04), '#3a9b78', 16.25, TOP - 0.04, 5.0, K);
  // druhý pult – vystavené jídlo
  M(geo('Box', 0.95, TOP - 0.08, 4.0), '#7d4f25', 16.975, (TOP - 0.08) / 2, 5.0, K);
  M(geo('Box', 1.0, 0.08, 4.04), '#e9e4d8', 16.98, TOP - 0.04, 5.0, K);
  M(geo('Box', 0.06, 0.36, 4.0), '#bfe4ff', 17.45, TOP + 0.2, 5.0, K, { noShadow: true, mat: { transparent: true, opacity: 0.22 } });     // sklo
  M(geo('Box', 0.1, 0.05, 4.0), '#ff9a3c', 17.0, 1.75, 5.0, K, { noShadow: true, mat: { emissive: '#ff7a1a' } });                        // ohřívací lampa
  M(geo('Box', 0.05, 0.75, 0.05), '#8d949b', 17.0, 1.38, 3.05, K, { noShadow: true });
  M(geo('Box', 0.05, 0.75, 0.05), '#8d949b', 17.0, 1.38, 6.95, K, { noShadow: true });
  const vd = labelSprite('HOTOVÁ JÍDLA', '#e9fff5', 1.5);
  vd.position.set(17.9, 2.1, 5.0);
  K.add(vd);

  // stoly, židle, svítidla
  seats = [];
  TABLE_X.forEach((tx, ix) => TABLE_Z.forEach((tz, iz) => {
    K.add(makeTable(tx, tz, theme.cloth[(ix + iz) % 2]));
    M(geo('Cylinder', 0.01, 0.01, 0.9, 5), '#222222', tx, DWH - 0.45, tz, K, { noShadow: true });
    M(geo('Cylinder', 0.14, 0.42, 0.28, 12), theme.lamp, tx, 1.95, tz, K, { noShadow: true });
    M(geo('Sphere', 0.1, 8, 6), '#fff3b0', tx, 1.78, tz, K, { noShadow: true, mat: { emissive: '#fff3b0' } });
    const aisle = iz === 0 ? 1 : -1;
    [[aisle, false], [-aisle, ix !== 1]].forEach(([sgn, amb]) => {
      const cz = tz + sgn * 0.95;
      K.add(makeChair(tx, cz, Math.atan2(0, -sgn)));           // opěradlo na vzdálené straně od stolu
      seats.push({ tx, tz, cx: tx, cz, ambient: amb, busy: false, face: Math.atan2(0, -sgn) });
    });
  }));
  // pasivní hosté, ať je jídelna živá
  seats.filter((s) => s.ambient).forEach((s) => {
    const person = makePerson(randomLook());
    setSeated(person, true);
    const n = { person, x: s.cx, z: s.cz, ang: s.face, tang: s.face, phase: Math.random() * 6, eating: true, path: [], speed: 0 };
    npcApply(n);
    person.g.position.y = 0;
    dining.add(person.g);
    const sign = s.cz > s.tz ? -1 : 1;
    const plate = makePlate(['bun', 'meat'], false);
    plate.scale.setScalar(0.5);
    plate.position.set(s.tx + (Math.random() - 0.5) * 0.2, 0.78, s.tz + (s.cz > s.tz ? 0.3 : -0.3));
    dining.add(plate);
    n.t0 = Math.random() * 10; n.sign = sign;
    ambients.push(n);
  });
  [[17.5, 0.8], [34.0, 0.8], [34.0, 9.2], [17.5, 9.2]].forEach((q) => K.add(makePlant(q[0], q[1])));

  // číšníci
  WAITER_HOME.forEach((h, i) => {
    const person = makePerson({ shirt: '#ffffff', skin: rnd(SKINS), hair: rnd(HAIRS), apron: true, pants: '#1d1d1d' });
    const w = { person, x: h[0], z: h[1], ang: -Math.PI / 2, tang: -Math.PI / 2, phase: 0, speed: 2.4, path: [], home: h, state: 'idle', job: null, look: [SLOT_X, h[1]], carry: false, onArrive: null };
    npcApply(w);
    dining.add(person.g);
    waiters.push(w);
  });
}

/* ---------- hosté ---------- */
function spawnCustomer(o, instant) {
  const free = seats.filter((s) => !s.ambient && !s.busy);
  if (!free.length) return;
  const seat = rnd(free);
  seat.busy = true;
  const rec = o.r ? recipes[o.r] : null;
  const person = makePerson(randomLook());
  const c = {
    id: o.id, seat, person, x: DOOR.x, z: DOOR.z, ang: Math.PI / 2, tang: Math.PI / 2, phase: Math.random() * 6, speed: 2.0 + Math.random() * 0.6,
    path: [], onArrive: null, state: 'walkin', angry: false, gone: false, eating: false, eatT: 0, leaving: false,
    foodIcons: rec ? rec.items.map((k) => ICONS[k]).join('') : '', drinkIcon: o.dr ? ICONS[o.dr] : '',
    served: { food: !o.r, drink: !o.dr }, delivered: { food: !o.r, drink: !o.dr }, tableItems: [], bubble: makeBubble(), frac: 1, look: null,
  };
  c.served = { food: false, drink: false }; c.delivered = { food: false, drink: false };
  if (!o.r || o.fd) { c.served.food = true; c.delivered.food = true; }
  if (!o.dr || o.dd) { c.served.drink = true; c.delivered.drink = true; }
  person.g.add(c.bubble.sp);
  dining.add(person.g);
  if (instant) sitCustomer(c);
  else {
    c.path = [[33.0, AISLE_Z], [seat.tx + 1.1, AISLE_Z], [seat.tx + 1.1, seat.cz], [seat.cx, seat.cz]];
    c.onArrive = () => sitCustomer(c);
  }
  npcApply(c);
  customers.set(o.id, c);
}
function sitCustomer(c) {
  c.state = 'wait';
  c.x = c.seat.cx; c.z = c.seat.cz; c.ang = c.seat.face; c.tang = c.seat.face;
  c.path = [];
  setSeated(c.person, true);
  npcApply(c);
}
function customerLeave(c, angry) {
  if (c.leaving) return;
  const wasWalking = c.state === 'walkin';
  c.leaving = true; c.angry = angry; c.state = 'leave'; c.eating = false;
  c.tableItems.forEach((t) => dining.remove(t));
  c.tableItems = [];
  setSeated(c.person, false);
  c.speed = angry ? 3.4 : 2.2;
  c.path = wasWalking ? [[33.0, AISLE_Z], [DOOR.x + 0.4, DOOR.z]]
    : [[c.seat.tx + 1.1, c.seat.cz], [c.seat.tx + 1.1, AISLE_Z], [33.0, AISLE_Z], [DOOR.x + 0.4, DOOR.z]];
  c.onArrive = () => {
    dining.remove(c.person.g);
    c.seat.busy = false;
    customers.delete(c.id);
  };
  c.bubble.sig = '';
}

function syncCustomers(orders) {
  const ids = new Set();
  orders.forEach((o) => {
    ids.add(o.id);
    let c = customers.get(o.id);
    if (!c) { spawnCustomer(o, o.l - o.t > 5); c = customers.get(o.id); }
    if (c) c.frac = Math.max(0, o.t / o.l);
  });
  for (const c of customers.values()) {
    if (!ids.has(c.id)) c.gone = true;        // objednávka zmizela: splněna, nebo propadla
  }
}

/* ---------- rozvoz jídla ---------- */
function restaurantServe(e) {
  if (!dining) return;
  const part = e.part === 'drink' ? 'drink' : 'food';
  const c = customers.get(e.o);
  if (c) c.served[part] = true;
  let si = slots.indexOf(null);
  if (si < 0) si = 0;                                      // všechna místa plná – přepíše se nejstarší
  const item = part === 'drink' ? makeCup(e.d) : makePlate(e.c || [], false);
  item.scale.setScalar(part === 'drink' ? 0.6 : 0.55);
  item.position.set(SLOT_X, TOP, SLOT_Z[si]);
  dining.add(item);
  if (slots[si]) dining.remove(slots[si]);
  slots[si] = item;
  jobs.push({ id: e.o, part, slot: si, item, readyAt: restClock + 1.6, taken: false, e });
}
function restaurantAngry(id) {
  const c = customers.get(id);
  if (c && !c.leaving) customerLeave(c, true);
}

function waiterGoHome(w) {
  const tail = w.job ? w.job.back : [];
  w.job = null; w.carry = false; w.state = 'return';
  w.path = tail.concat([[19.6, AISLE_Z], w.home]);
  w.onArrive = () => { w.state = 'idle'; w.look = [SLOT_X, w.home[1]]; };
}
function waiterPickup(w) {
  const j = w.job;
  const si = slots.indexOf(j.item);
  if (si >= 0) slots[si] = null;
  dining.remove(j.item);
  clearGroup(w.person.holder);
  const tray = j.part === 'drink' ? makeCup(j.e.d) : makePlate(j.e.c || [], false);
  tray.scale.setScalar(j.part === 'drink' ? 0.6 : 0.55);
  w.person.holder.add(tray);
  w.carry = true;
  const c = customers.get(j.id);
  if (!c || c.leaving) {
    w.job.back = []; clearGroup(w.person.holder);
    const k = jobs.indexOf(j); if (k >= 0) jobs.splice(k, 1);
    waiterGoHome(w); return;
  }
  const s = c.seat;
  j.back = [[s.tx + 1.1, s.tz], [s.tx + 1.1, AISLE_Z]];
  w.state = 'deliver';
  w.path = [[19.6, AISLE_Z], [s.tx + 1.1, AISLE_Z], [s.tx + 1.1, s.tz], [s.tx + 0.95, s.tz]];
  w.look = [s.tx, s.tz];
  w.onArrive = () => {
    const cc = customers.get(j.id);
    clearGroup(w.person.holder);
    if (cc && !cc.leaving) {
      const it = j.part === 'drink' ? makeCup(j.e.d) : makePlate(j.e.c || [], false);
      it.scale.setScalar(j.part === 'drink' ? 0.55 : 0.5);
      const side = cc.seat.cz > cc.seat.tz ? 1 : -1;
      it.position.set(cc.seat.tx + (j.part === 'drink' ? 0.3 : -0.12), 0.78, cc.seat.tz + side * 0.3);
      dining.add(it);
      cc.tableItems.push(it);
      cc.delivered[j.part] = true;
      cc.eating = true; cc.eatT = 4.5; cc.state = 'eat';
    }
    const i = jobs.indexOf(j);
    if (i >= 0) jobs.splice(i, 1);
    waiterGoHome(w);
  };
}

function updateRestaurant(dt, tm) {
  if (!dining) return;
  restClock += dt;
  const now = restClock;
  for (const c of [...customers.values()]) {
    npcStep(c, dt);
    npcApply(c);
    animPerson(c, tm);
    if (c.state === 'eat') {
      c.eatT -= dt;
      if (c.eatT <= 0) { c.eating = false; c.state = 'wait'; c.bubble.sig = ''; }
    }
    if (!c.leaving && c.state !== 'walkin') {
      const allDone = c.delivered.food && c.delivered.drink;
      if (c.gone && !c.eating && allDone) customerLeave(c, false);
      else if (c.gone && !c.eating && !(c.served.food && c.served.drink) && !c.angry) customerLeave(c, true);     // propadlá objednávka
    }
    c.person.g.visible = true;
    const showBubble = c.state === 'wait' || c.state === 'eat' || (c.leaving && c.angry);
    c.bubble.sp.visible = showBubble && !(c.delivered.food && c.delivered.drink && c.state === 'wait');
    if (c.bubble.sp.visible) drawBubble(c, c.frac);
  }
  for (const w of waiters) {
    if (w.state === 'idle') {
      const j = jobs.find((q) => !q.taken && now >= q.readyAt);
      if (j) {
        j.taken = true; w.job = j; w.state = 'toCounter';
        w.path = [[18.6, SLOT_Z[j.slot]]];
        w.look = [SLOT_X, SLOT_Z[j.slot]];
        w.onArrive = () => waiterPickup(w);
      }
    }
    npcStep(w, dt);
    npcApply(w);
    animPerson(w, tm);
  }
  ambients.forEach((n) => {
    n.person.armR.rotation.x = -1.0 + Math.max(0, Math.sin(tm * 1.7 + n.t0)) * 0.5;
    n.person.body.rotation.x = Math.sin(tm * 0.9 + n.t0) * 0.03;
  });
}

/* ---------- kuchaři ---------- */
const chefs = new Map();      // id -> { g, body, holder, heldSig, tag, color }

function makeChef(lk, fallback) {
  lk = lk || { h: 0, s: 0, t: 0, c: 0 };
  const color = HAT_COLORS[lk.h] || fallback || HAT_COLORS[0];
  const skin = SKIN_COLORS[lk.s] || SKIN_COLORS[0];
  const shirt = SHIRT_COLORS[lk.c] || '#ffffff';
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  M(geo('Cylinder', 0.2, 0.25, 0.5, 14), shirt, 0, 0.45, 0, body);
  M(geo('Sphere', 0.045, 6, 4), color, -0.07, 0.55, 0.22, body, { noShadow: true });
  M(geo('Sphere', 0.045, 6, 4), color, 0.07, 0.55, 0.22, body, { noShadow: true });
  M(geo('Cylinder', 0.08, 0.08, 0.2, 8), '#33405a', -0.1, 0.1, 0, body);
  M(geo('Cylinder', 0.08, 0.08, 0.2, 8), '#33405a', 0.1, 0.1, 0, body);
  M(geo('Sphere', 0.17, 16, 12), skin, 0, 0.86, 0, body);
  M(geo('Sphere', 0.025, 6, 4), '#2b1b10', -0.06, 0.89, 0.15, body, { noShadow: true });
  M(geo('Sphere', 0.025, 6, 4), '#2b1b10', 0.06, 0.89, 0.15, body, { noShadow: true });
  if (lk.t === 1) {                       // šátek
    M(geo('Cylinder', 0.18, 0.18, 0.08, 14), color, 0, 0.97, 0, body);
    M(geo('Sphere', 0.06, 8, 6), color, 0, 0.97, -0.18, body, { noShadow: true });
    M(geo('Sphere', 0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.38), '#3a2616', 0, 0.9, 0, body, { noShadow: true });
  } else if (lk.t === 2) {                // kšiltovka
    const dome = M(geo('Sphere', 0.185, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, 0, 0.93, 0, body);
    dome.scale.y = 0.85;
    M(geo('Box', 0.24, 0.02, 0.17), color, 0, 0.94, 0.19, body, { noShadow: true });
  } else {                                // kuchařská čepice
    M(geo('Cylinder', 0.18, 0.17, 0.12, 14), color, 0, 1.02, 0, body);
    M(geo('Sphere', 0.14, 10, 8), color, -0.08, 1.14, 0, body);
    M(geo('Sphere', 0.14, 10, 8), color, 0.08, 1.14, 0, body);
    M(geo('Sphere', 0.15, 10, 8), color, 0, 1.2, 0, body);
  }
  // ruce
  M(geo('Box', 0.07, 0.07, 0.34), shirt, -0.2, 0.62, 0.2, body);
  M(geo('Box', 0.07, 0.07, 0.34), shirt, 0.2, 0.62, 0.2, body);
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
    if (!c) { c = makeChef(a.lk, a.c); scene.add(c.g); c.tag.textContent = a.n; chefs.set(a.id, c); }
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
    const rec = o.r ? recipes[o.r] : null;
    if (o.r && !rec) return;
    live.add(o.id);
    let e = orderEls.get(o.id);
    if (!e) {
      const el = document.createElement('div');
      el.className = 'order' + (o.v ? ' vip' : '');
      const head = document.createElement('div');
      head.className = 'oh';
      const nm = document.createElement('b');
      nm.className = 'on';
      nm.textContent = (o.v ? '⭐ ' : '') + (rec ? rec.name : NAMES[o.dr]);
      nm.title = nm.textContent;
      const tm = document.createElement('span');
      tm.className = 'otime';
      head.append(nm, tm);
      el.appendChild(head);

      const mkChip = (k, state) => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.title = NAMES[k] + (state === 'chopped' ? ' (nakrájet)' : state === 'cooked' ? ' (uvařit / upéct)' : '');
        const em = document.createElement('em'); em.textContent = ICONS[k];
        const sm = document.createElement('small'); sm.textContent = NAMES[k];
        c.append(em, sm);
        if (state === 'chopped' || state === 'cooked') {
          const bd = document.createElement('s');
          bd.textContent = state === 'chopped' ? '🔪' : '🔥';
          c.appendChild(bd);
        }
        return c;
      };
      let food = null, drink = null;
      if (rec) {
        food = document.createElement('div');
        food.className = 'ofood';
        rec.items.forEach((k) => food.appendChild(mkChip(k, PLATE_STATE[k])));
        el.appendChild(food);
      }
      if (rec && o.dr) {
        const sep = document.createElement('div');
        sep.className = 'osep'; sep.textContent = '+';
        el.appendChild(sep);
      }
      if (o.dr) {
        drink = document.createElement('div');
        drink.className = 'odrink';
        drink.appendChild(mkChip(o.dr, null));
        el.appendChild(drink);
      }
      const bar = document.createElement('div');
      bar.className = 'ot';
      bar.appendChild(document.createElement('i'));
      el.appendChild(bar);
      ordersEl.appendChild(el);
      e = { el, fill: bar.firstChild, food, drink, tm, secs: -1 };
      orderEls.set(o.id, e);
    }
    if (e.food) e.food.classList.toggle('done', !!o.fd);
    if (e.drink) e.drink.classList.toggle('done', !!o.dd);
    const frac = Math.max(0, o.t / o.l);
    e.fill.style.width = Math.max(3, frac * 100) + '%';
    e.fill.style.background = frac > 0.5 ? '#66bb6a' : frac > 0.25 ? '#ffca28' : '#ef5350';
    e.el.classList.toggle('urgent', frac <= 0.25);
    const secs = Math.ceil(o.t);
    if (secs !== e.secs) { e.secs = secs; e.tm.textContent = secs + ' s'; }
  });
  for (const [id, e] of [...orderEls]) if (!live.has(id)) { e.el.remove(); orderEls.delete(id); }
  ordersEl.classList.toggle('empty', snap.o.length === 0);

  // cíl dne
  const gEl = $('goal');
  if (snap.g) {
    const g = snap.g;
    const failed = g.k === 'noexp' && g.v > g.n;
    const done = g.k !== 'noexp' && g.v >= g.n;
    const prog = g.k === 'noexp' ? 'propadlo ' + g.v + ' / ' + g.n : g.k === 'earn' ? g.v + ' / ' + g.n + ' Kč' : g.v + ' / ' + g.n;
    const txt = '🎯 ' + g.t + ' – ' + prog + '  (+' + g.r + ' Kč)';
    if (gEl.textContent !== txt) gEl.textContent = txt;
    gEl.classList.remove('hidden');
    gEl.classList.toggle('done', done);
    gEl.classList.toggle('failed', failed);
  } else gEl.classList.add('hidden');

  // událost (chaos)
  const bn = $('banner');
  if (snap.ch && snap.ch.t > 0) {
    const txt = '⚡ ' + snap.ch.n + (snap.ch.d > 5 ? '  (' + Math.ceil(snap.ch.t) + ' s)' : '');
    if (bn.textContent !== txt) bn.textContent = txt;
    bn.classList.add('show');
  } else bn.classList.remove('show');

  // hasicák v ruce
  const mine = actors.get(myId);
  const ex = $('extInfo');
  if (mine && mine.h && mine.h.t === 'b') {
    const t = '📦 ' + NAMES[mine.h.k] + ' ×' + mine.h.n + '  ·  vlož do police nebo kohoutku (E)';
    if (ex.textContent !== t) ex.textContent = t;
    ex.classList.remove('hidden');
  } else if (mine && mine.h && mine.h.t === 'x') {
    const t = '🧯 ' + Math.round(mine.h.c * 100) + ' %  ·  míř na oheň a drž E / myš';
    if (ex.textContent !== t) ex.textContent = t;
    ex.classList.remove('hidden');
  } else ex.classList.add('hidden');
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
      else if ((b.ch === 'W' || b.ch === 'T') && d.p > 0) frac = d.p;
      else if (b.ch === 'F' && d.i) {
        const st = d.i.s;
        if (st !== 'cooked' && st !== 'burnt') { frac = d.p; color = '#66bb6a'; }
        else if (st === 'cooked') {
          const warn = d.b > 0.55;
          const blink = warn && Math.floor(performance.now() / 160) % 2 === 0;
          frac = 1 - d.b;
          color = blink ? '#ff1744' : (warn ? '#ff7043' : '#ffb300');
          if (warn) txt = '🔥';
        } else { frac = d.f > 0 ? d.f : 0.05; color = '#e53935'; txt = '🔥 POZOR!'; }
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
    if (t.kind === 'stock' || t.kind === 'rack') {
      const d = snap.s[t.x + ',' + t.y];
      if (!d || d.n === undefined) { t.el.classList.add('hidden'); continue; }
      const n = d.n;
      const label = t.kind === 'rack' ? (n < 0 ? '📦 ∞' : '📦 ×' + n) : n + '/15';
      if (label !== t.last) { t.last = label; t.el.textContent = label; t.el.classList.toggle('zero', n === 0); }
      t.el.classList.remove('hidden');
      place(t.el, t.x + 0.5, t.kind === 'rack' ? 2.4 : TOP + 1.05, t.y + 0.5);
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
    const ah = actors.get(myId);
    const bm = ah && ah.h && ah.h.t === 'b' ? 0.75 : 1;           // s krabicí se jde pomaleji
    if (playing && walking) moveBy(me, v.dx * SPEED * speedMult * bm * dt, v.dy * SPEED * speedMult * bm * dt);
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

function updateLights(dt) {
  const target = snap && snap.ch && snap.ch.id === 'dark' && snap.ch.t > 0 ? 1 : 0;
  dark += (target - dark) * Math.min(1, dt * 4);
  hemi.intensity = 1.0 * (1 - 0.82 * dark);
  sun.intensity = 0.75 * (1 - 0.92 * dark);
  torch.intensity = 1.3 * dark;
}

function updateHighlight() {
  if (!me || view !== 'game') { hilite.visible = false; return; }
  const [tx, ty] = targetTile(me);
  const ch = tx >= 0 && ty >= 0 && tx < COLS && ty < map.length ? map[ty][tx] : '#';
  if (ch === '.' || ch === '#') { hilite.visible = false; return; }
  hilite.visible = true;
  hilite.position.set(tx + 0.5, TOP + 0.015, ty + 0.5);
}

let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - lastFrame) / 1000));
  lastFrame = now;
  if ((view !== 'game' && view !== 'end' && view !== 'shop') || !map || !snap || !kitchen) return;
  update(dt);
  updateCamera(now / 1000);
  syncChefs(dt);
  updateStations(now / 1000);
  updateFires(now / 1000);
  updateRats(dt, now / 1000);
  updateRestaurant(dt, now / 1000);
  updateSpray(now / 1000);
  updateLights(dt);
  updateHighlight();
  renderer.render(scene, camera);
  updateOverlays();
  updateFloaters(dt);
}
requestAnimationFrame(frame);

setView('menu');
}   // start()
})();
