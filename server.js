'use strict';
/**
 * Šílená kuchyně – multiplayerový server (Express + Socket.io)
 *
 * Server je plně autoritativní: simuluje pohyb hráčů, suroviny, krájení,
 * sporáky, objednávky, mytí talířů i skóre. Klienti posílají jen vstupy
 * (směr, držení interakce, stisk interakce) a vykreslují snapshoty stavu.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/*  Herní konstanty                                                    */
/* ------------------------------------------------------------------ */
const TICK_RATE = 30;
const GAME_TIME = 180;       // délka kola (s)
const COUNTDOWN = 3;         // odpočet před startem (s)
const MIN_PLAYERS = 1;       // lze hrát i sám
const MAX_PLAYERS = 4;
const SPEED = 4.6;           // dlaždic za sekundu
const HALF = 0.3;            // polovina velikosti hráče (kolize)
const REACH = 0.75;          // dosah interakce před hráčem
const CHOP_TIME = 2.4;       // s držení pro nakrájení
const CHOP_BUMP = 0.11;      // posun při jednom stisku (mačkání)
const COOK_TIME = 7;         // s do opečení masa
const BURN_TIME = 6;         // s od opečení do spálení
const WASH_TIME = 2.2;
const WASH_BUMP = 0.2;
const DIRTY_DELAY = 5;       // za jak dlouho se vrátí špinavý talíř
const START_PLATES = 4;
const MAX_ORDERS = 5;
const EXPIRE_PENALTY = 5;
// Pití
const FILL_TIME = 1.4;       // s držení pod kohoutkem
const FILL_BUMP = 0.34;      // posun při jednom stisku
// Oheň a hasicák
const FIRE_IGNITE_DELAY = 4; // s po spálení masa se sporák vznítí
const FIRE_SPREAD = 4.5;     // s mezi pokusy o rozšíření ohně
const EXT_TIME = 1.1;        // s stříkání na uhašení jednoho ohně
const EXT_DRAIN = 0.1;       // spotřeba hasicáku za s stříkání (10 s plně)
// Krysy
const RAT_SPEED = 2.3;
const RAT_HALF = 0.15;
const RAT_EAT = 3.2;         // s hlodání, než krysa něco odnese
// Režim „Dny“: zásoby, nákup surovin, nájem
const DAY_TIME = 120;        // délka jednoho dne (s)
const START_MONEY = 50;
const START_STOCK = { bun: 5, meat: 5, cheese: 3, lettuce: 3, tomato: 3, cola: 4, lemon: 3, juice: 3 };
const PRICES = { bun: 2, meat: 5, cheese: 3, lettuce: 2, tomato: 2, cola: 2, lemon: 2, juice: 3 };   // základní ceny
const STOCK_CAP = 30;        // max. zásoba jedné suroviny
const RENT_BASE = 25, RENT_STEP = 10;
const rentFor = (day) => RENT_BASE + RENT_STEP * (day - 1);
const ING_CS = { bun: 'housky', meat: 'masa', cheese: 'sýra', lettuce: 'salátu', tomato: 'rajčat', cola: 'koly', lemon: 'limonády', juice: 'džusu' };
const MODES = ['classic', 'days'];
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const SPAWNS = [[3.5, 2.5], [12.5, 2.5], [3.5, 7.5], [12.5, 7.5]];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/*
 * Mapa kuchyně (16 x 10)
 *  . podlaha   # zeď        C pult (odkládání)
 *  B houska  M maso  S sýr  L salát  T rajče   (bedny se surovinami)
 *  K krájecí prkénko   F sporák   P výdejní pult
 *  X koš   D stoh čistých talířů   W dřez (mytí)
 *  U kelímky   A kohoutek cola   E kohoutek limonáda   O kohoutek džus
 *  Y držák hasicího přístroje
 */
const MAP = [
  '#CBCMCSCLCTCCCC#',
  '#..............#',
  '#..............#',
  'C..............P',
  'F....CKKKCC....P',
  'C....CCFFCC....P',
  'Y..............P',
  '#..............#',
  '#..............#',
  '#XCCUAEOCCCWWDC#',
];
const H = MAP.length;
const W = MAP[0].length;
MAP.forEach((row, i) => {
  if (row.length !== W) throw new Error('Řádek mapy ' + i + ' má špatnou délku');
});

const CRATES = { B: 'bun', M: 'meat', S: 'cheese', L: 'lettuce', T: 'tomato' };
const TAPS = { A: 'cola', E: 'lemon', O: 'juice' };
const DRINK_IDS = ['cola', 'lemon', 'juice'];
const DRINK_NAME = { cola: 'Cola', lemon: 'Limonáda', juice: 'Džus' };
const FLAMMABLE = new Set('CKFDUAEOBMSLT'.split(''));   // co může hořet
// V jakém stavu musí být surovina, aby šla na talíř
const NEED = { bun: 'raw', meat: 'cooked', cheese: 'raw', lettuce: 'chopped', tomato: 'chopped' };
const CHOPPABLE = { meat: true, lettuce: true, tomato: true };

const RECIPES = [
  { id: 'cheese', name: 'Cheeseburger', items: ['bun', 'meat', 'cheese'], w: 3 },
  { id: 'salad', name: 'Salátový burger', items: ['bun', 'meat', 'lettuce', 'tomato'], w: 3 },
  { id: 'plain', name: 'Hamburger', items: ['bun', 'meat'], w: 2 },
  { id: 'bowl', name: 'Zeleninový salát', items: ['lettuce', 'tomato'], w: 1 },
];
const CHAOS = [
  { id: 'rush', n: 'Rush hodina! Zákazníci se hrnou', dur: 25, w: 2 },
  { id: 'heat', n: 'Přehřáté sporáky!', dur: 22, w: 2 },
  { id: 'dark', n: 'Výpadek proudu!', dur: 10, w: 1 },
  { id: 'rats', n: 'Krysí invaze!', dur: 4, w: 2 },
  { id: 'spark', n: 'Jiskra! Něco hoří!', dur: 4, w: 2 },
  { id: 'thirst', n: 'Žízeň! Všichni chtějí pití', dur: 25, w: 2 },
];
// Denní modifikátory (režim Dny)
const MODIFIERS = [
  { id: 'normal', n: 'Normální den', d: 'Nic zvláštního – jen běžný provoz.', w: 3 },
  { id: 'rush', n: 'Rušný den', d: 'Zákazníci chodí o 40 % častěji a platí o 25 % víc.', w: 2 },
  { id: 'vip', n: 'Den VIP hostů', d: 'Často přijdou VIP hosté: platí dvojnásobek, ale mají míň trpělivosti.', w: 2 },
  { id: 'thirst', n: 'Žíznivý den', d: 'Skoro každý chce pití a pití se platí dvojnásobně. Nakup sirup!', w: 2 },
  { id: 'vermin', n: 'Krysí den', d: 'Víc krys než obvykle. Pořiď pasti a hlídej sklad!', w: 2 },
  { id: 'heat', n: 'Vedro v kuchyni', d: 'Sporáky jedou naplno: maso se peče rychleji, ale i rychleji hoří.', w: 2 },
];
// Trvalá vylepšení (kupují se mezi dny)
const UPGRADES = {
  knife: { name: 'Ostrý nůž', icon: '🔪', desc: 'Krájení o 25 % rychlejší za úroveň', cost: [40, 70, 110] },
  boots: { name: 'Sportovní boty', icon: '👟', desc: 'Rychlejší chůze (+8 % za úroveň)', cost: [45, 80, 120] },
  pan: { name: 'Nepřilnavá pánev', icon: '🍳', desc: 'Maso se pálí o 30 % pomaleji', cost: [40, 70, 100] },
  plates: { name: 'Sada talířů', icon: '🍽', desc: '+2 čisté talíře na začátku dne', cost: [30, 55, 80] },
  trap: { name: 'Pasti na krysy', icon: '🐀', desc: 'Méně krys a hlodají pomaleji', cost: [35, 60, 90] },
  ext: { name: 'Lepší hasicák', icon: '🧯', desc: 'Hasí rychleji a vydrží déle', cost: [40, 75] },
  sign: { name: 'Neonový nápis', icon: '💡', desc: '+10 % tržeb z objednávek', cost: [60, 100, 150] },
};
const RECIPES_PUBLIC = {};
RECIPES.forEach((r) => { RECIPES_PUBLIC[r.id] = { name: r.name, items: r.items }; });

/* ------------------------------------------------------------------ */
/*  Express + Socket.io (jeden port, statické soubory z public/)       */
/* ------------------------------------------------------------------ */
const app = express();
const server = http.createServer(app);
// CORS: klient může běžet i jinde (např. itch.io iframe), proto povolujeme všechny originy.
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.type('text').send('ok'));

/* ------------------------------------------------------------------ */
/*  Pomocné funkce                                                     */
/* ------------------------------------------------------------------ */
const rooms = new Map();

const tileAt = (x, y) => (y < 0 || y >= H || x < 0 || x >= W ? '#' : MAP[y][x]);
const isSolid = (x, y) => tileAt(x, y) !== '.';
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

const newIngredient = (k) => ({ t: 'i', k, s: 'raw' });
const newPlate = () => ({ t: 'p', c: [] });
const isPlate = (it) => !!it && it.t === 'p';
const isIng = (it) => !!it && it.t === 'i';
const plateReady = (it) => isIng(it) && it.s === NEED[it.k];
const isCup = (it) => !!it && it.t === 'c';
const isExt = (it) => !!it && it.t === 'x';
const newCup = () => ({ t: 'c', d: null });
const newExt = () => ({ t: 'x', c: 1 });
const up = (room, id) => (room.upgrades && room.upgrades[id]) || 0;
const modIs = (room, id) => room.mode === 'days' && !!room.today && room.today.id === id;
const chaosIs = (room, id) => !!room.chaos && room.chaos.id === id;
const thirstOn = (room) => chaosIs(room, 'thirst') || modIs(room, 'thirst');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function weighted(list) {
  const total = list.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of list) { r -= x.w; if (r <= 0) return x; }
  return list[0];
}
const cz = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

// Lze surovinu přidat na talíř? (správný stav + musí vzniknout část nějakého receptu)
function canAdd(plate, ing) {
  if (!plateReady(ing) || plate.c.includes(ing.k)) return false;
  const want = plate.c.concat(ing.k);
  return RECIPES.some((r) => want.every((k) => r.items.includes(k)));
}

function ev(room, e, x, y, extra) {
  if (room.events.length < 60) room.events.push(Object.assign({ e, x: r2(x), y: r2(y) }, extra));
}

function cleanName(n) {
  const s = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  return s || 'Kuchař';
}

/* ---------- Pohyb a kolize ---------- */
function blocked(x, y) { return blockedBy(x, y, HALF); }
function blockedBy(x, y, h) {
  const x0 = Math.floor(x - h), x1 = Math.floor(x + h);
  const y0 = Math.floor(y - h), y1 = Math.floor(y + h);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (isSolid(tx, ty)) return true;
  }
  return false;
}

function moveBy(o, dx, dy) {
  if (!blocked(o.x + dx, o.y)) o.x += dx;
  if (!blocked(o.x, o.y + dy)) o.y += dy;
}

function separate(list) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= 0.6) continue;
      const nx = d > 0.0001 ? dx / d : 1, ny = d > 0.0001 ? dy / d : 0;
      const push = (0.6 - d) / 2;
      moveBy(a, -nx * push, -ny * push);
      moveBy(b, nx * push, ny * push);
    }
  }
}

const targetOf = (p) => [Math.floor(p.x + p.fx * REACH), Math.floor(p.y + p.fy * REACH)];

/* ------------------------------------------------------------------ */
/*  Místnosti                                                          */
/* ------------------------------------------------------------------ */
function createRoom(mode) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  const room = {
    code, state: 'lobby', players: new Map(),
    mode: mode === 'days' ? 'days' : 'classic', host: null, len: GAME_TIME,
    money: 0, stock: {}, day: 1, dayStartMoney: 0, ready: new Set(), lastSummary: null,
    totalDelivered: 0, totalExpired: 0,
    upgrades: {}, prices: Object.assign({}, PRICES), today: null, nextGoal: null, goal: null,
    stat: { dishes: 0, drinks: 0, rats: 0, fires: 0 },
    fires: {}, rats: [], ratSeq: 0, nextRat: 0, chaos: null, nextChaos: 0,
    st: {}, stoves: [], sinks: [], orders: [], returns: [], events: [],
    time: 0, cd: 0, score: 0, plates: 0, dirty: 0,
    delivered: 0, expired: 0, orderSeq: 0, nextOrder: 0, last: null,
  };
  rooms.set(code, room);
  return room;
}

function roomInfo(room) {
  return {
    code: room.code, state: room.state, mode: room.mode, host: room.host, min: MIN_PLAYERS, max: MAX_PLAYERS,
    players: [...room.players.values()].map((p) => ({ id: p.id, n: p.name, c: p.color })),
  };
}
const broadcastRoom = (room) => io.to(room.code).emit('room', roomInfo(room));

function addPlayer(room, socket, name) {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const p = {
    id: socket.id, name, slot, color: COLORS[slot],
    x: SPAWNS[slot][0], y: SPAWNS[slot][1], fx: 0, fy: 1,
    held: null, input: { dx: 0, dy: 0, hold: false }, sfxT: 0,
  };
  room.players.set(socket.id, p);
  if (!room.host) room.host = socket.id;
  socket.join(room.code);
  socket.data.code = room.code;
  return p;
}

function removePlayer(socket) {
  const code = socket.data.code;
  if (!code) return;
  socket.data.code = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(socket.id);
  if (p && isPlate(p.held)) room.plates++; // talíř se nesmí ztratit
  if (p && isExt(p.held)) restoreExt(room); // hasicák se vrátí do držáku
  room.players.delete(socket.id);
  room.ready.delete(socket.id);
  if (room.players.size === 0) rooms.delete(code);
  else {
    if (room.host === socket.id) room.host = room.players.keys().next().value;
    broadcastRoom(room);
    if (room.state === 'shop') { broadcastShop(room); checkReady(room); }
  }
}

const playerOf = (socket) => {
  const room = rooms.get(socket.data.code);
  return room ? room.players.get(socket.id) : null;
};

/* ------------------------------------------------------------------ */
/*  Start a konec hry                                                  */
/* ------------------------------------------------------------------ */
function buildStations(room) {
  room.st = {}; room.stoves = []; room.sinks = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = MAP[y][x], key = x + ',' + y;
      if (ch === 'C') room.st[key] = { type: 'C', x, y, item: null };
      else if (ch === 'K') room.st[key] = { type: 'K', x, y, item: null, prog: 0 };
      else if (ch === 'F') {
        const s = { type: 'F', x, y, item: null, prog: 0, burn: 0, warned: false };
        room.st[key] = s; room.stoves.push(s);
      } else if (ch === 'W') {
        const s = { type: 'W', x, y, prog: 0 };
        room.st[key] = s; room.sinks.push(s);
      } else if (TAPS[ch]) room.st[key] = { type: 'T', x, y, drink: TAPS[ch], prog: 0 };
      else if (ch === 'Y') room.st[key] = { type: 'Y', x, y, has: true };
    }
  }
}

function startGame(room) {
  if (room.mode === 'days') {
    room.day = 1; room.money = START_MONEY; room.stock = Object.assign({}, START_STOCK);
    room.totalDelivered = 0; room.totalExpired = 0; room.lastSummary = null;
    room.upgrades = {};
    planDay(room);
  } else { room.today = null; room.goal = null; room.nextGoal = null; room.upgrades = {}; }
  beginRound(room);
}

/* ---------- Plánování dne (režim Dny) ---------- */
function rollPrices() {
  const out = {};
  for (const k in PRICES) out[k] = Math.max(1, Math.round(PRICES[k] * (0.7 + Math.random() * 0.8)));
  return out;
}

function makeGoal(room) {
  const day = room.day, solo = room.players.size <= 1, reward = 20 + 5 * day;
  const f = solo ? 0.7 : 1;
  const kind = pick(['dishes', 'drinks', 'noexp', 'earn']);
  if (kind === 'dishes') {
    const n = Math.max(2, Math.round((3 + Math.floor(day * 0.7)) * f));
    return { k: kind, need: n, reward, text: 'Odevzdej ' + n + ' ' + cz(n, 'jídlo', 'jídla', 'jídel') };
  }
  if (kind === 'drinks') {
    const n = Math.max(2, Math.round((2 + Math.floor(day / 2)) * f));
    return { k: kind, need: n, reward, text: 'Obsluž ' + n + ' ' + cz(n, 'pití', 'pití', 'pití') };
  }
  if (kind === 'noexp') return { k: kind, need: 1, reward, text: 'Nech propadnout nejvýš 1 objednávku' };
  const n = Math.round((50 + 20 * day) * (solo ? 0.8 : 1) / 5) * 5;
  return { k: kind, need: n, reward, text: 'Vydělej za den aspoň ' + n + ' Kč' };
}

function planDay(room) {
  room.today = room.day === 1 ? MODIFIERS[0] : weighted(MODIFIERS);
  room.nextGoal = makeGoal(room);
  room.prices = room.day === 1 ? Object.assign({}, PRICES) : rollPrices();
}

function goalProgress(room, g) {
  if (!g) return 0;
  if (g.k === 'dishes') return room.stat.dishes;
  if (g.k === 'drinks') return room.stat.drinks;
  if (g.k === 'noexp') return room.expired;
  return Math.max(0, room.money - room.dayStartMoney);
}
const goalOk = (room, g) => !!g && (g.k === 'noexp' ? room.expired <= g.need : goalProgress(room, g) >= g.need);

// jedno kolo (klasika) nebo jeden den
function beginRound(room) {
  room.state = 'playing';
  room.len = room.mode === 'days' ? DAY_TIME : GAME_TIME;
  room.time = room.len; room.cd = COUNTDOWN;
  room.score = 0; room.delivered = 0; room.expired = 0;
  room.dayStartMoney = room.money;
  room.stat = { dishes: 0, drinks: 0, rats: 0, fires: 0 };
  room.goal = room.mode === 'days' ? room.nextGoal : null;
  room.fires = {}; room.rats = []; room.chaos = null;
  const slow = room.players.size <= 1 ? 1.3 : 1;
  room.nextRat = (modIs(room, 'vermin') ? 14 : 24) * slow * (1 + 0.4 * up(room, 'trap'));
  room.nextChaos = 32 * slow;
  room.ready.clear();
  room.orders = []; room.orderSeq = 0; room.nextOrder = 1;
  room.returns = []; room.events = [];
  room.plates = START_PLATES + 2 * up(room, 'plates'); room.dirty = 0;
  buildStations(room);
  for (const p of room.players.values()) {
    p.x = SPAWNS[p.slot][0]; p.y = SPAWNS[p.slot][1];
    p.fx = 0; p.fy = 1; p.held = null;
    p.input = { dx: 0, dy: 0, hold: false }; p.sfxT = 0;
  }
  io.to(room.code).emit('gameStart', { map: MAP, recipes: RECIPES_PUBLIC, time: room.len, cd: COUNTDOWN, mode: room.mode, day: room.day,
    up: room.upgrades, today: room.today ? { id: room.today.id, n: room.today.n } : null, goal: room.goal });
  broadcastRoom(room);
}

/* ---------- Režim „Dny“: obchod mezi dny ---------- */
function shopPayload(room) {
  return {
    day: room.day, money: room.money, stock: room.stock, prices: room.prices, base: PRICES, cap: STOCK_CAP,
    rent: rentFor(room.day), summary: room.lastSummary,
    ready: [...room.ready], players: room.players.size,
    today: room.today ? { id: room.today.id, n: room.today.n, d: room.today.d } : null,
    goal: room.nextGoal ? { text: room.nextGoal.text, reward: room.nextGoal.reward } : null,
    up: Object.keys(UPGRADES).map((id) => {
      const u = UPGRADES[id], lvl = up(room, id);
      return { id, name: u.name, icon: u.icon, desc: u.desc, lvl, max: u.cost.length, next: lvl < u.cost.length ? u.cost[lvl] : null };
    }),
  };
}
const broadcastShop = (room) => io.to(room.code).emit('shop', shopPayload(room));

function checkReady(room) {
  if (room.state !== 'shop' || room.players.size === 0) return;
  for (const id of room.players.keys()) if (!room.ready.has(id)) return;
  beginRound(room);
}

// jde z toho, co zbylo (a za co se dá koupit), uvařit aspoň jedno jídlo?
function canProduce(room) {
  return RECIPES.some((r) => r.items.reduce((c, k) => c + ((room.stock[k] || 0) > 0 ? 0 : room.prices[k]), 0) <= room.money);
}

function endDay(room) {
  const net = room.money - room.dayStartMoney;
  const rent = rentFor(room.day);
  room.totalDelivered += room.delivered; room.totalExpired += room.expired;
  const g = room.goal;
  const gOk = goalOk(room, g);
  const bonus = gOk ? g.reward : 0;
  room.money += bonus - rent;
  for (const p of room.players.values()) { p.held = null; p.input = { dx: 0, dy: 0, hold: false }; }
  ev(room, 'end', 0, 0);
  io.to(room.code).emit('state', snapshot(room));
  room.lastSummary = {
    day: room.day, net, rent, delivered: room.delivered, expired: room.expired,
    goal: g ? { text: g.text, ok: gOk, reward: g.reward } : null,
    stat: Object.assign({}, room.stat), mod: room.today ? room.today.n : null,
  };

  let bust = null, daysDone = room.day;
  if (room.money < 0) { bust = 'Nezbyly peníze na nájem (' + rent + ' Kč).'; daysDone = room.day - 1; }
  else if (!canProduce(room)) { bust = 'Došly zásoby a není za co nakoupit.'; }

  if (bust) {
    room.state = 'ended';
    room.last = {
      mode: 'days', days: daysDone, money: Math.max(0, room.money), reason: bust,
      delivered: room.totalDelivered, expired: room.totalExpired,
      stars: daysDone >= 7 ? 3 : daysDone >= 4 ? 2 : daysDone >= 2 ? 1 : 0,
    };
    io.to(room.code).emit('gameEnd', room.last);
    broadcastRoom(room);
    return;
  }
  room.day++;
  planDay(room);
  room.state = 'shop';
  room.ready.clear();
  broadcastRoom(room);
  broadcastShop(room);
}

function endGame(room) {
  if (room.mode === 'days') return endDay(room);
  room.state = 'ended';
  const s = room.score;
  const k = room.players.size <= 1 ? 0.6 : 1;      // sólo hra má mírnější hranice hvězd
  room.last = {
    mode: 'classic', score: s, delivered: room.delivered, expired: room.expired,
    stars: s >= 240 * k ? 3 : s >= 140 * k ? 2 : s >= 60 * k ? 1 : 0,
  };
  for (const p of room.players.values()) {
    p.held = null; p.input = { dx: 0, dy: 0, hold: false };
  }
  ev(room, 'end', 0, 0);
  io.to(room.code).emit('state', snapshot(room));
  io.to(room.code).emit('gameEnd', room.last);
  broadcastRoom(room);
}

/* ------------------------------------------------------------------ */
/*  Interakce hráče                                                    */
/* ------------------------------------------------------------------ */
function canPlaceOn(ch, item) {
  if (ch === 'C') return true;
  if (ch === 'K') return isIng(item) && CHOPPABLE[item.k] && item.s === 'raw';
  if (ch === 'F') return isIng(item) && item.k === 'meat' && item.s === 'chopped';
  return false;
}

function resetStation(st) {
  st.prog = 0; st.burn = 0; st.warned = false; st.smolder = 0;
}

function checkChop(room, st) {
  if (st.prog >= 1) {
    st.item.s = 'chopped';
    st.prog = 0;
    ev(room, 'done', st.x + 0.5, st.y + 0.5);
  }
}

function checkWash(room, st) {
  if (st.prog >= 1) {
    st.prog = 0;
    room.dirty--; room.plates++;
    ev(room, 'done', st.x + 0.5, st.y + 0.5);
  }
}

function interactStorage(room, p, st, ch, fx, fy) {
  const held = p.held, item = st.item;
  if (held && !item) {
    if (!canPlaceOn(ch, held)) return ev(room, 'no', fx, fy);
    st.item = held; p.held = null; resetStation(st);
    return ev(room, 'drop', fx, fy);
  }
  if (!held && item) {
    // syrová surovina na prkénku se krájí (mačkání / držení), nezvedá se
    if (ch === 'K' && isIng(item) && CHOPPABLE[item.k] && item.s === 'raw') {
      st.prog += CHOP_BUMP * (1 + 0.25 * up(room, 'knife'));
      ev(room, 'chop', fx, fy);
      return checkChop(room, st);
    }
    p.held = item; st.item = null; resetStation(st);
    return ev(room, 'pick', fx, fy);
  }
  if (held && item) {
    if (isPlate(held) && isIng(item) && canAdd(held, item)) {
      held.c.push(item.k); st.item = null; resetStation(st);
      return ev(room, 'pick', fx, fy);
    }
    if (isIng(held) && isPlate(item) && canAdd(item, held)) {
      item.c.push(held.k); p.held = null;
      return ev(room, 'drop', fx, fy);
    }
    return ev(room, 'no', fx, fy);
  }
}

function findOrder(room, content) {
  let best = -1;
  room.orders.forEach((o, i) => {
    if (!o.r || o.fd) return;
    const items = RECIPES_PUBLIC[o.r].items;
    if (items.length === content.length && content.every((k) => items.includes(k))) {
      if (best < 0 || o.t < room.orders[best].t) best = i;
    }
  });
  return best;
}
function findDrinkOrder(room, d) {
  let best = -1;
  room.orders.forEach((o, i) => {
    if (o.dr === d && !o.dd && (best < 0 || o.t < room.orders[best].t)) best = i;
  });
  return best;
}

// vyplatí část objednávky (násobiče: VIP, vylepšení, denní modifikátor, žízeň)
function payout(room, o, base, drink) {
  let v = base;
  if (o && o.vip) v *= 2;
  if (drink && thirstOn(room)) v *= 2;
  if (room.mode === 'days') {
    v *= 1 + 0.1 * up(room, 'sign');
    if (modIs(room, 'rush')) v *= 1.25;
  }
  v = Math.round(v);
  if (room.mode === 'days') room.money += v; else room.score += v;
  return v;
}
function reward(room, v) { if (room.mode === 'days') room.money += v; else room.score += v; }

function completeOrder(room, o) {
  if ((o.r && !o.fd) || (o.dr && !o.dd)) return 0;
  const i = room.orders.indexOf(o);
  if (i >= 0) room.orders.splice(i, 1);
  return o.r && o.dr ? payout(room, o, 10, false) : 0;    // bonus za kompletní menu
}

// zničí předmět ze stanice (oheň, krysa); hasicák se vrátí do držáku, talíř se vrátí špinavý
function destroyItem(room, st) {
  const it = st.item;
  if (!it) return;
  if (isExt(it)) restoreExt(room);
  else if (isPlate(it)) room.returns.push(DIRTY_DELAY);
  st.item = null;
  resetStation(st);
}

function restoreExt(room) {
  for (const k in room.st) if (room.st[k].type === 'Y') room.st[k].has = true;
}

// naplnění kelímku u kohoutku (držení i mačkání)
function checkFill(room, p, st, fx, fy) {
  if (st.prog < 1) return;
  st.prog = 0;
  if (room.mode === 'days') room.stock[st.drink] = Math.max(0, (room.stock[st.drink] || 0) - 1);
  p.held.d = st.drink;
  ev(room, 'done', fx, fy);
}
function fillBlocked(room, p, st, fx, fy) {
  if (room.mode === 'days' && (room.stock[st.drink] || 0) <= 0) {
    if (p.sfxT <= 0) { ev(room, 'no', fx, fy, { m: 'Došlo ' + ING_CS[st.drink] + '!' }); p.sfxT = 1; }
    return true;
  }
  return false;
}

/* ---------- Oheň a hasicák ---------- */
function igniteAt(room, x, y) {
  const key = x + ',' + y;
  if (room.fires[key] || !FLAMMABLE.has(tileAt(x, y))) return false;
  room.fires[key] = { x, y, hp: 1, spread: FIRE_SPREAD * (0.8 + Math.random() * 0.5) };
  const st = room.st[key];
  if (st) { destroyItem(room, st); if (st.type === 'T') st.prog = 0; }
  ev(room, 'fire', x + 0.5, y + 0.5, { m: 'Hoří!' });
  return true;
}
function updateFires(room, dt) {
  for (const key of Object.keys(room.fires)) {
    const f = room.fires[key];
    f.spread -= dt;
    if (f.spread > 0) continue;
    f.spread = FIRE_SPREAD * (0.8 + Math.random() * 0.5);
    if (Math.random() > 0.65) continue;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) if (igniteAt(room, f.x + dx, f.y + dy)) break;
  }
}
function spray(room, p, key, f, dt) {
  const held = p.held;
  if (held.c <= 0) {
    if (p.sfxT <= 0) { ev(room, 'no', f.x + 0.5, f.y + 0.5, { m: 'Hasicák je prázdný!' }); p.sfxT = 1; }
    return;
  }
  const lv = up(room, 'ext');
  f.hp -= dt / EXT_TIME * (1 + 0.35 * lv);
  held.c = Math.max(0, held.c - EXT_DRAIN * dt * (1 - 0.2 * lv));
  if (p.sfxT <= 0) { ev(room, 'spray', f.x + 0.5, f.y + 0.5); p.sfxT = 0.25; }
  if (f.hp <= 0) {
    delete room.fires[key];
    room.stat.fires++;
    ev(room, 'extinguish', f.x + 0.5, f.y + 0.5, { m: 'Uhašeno!' });
  }
}

/* ---------- Krysy ---------- */
const FLOOR_EDGE = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (MAP[y][x] === '.' && (x === 1 || x === W - 2 || y === 1 || y === H - 2)) FLOOR_EDGE.push([x, y]);

function spawnRat(room) {
  const [tx, ty] = pick(FLOOR_EDGE);
  room.rats.push({ id: ++room.ratSeq, x: tx + 0.5, y: ty + 0.5, a: 0, st: 'seek', goal: null, t: 0, nib: 0, stuck: 0, home: { x: tx + 0.5, y: ty + 0.5 } });
  ev(room, 'squeak', tx + 0.5, ty + 0.5);
}

function pickRatGoal(room, rat) {
  const cands = [];
  for (const key in room.st) {
    const st = room.st[key];
    if (room.fires[key]) continue;
    if ((st.type === 'C' || st.type === 'K' || st.type === 'F') && st.item) cands.push({ kind: 'item', gx: st.x, gy: st.y });
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = MAP[y][x];
    if (room.fires[x + ',' + y]) continue;
    if (ch === 'D' && room.plates > 0) cands.push({ kind: 'plates', gx: x, gy: y });
    else if (CRATES[ch] && room.mode === 'days' && (room.stock[CRATES[ch]] || 0) > 0) cands.push({ kind: 'crate', gx: x, gy: y, k: CRATES[ch] });
  }
  for (let tries = 0; tries < 6 && cands.length; tries++) {
    const g = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
    let best = null, bd = 1e9;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ax = g.gx + dx, ay = g.gy + dy;
      if (tileAt(ax, ay) !== '.') continue;
      const d = Math.hypot(ax + 0.5 - rat.x, ay + 0.5 - rat.y);
      if (d < bd) { bd = d; best = [ax + 0.5, ay + 0.5]; }
    }
    if (best) { g.ax = best[0]; g.ay = best[1]; return g; }
  }
  return null;
}

function stepRat(rat, tx, ty, speed, dt) {
  const dx = tx - rat.x, dy = ty - rat.y, d = Math.hypot(dx, dy);
  if (d < 0.1) return true;
  const step = Math.min(d, speed * dt);
  const mx = dx / d * step, my = dy / d * step;
  const ox = rat.x, oy = rat.y;
  if (!blockedBy(rat.x + mx, rat.y, RAT_HALF)) rat.x += mx;
  if (!blockedBy(rat.x, rat.y + my, RAT_HALF)) rat.y += my;
  rat.a = Math.atan2(mx, my);
  rat.stuck = Math.hypot(rat.x - ox, rat.y - oy) < step * 0.3 ? rat.stuck + dt : 0;
  return d - step < 0.1;
}

function ratGoalValid(room, g) {
  const key = g.gx + ',' + g.gy;
  if (room.fires[key]) return false;
  if (g.kind === 'item') return !!(room.st[key] && room.st[key].item);
  if (g.kind === 'plates') return room.plates > 0;
  return room.mode === 'days' && (room.stock[g.k] || 0) > 0;
}

function updateRats(room, dt) {
  if (room.cd > 0) return;
  room.nextRat -= dt;
  const maxRats = 2 + (modIs(room, 'vermin') ? 2 : 0);
  if (room.nextRat <= 0) {
    if (room.rats.length < maxRats && room.time > 10) spawnRat(room);
    const base = modIs(room, 'vermin') ? 20 : 34;
    room.nextRat = (base + Math.random() * 14) * (room.players.size <= 1 ? 1.3 : 1) * (1 + 0.4 * up(room, 'trap'));
  }
  const eatTime = RAT_EAT * (1 + 0.25 * up(room, 'trap'));
  for (let i = room.rats.length - 1; i >= 0; i--) {
    const r = room.rats[i];
    // hráči krysy plaší
    if (r.st !== 'flee') {
      const scare = r.st === 'eat' ? 0.75 : 1.1;
      for (const p of room.players.values()) {
        if (Math.hypot(p.x - r.x, p.y - r.y) < scare) { r.st = 'flee'; ev(room, 'squeak', r.x, r.y); break; }
      }
    }
    if (r.st === 'seek') {
      if (!r.goal || !ratGoalValid(room, r.goal) || r.stuck > 1.2) { r.goal = pickRatGoal(room, r); r.stuck = 0; }
      if (!r.goal) { r.st = 'flee'; continue; }
      if (stepRat(r, r.goal.ax, r.goal.ay, RAT_SPEED, dt)) { r.st = 'eat'; r.t = eatTime; r.nib = 0; }
    } else if (r.st === 'eat') {
      if (!ratGoalValid(room, r.goal)) { r.st = 'flee'; continue; }
      r.t -= dt; r.nib -= dt;
      if (r.nib <= 0) { ev(room, 'nibble', r.goal.gx + 0.5, r.goal.gy + 0.5); r.nib = 0.7; }
      if (r.t <= 0) {
        const g = r.goal, key = g.gx + ',' + g.gy;
        let m = 'Krysa to sežrala!';
        if (g.kind === 'item') destroyItem(room, room.st[key]);
        else if (g.kind === 'plates') { room.plates = Math.max(0, room.plates - 1); m = 'Krysa ukradla talíř!'; }
        else { room.stock[g.k] = Math.max(0, (room.stock[g.k] || 0) - 2); m = 'Krysa žere zásoby!'; }
        ev(room, 'ratsteal', g.gx + 0.5, g.gy + 0.5, { m });
        r.st = 'flee';
      }
    } else {
      if (stepRat(r, r.home.x, r.home.y, RAT_SPEED * 1.7, dt) || r.stuck > 2) room.rats.splice(i, 1);
    }
  }
}

/* ---------- Náhodné události (chaos) ---------- */
function startChaos(room) {
  const pool = CHAOS.filter((c) => !(c.id === 'rats' && room.rats.length >= 3) && !(c.id === 'spark' && Object.keys(room.fires).length >= 3));
  const c = weighted(pool);
  room.chaos = { id: c.id, n: c.n, t: c.dur, d: c.dur };
  ev(room, 'chaos', 0, 0, { m: c.n, k: c.id });
  if (c.id === 'rats') { spawnRat(room); spawnRat(room); }
  if (c.id === 'spark') {
    const spots = [];
    for (const key in room.st) { const st = room.st[key]; if (!room.fires[key] && (st.type === 'F' || st.type === 'C' || st.type === 'K')) spots.push(st); }
    if (spots.length) { const t = pick(spots); igniteAt(room, t.x, t.y); }
  }
}
function updateChaos(room, dt) {
  if (room.chaos) { room.chaos.t -= dt; if (room.chaos.t <= 0) room.chaos = null; }
  room.nextChaos -= dt;
  if (room.nextChaos <= 0) {
    if (!room.chaos && room.time > 14) startChaos(room);
    room.nextChaos = (30 + Math.random() * 18) * (room.players.size <= 1 ? 1.3 : 1);
  }
}

function interact(room, p) {
  const [tx, ty] = targetOf(p);
  const ch = tileAt(tx, ty);
  const st = room.st[tx + ',' + ty];
  const held = p.held;
  const fx = tx + 0.5, fy = ty + 0.5;
  const key = tx + ',' + ty;

  // krysa před nosem? – plácnutí
  const kx = p.x + p.fx * 0.75, ky = p.y + p.fy * 0.75;
  const ri = room.rats.findIndex((r) => Math.hypot(r.x - kx, r.y - ky) < 0.8);
  if (ri >= 0) {
    const r = room.rats.splice(ri, 1)[0];
    reward(room, 5); room.stat.rats++;
    return ev(room, 'splat', r.x, r.y, { v: 5 });
  }
  // hořící políčko – použitelný je jen hasicák
  const fire = room.fires[key];
  if (fire) {
    if (isExt(held)) { spray(room, p, key, fire, 0.35); return undefined; }
    return ev(room, 'no', fx, fy, { m: 'Hoří! Vezmi hasicák!' });
  }

  if (CRATES[ch]) {
    if (!held) {
      const k = CRATES[ch];
      if (room.mode === 'days') {
        if ((room.stock[k] || 0) <= 0) return ev(room, 'no', fx, fy, { m: 'Došlo ' + ING_CS[k] + '!' });
        room.stock[k]--;
      }
      p.held = newIngredient(k);
      return ev(room, 'pick', fx, fy);
    }
    return ev(room, 'no', fx, fy);
  }
  switch (ch) {
    case 'C': case 'K': case 'F':
      return interactStorage(room, p, st, ch, fx, fy);

    case 'D': // stoh čistých talířů
      if (!held) {
        if (room.plates > 0) { room.plates--; p.held = newPlate(); return ev(room, 'pick', fx, fy); }
        return ev(room, 'no', fx, fy, { m: 'Došly čisté talíře!' });
      }
      if (isPlate(held) && held.c.length === 0) { room.plates++; p.held = null; return ev(room, 'drop', fx, fy); }
      return ev(room, 'no', fx, fy);

    case 'W': // dřez – mytí špinavých talířů
      if (!held && room.dirty > 0) {
        st.prog += WASH_BUMP; ev(room, 'wash', fx, fy);
        return checkWash(room, st);
      }
      return ev(room, 'no', fx, fy);

    case 'U': // kelímky
      if (!held) { p.held = newCup(); return ev(room, 'pick', fx, fy); }
      if (isCup(held) && !held.d) { p.held = null; return ev(room, 'drop', fx, fy); }
      return ev(room, 'no', fx, fy);

    case 'A': case 'E': case 'O': // kohoutky s pitím
      if (!isCup(held)) return ev(room, 'no', fx, fy, { m: 'Potřebuješ kelímek' });
      if (held.d) return ev(room, 'no', fx, fy, { m: 'Kelímek je plný' });
      if (fillBlocked(room, p, st, fx, fy)) return undefined;
      st.prog += FILL_BUMP;
      ev(room, 'pour', fx, fy);
      return checkFill(room, p, st, fx, fy);

    case 'Y': // držák hasicího přístroje
      if (!held) {
        if (st.has) { st.has = false; p.held = newExt(); return ev(room, 'pick', fx, fy); }
        return ev(room, 'no', fx, fy, { m: 'Hasicák je jinde' });
      }
      if (isExt(held)) { st.has = true; p.held = null; return ev(room, 'drop', fx, fy); }
      return ev(room, 'no', fx, fy);

    case 'X': // koš
      if (!held) return ev(room, 'no', fx, fy);
      if (isExt(held)) return ev(room, 'no', fx, fy, { m: 'Hasicák nevyhazuj!' });
      if (isCup(held)) {
        if (!held.d) return ev(room, 'no', fx, fy);
        held.d = null;                       // pití se vylije, kelímek zůstane
      } else if (isPlate(held)) {
        if (!held.c.length) return ev(room, 'no', fx, fy);
        held.c = []; // talíř zůstává v ruce, jídlo se vyhodí
      } else p.held = null;
      return ev(room, 'trash', fx, fy);

    case 'P': { // výdejní pult
      if (isCup(held)) {
        if (!held.d) return ev(room, 'no', fx, fy, { m: 'Kelímek je prázdný' });
        const di = findDrinkOrder(room, held.d);
        if (di < 0) return ev(room, 'no', fx, fy, { m: 'Tohle nikdo neobjednal!' });
        const o = room.orders[di];
        let pts = payout(room, o, 8 + Math.round(6 * Math.max(0, o.t / o.l)), true);
        o.dd = true; room.stat.drinks++; p.held = null;
        pts += completeOrder(room, o);
        return ev(room, 'serve', fx, fy, { v: pts, o: o.id, part: 'drink', d: held.d });
      }
      if (!isPlate(held) || !held.c.length) return ev(room, 'no', fx, fy, { m: 'Potřebuješ talíř s jídlem nebo pití' });
      const idx = findOrder(room, held.c);
      if (idx < 0) return ev(room, 'no', fx, fy, { m: 'Tohle nikdo neobjednal!' });
      const o = room.orders[idx];
      let pts = payout(room, o, 15 + 5 * RECIPES_PUBLIC[o.r].items.length + Math.round(10 * Math.max(0, o.t / o.l)), false);
      o.fd = true; room.delivered++; room.stat.dishes++;
      p.held = null;
      room.returns.push(DIRTY_DELAY); // špinavý talíř se vrátí k dřezu
      pts += completeOrder(room, o);
      return ev(room, 'serve', fx, fy, { v: pts, o: o.id, part: 'food', c: held.c.slice() });
    }
    default:
      return undefined;
  }
}

// Podržená klávesa: krájení, mytí, stříkání hasicákem, plnění kelímku
function updateHold(room, p, dt) {
  if (!p.input.hold) return;
  const [tx, ty] = targetOf(p);
  const key = tx + ',' + ty;
  const fx = tx + 0.5, fy = ty + 0.5;
  p.sfxT -= dt;
  const fire = room.fires[key];
  if (isExt(p.held)) { if (fire) spray(room, p, key, fire, dt); return; }
  if (fire) return;
  const st = room.st[key];
  if (!st) return;
  if (isCup(p.held)) {
    if (st.type === 'T' && !p.held.d && !fillBlocked(room, p, st, fx, fy)) {
      st.prog += dt / FILL_TIME;
      if (p.sfxT <= 0) { ev(room, 'pour', fx, fy); p.sfxT = 0.22; }
      checkFill(room, p, st, fx, fy);
    }
    return;
  }
  if (p.held) return;
  if (st.type === 'K' && isIng(st.item) && CHOPPABLE[st.item.k] && st.item.s === 'raw') {
    st.prog += dt / CHOP_TIME * (1 + 0.25 * up(room, 'knife'));
    if (p.sfxT <= 0) { ev(room, 'chop', fx, fy); p.sfxT = 0.22; }
    checkChop(room, st);
  } else if (st.type === 'W' && room.dirty > 0) {
    st.prog += dt / WASH_TIME;
    if (p.sfxT <= 0) { ev(room, 'wash', fx, fy); p.sfxT = 0.3; }
    checkWash(room, st);
  }
}

/* ------------------------------------------------------------------ */
/*  Simulace jednoho ticku                                             */
/* ------------------------------------------------------------------ */
function updateStoves(room, dt) {
  const heat = modIs(room, 'heat') ? 1.5 : chaosIs(room, 'heat') ? 1.8 : 1;
  const burnT = BURN_TIME * (1 + 0.3 * up(room, 'pan'));
  for (const s of room.stoves) {
    const it = s.item;
    if (!it) continue;
    const fx = s.x + 0.5, fy = s.y + 0.5;
    if (it.s === 'chopped') {
      s.prog += dt * heat / COOK_TIME;
      if (s.prog >= 1) { it.s = 'cooked'; s.prog = 1; s.burn = 0; s.warned = false; ev(room, 'done', fx, fy); }
    } else if (it.s === 'cooked') {
      s.burn += dt * heat / burnT;
      if (s.burn >= 0.55 && !s.warned) { s.warned = true; ev(room, 'warn', fx, fy); }
      if (s.burn >= 1) { it.s = 'burnt'; s.burn = 1; s.smolder = 0; ev(room, 'burn', fx, fy); }
    } else if (it.s === 'burnt') {
      s.smolder = (s.smolder || 0) + dt;                      // připálené maso se vznítí!
      if (s.smolder >= FIRE_IGNITE_DELAY) igniteAt(room, s.x, s.y);
    }
  }
}

function spawnOrder(room) {
  if (room.orders.length >= MAX_ORDERS) return;
  const thirst = thirstOn(room);
  let rec = null, dr = null;
  if (Math.random() < (thirst ? 0.3 : 0.16)) dr = pick(DRINK_IDS);           // jen pití
  else {
    rec = weighted(RECIPES);
    if (thirst || Math.random() < 0.4) dr = pick(DRINK_IDS);                 // menu: jídlo + pití
  }
  let limit = (rec ? 55 + rec.items.length * 12 : 38) + (rec && dr ? 12 : 0);
  limit = Math.round(limit * (room.players.size <= 1 ? 1.3 : 1));
  let vip = false;
  if (room.mode === 'days') {
    const chance = modIs(room, 'vip') ? 0.35 : Math.min(0.2, 0.06 + 0.01 * room.day);
    vip = Math.random() < chance;
    if (vip) limit = Math.round(limit * 0.75);
  }
  room.orders.push({ id: ++room.orderSeq, r: rec ? rec.id : null, dr, fd: false, dd: false, vip, t: limit, l: limit });
  ev(room, 'order', 0, 0, { vip });
}

function updateOrders(room, dt) {
  const rush = (chaosIs(room, 'rush') ? 2 : 1) * (modIs(room, 'rush') ? 1.4 : 1);
  room.nextOrder -= dt * rush;
  if (room.orders.length === 0 && room.nextOrder > 2) room.nextOrder = 2;
  if (room.nextOrder <= 0) {
    spawnOrder(room);
    if (room.orderSeq === 1) room.nextOrder = 6;
    else {
      let elapsed = 1 - room.time / room.len;
      if (room.mode === 'days') elapsed = Math.min(1, elapsed * 0.5 + Math.min(0.5, (room.day - 1) * 0.08));   // dny jsou postupně těžší
      const f = [1, 1.6, 1.15, 1, 0.85][Math.min(room.players.size, 4)];
      room.nextOrder = Math.max(7, (17 - 6 * elapsed) * f + (Math.random() * 4 - 2));
    }
  }
  // kouř z požáru zákazníky odhání – objednávky se kazí rychleji
  const drain = 1 + Math.min(1.5, 0.25 * Object.keys(room.fires).length);
  for (let i = room.orders.length - 1; i >= 0; i--) {
    const o = room.orders[i];
    o.t -= dt * drain;
    if (o.t <= 0) {
      room.orders.splice(i, 1);
      room.expired++;
      if (room.mode === 'days') room.money = Math.max(0, room.money - EXPIRE_PENALTY);
      else room.score = Math.max(0, room.score - EXPIRE_PENALTY);
      ev(room, 'expire', 0, 0, { o: o.id });
    }
  }
}

function tickRoom(room, dt) {
  if (room.state !== 'playing') return;
  if (room.cd > 0) {
    room.cd = Math.max(0, room.cd - dt);
    if (room.cd === 0) ev(room, 'go', 0, 0);
    return;
  }
  room.time -= dt;

  const list = [...room.players.values()];
  for (const p of list) {
    const { dx, dy } = p.input;
    if (dx || dy) {
      // analogový pohyb z pohledu první osoby (délka vektoru max. 1)
      const k = SPEED * (1 + 0.08 * up(room, 'boots')) * dt / Math.max(1, Math.hypot(dx, dy));
      moveBy(p, dx * k, dy * k);
    }
  }
  separate(list);
  for (const p of list) updateHold(room, p, dt);
  updateStoves(room, dt);
  updateFires(room, dt);
  updateRats(room, dt);
  updateChaos(room, dt);
  if (room.dirty === 0) for (const s of room.sinks) s.prog = 0;

  for (let i = room.returns.length - 1; i >= 0; i--) {
    room.returns[i] -= dt;
    if (room.returns[i] <= 0) { room.returns.splice(i, 1); room.dirty++; }
  }
  updateOrders(room, dt);
  if (room.time <= 0) endGame(room);
}

/* ------------------------------------------------------------------ */
/*  Snapshot stavu pro klienty                                         */
/* ------------------------------------------------------------------ */
function snapshot(room) {
  const s = {};
  for (const key in room.st) {
    const st = room.st[key];
    if (st.type === 'C') { if (st.item) s[key] = { i: st.item }; }
    else if (st.type === 'K') { if (st.item) s[key] = { i: st.item, p: r2(st.prog) }; }
    else if (st.type === 'F') { if (st.item) s[key] = { i: st.item, p: r2(st.prog), b: r2(st.burn), f: r2(Math.min(1, (st.smolder || 0) / FIRE_IGNITE_DELAY)) }; }
    else if (st.type === 'W') { if (st.prog > 0) s[key] = { p: r2(st.prog) }; }
    else if (st.type === 'T') { if (st.prog > 0) s[key] = { p: r2(st.prog) }; }
    else if (st.type === 'Y') s[key] = { x: st.has ? 1 : 0 };
  }
  const events = room.events;
  room.events = [];
  const out = {
    t: r1(Math.max(0, room.time)),
    cd: r1(room.cd),
    sc: room.mode === 'days' ? room.money : room.score,
    pl: [...room.players.values()].map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r2(p.x), y: r2(p.y), fx: r2(p.fx), fy: r2(p.fy), h: p.held,
    })),
    s,
    o: room.orders.map((o) => ({ id: o.id, r: o.r, dr: o.dr, fd: o.fd, dd: o.dd, v: o.vip ? 1 : 0, t: r1(o.t), l: o.l })),
    fi: Object.values(room.fires).map((f) => ({ x: f.x, y: f.y, h: r2(f.hp) })),
    rt: room.rats.map((r) => ({ id: r.id, x: r2(r.x), y: r2(r.y), a: r2(r.a), s: r.st === 'eat' ? 1 : r.st === 'flee' ? 2 : 0 })),
    ch: room.chaos ? { id: room.chaos.id, n: room.chaos.n, t: r1(room.chaos.t), d: room.chaos.d } : null,
    d: room.plates,
    w: room.dirty,
    ev: events,
  };
  if (room.mode === 'days') {
    out.sk = room.stock; out.dy = room.day;
    if (room.goal) out.g = { k: room.goal.k, n: room.goal.need, v: goalProgress(room, room.goal), r: room.goal.reward, t: room.goal.text };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Socket.io události                                                 */
/* ------------------------------------------------------------------ */
io.on('connection', (socket) => {
  socket.data.code = null;

  socket.on('create', (d) => {
    removePlayer(socket);
    const room = createRoom(d && d.mode);
    addPlayer(room, socket, cleanName(d && d.name));
    socket.emit('joined', { id: socket.id, code: room.code });
    broadcastRoom(room);
    if (d && d.solo) startGame(room);          // „Hrát sám“ – rovnou start
  });

  socket.on('join', (d) => {
    d = d || {};
    const code = String(d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const room = rooms.get(code);
    if (!room) return socket.emit('err', { m: 'Místnost „' + code + '“ neexistuje.' });
    if (room.players.has(socket.id)) return;
    if (room.state === 'playing') return socket.emit('err', { m: 'V této místnosti už hra běží.' });
    if (room.players.size >= MAX_PLAYERS) return socket.emit('err', { m: 'Místnost je plná (max ' + MAX_PLAYERS + ' hráči).' });
    removePlayer(socket);
    addPlayer(room, socket, cleanName(d.name));
    socket.emit('joined', { id: socket.id, code: room.code });
    broadcastRoom(room);
    if (room.state === 'shop') broadcastShop(room);   // nově příchozí rovnou uvidí obchod
  });

  // Hostitel mění režim v lobby
  socket.on('setMode', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'lobby' || room.host !== socket.id) return;
    const mode = d && d.mode;
    if (!MODES.includes(mode) || mode === room.mode) return;
    room.mode = mode;
    broadcastRoom(room);
  });

  // Režim „Dny“: nákup surovin mezi dny
  socket.on('buy', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d) return;
    const k = String(d.k);
    if (!Object.prototype.hasOwnProperty.call(room.prices, k)) return;
    let n = Math.floor(Number(d.n));
    if (!(n >= 1)) return;
    const have = room.stock[k] || 0;
    n = Math.min(n, STOCK_CAP - have);
    if (n <= 0) return socket.emit('err', { m: 'Sklad je plný (max ' + STOCK_CAP + ').' });
    const cost = room.prices[k] * n;
    if (cost > room.money) return socket.emit('err', { m: 'Nemáš dost peněz.' });
    room.money -= cost;
    room.stock[k] = have + n;
    broadcastShop(room);
  });

  socket.on('upgrade', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d) return;
    const id = String(d.id);
    if (!Object.prototype.hasOwnProperty.call(UPGRADES, id)) return;
    const lvl = up(room, id), u = UPGRADES[id];
    if (lvl >= u.cost.length) return socket.emit('err', { m: 'Tohle vylepšení už je na maximu.' });
    if (u.cost[lvl] > room.money) return socket.emit('err', { m: 'Nemáš dost peněz.' });
    room.money -= u.cost[lvl];
    room.upgrades[id] = lvl + 1;
    broadcastShop(room);
  });

  socket.on('ready', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !room.players.has(socket.id)) return;
    if (room.ready.has(socket.id)) room.ready.delete(socket.id); else room.ready.add(socket.id);
    broadcastShop(room);
    checkReady(room);
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state === 'playing' || room.state === 'shop') return;
    if (room.players.size < MIN_PLAYERS) return socket.emit('err', { m: 'Pro start jsou potřeba aspoň ' + MIN_PLAYERS + ' hráči.' });
    startGame(room);
  });

  socket.on('toLobby', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'ended') return;
    room.state = 'lobby';
    broadcastRoom(room);
  });

  socket.on('input', (d) => {
    const p = playerOf(socket);
    if (!p || !d) return;
    const cl = (n) => Math.max(-1, Math.min(1, Number(n) || 0));
    p.input = { dx: cl(d.dx), dy: cl(d.dy), hold: !!d.hold };
    // směr pohledu (jednotkový vektor) – podle něj se míří na stanice
    const fx = Number(d.fx), fy = Number(d.fy), fl = Math.hypot(fx, fy);
    if (isFinite(fl) && fl > 0.01) { p.fx = fx / fl; p.fy = fy / fl; }
  });

  socket.on('press', () => {
    const room = rooms.get(socket.data.code);
    const p = room && room.players.get(socket.id);
    if (p && room.state === 'playing' && room.cd === 0) interact(room, p);
  });

  socket.on('leave', () => removePlayer(socket));
  socket.on('disconnect', () => removePlayer(socket));
});

/* ------------------------------------------------------------------ */
/*  Herní smyčka a start serveru                                       */
/* ------------------------------------------------------------------ */
let lastTick = Date.now();
function loop() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const room of rooms.values()) {
    if (room.state !== 'playing') continue;
    tickRoom(room, dt);
    if (room.state === 'playing') io.to(room.code).emit('state', snapshot(room));
  }
}

if (require.main === module) {
  setInterval(loop, 1000 / TICK_RATE);
  server.listen(PORT, () => console.log('Šílená kuchyně běží na portu ' + PORT));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
} else {
  module.exports = { rooms, tickRoom, interact, snapshot, startGame, MAP, PRICES, rentFor }; // pro testy
}
