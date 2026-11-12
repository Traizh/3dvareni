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
const MIN_PLAYERS = 2;
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
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const SPAWNS = [[3.5, 2.5], [12.5, 2.5], [3.5, 7.5], [12.5, 7.5]];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/*
 * Mapa kuchyně (16 x 10)
 *  . podlaha   # zeď        C pult (odkládání)
 *  B houska  M maso  S sýr  L salát  T rajče   (bedny se surovinami)
 *  K krájecí prkénko   F sporák   P výdejní pult
 *  X koš   D stoh čistých talířů   W dřez (mytí)
 */
const MAP = [
  '#CBCMCSCLCTCCCC#',
  '#..............#',
  '#..............#',
  'C..............P',
  'F....CKKKCC....P',
  'C....CCFFCC....P',
  'C..............P',
  '#..............#',
  '#..............#',
  '#XCCCCCCCCCWWDC#',
];
const H = MAP.length;
const W = MAP[0].length;
MAP.forEach((row, i) => {
  if (row.length !== W) throw new Error('Řádek mapy ' + i + ' má špatnou délku');
});

const CRATES = { B: 'bun', M: 'meat', S: 'cheese', L: 'lettuce', T: 'tomato' };
// V jakém stavu musí být surovina, aby šla na talíř
const NEED = { bun: 'raw', meat: 'cooked', cheese: 'raw', lettuce: 'chopped', tomato: 'chopped' };
const CHOPPABLE = { meat: true, lettuce: true, tomato: true };

const RECIPES = [
  { id: 'cheese', name: 'Cheeseburger', items: ['bun', 'meat', 'cheese'], w: 3 },
  { id: 'salad', name: 'Salátový burger', items: ['bun', 'meat', 'lettuce', 'tomato'], w: 3 },
  { id: 'plain', name: 'Hamburger', items: ['bun', 'meat'], w: 2 },
  { id: 'bowl', name: 'Zeleninový salát', items: ['lettuce', 'tomato'], w: 1 },
];
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
function blocked(x, y) {
  const x0 = Math.floor(x - HALF), x1 = Math.floor(x + HALF);
  const y0 = Math.floor(y - HALF), y1 = Math.floor(y + HALF);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (isSolid(tx, ty)) return true;
  }
  return false;
}

function moveBy(o, dx, dy) {
  if (!blocked(o.x + dx, o.y)) o.x += dx;
  if (!blocked(o.x, o.y + dy)) o.y += dy;
}

function updateFacing(p, dx, dy) {
  if (!dx && !dy) return;
  if (dx && dy) {
    if (p.fx === dx || p.fy === dy) return; // úhlopříčka: zachovej směr, pokud sedí
    p.fx = dx; p.fy = 0;
    return;
  }
  p.fx = dx; p.fy = dy;
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
function createRoom() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  const room = {
    code, state: 'lobby', players: new Map(),
    st: {}, stoves: [], sinks: [], orders: [], returns: [], events: [],
    time: 0, cd: 0, score: 0, plates: 0, dirty: 0,
    delivered: 0, expired: 0, orderSeq: 0, nextOrder: 0, last: null,
  };
  rooms.set(code, room);
  return room;
}

function roomInfo(room) {
  return {
    code: room.code, state: room.state, min: MIN_PLAYERS, max: MAX_PLAYERS,
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
  room.players.delete(socket.id);
  if (room.players.size === 0) rooms.delete(code);
  else broadcastRoom(room);
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
      }
    }
  }
}

function startGame(room) {
  room.state = 'playing';
  room.time = GAME_TIME; room.cd = COUNTDOWN;
  room.score = 0; room.delivered = 0; room.expired = 0;
  room.orders = []; room.orderSeq = 0; room.nextOrder = 1;
  room.returns = []; room.events = [];
  room.plates = START_PLATES; room.dirty = 0;
  buildStations(room);
  for (const p of room.players.values()) {
    p.x = SPAWNS[p.slot][0]; p.y = SPAWNS[p.slot][1];
    p.fx = 0; p.fy = 1; p.held = null;
    p.input = { dx: 0, dy: 0, hold: false }; p.sfxT = 0;
  }
  io.to(room.code).emit('gameStart', { map: MAP, recipes: RECIPES_PUBLIC, time: GAME_TIME, cd: COUNTDOWN });
  broadcastRoom(room);
}

function endGame(room) {
  room.state = 'ended';
  const s = room.score;
  room.last = {
    score: s, delivered: room.delivered, expired: room.expired,
    stars: s >= 240 ? 3 : s >= 140 ? 2 : s >= 60 ? 1 : 0,
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
  st.prog = 0; st.burn = 0; st.warned = false;
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
      st.prog += CHOP_BUMP;
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
    const items = RECIPES_PUBLIC[o.r].items;
    if (items.length === content.length && content.every((k) => items.includes(k))) {
      if (best < 0 || o.t < room.orders[best].t) best = i;
    }
  });
  return best;
}

function interact(room, p) {
  const [tx, ty] = targetOf(p);
  const ch = tileAt(tx, ty);
  const st = room.st[tx + ',' + ty];
  const held = p.held;
  const fx = tx + 0.5, fy = ty + 0.5;

  if (CRATES[ch]) {
    if (!held) { p.held = newIngredient(CRATES[ch]); return ev(room, 'pick', fx, fy); }
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

    case 'X': // koš
      if (!held) return ev(room, 'no', fx, fy);
      if (isPlate(held)) {
        if (!held.c.length) return ev(room, 'no', fx, fy);
        held.c = []; // talíř zůstává v ruce, jídlo se vyhodí
      } else p.held = null;
      return ev(room, 'trash', fx, fy);

    case 'P': { // výdejní pult
      if (!isPlate(held) || !held.c.length) return ev(room, 'no', fx, fy, { m: 'Potřebuješ talíř s jídlem' });
      const idx = findOrder(room, held.c);
      if (idx < 0) return ev(room, 'no', fx, fy, { m: 'Tohle nikdo neobjednal!' });
      const o = room.orders.splice(idx, 1)[0];
      const pts = 15 + 5 * RECIPES_PUBLIC[o.r].items.length + Math.round(10 * Math.max(0, o.t / o.l));
      room.score += pts; room.delivered++;
      p.held = null;
      room.returns.push(DIRTY_DELAY); // špinavý talíř se vrátí k dřezu
      return ev(room, 'serve', fx, fy, { v: pts });
    }
    default:
      return undefined;
  }
}

// Podržená klávesa: krájení na prkénku a mytí v dřezu
function updateHold(room, p, dt) {
  if (!p.input.hold || p.held) return;
  const [tx, ty] = targetOf(p);
  const st = room.st[tx + ',' + ty];
  if (!st) return;
  const fx = tx + 0.5, fy = ty + 0.5;
  p.sfxT -= dt;
  if (st.type === 'K' && isIng(st.item) && CHOPPABLE[st.item.k] && st.item.s === 'raw') {
    st.prog += dt / CHOP_TIME;
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
  for (const s of room.stoves) {
    const it = s.item;
    if (!it) continue;
    const fx = s.x + 0.5, fy = s.y + 0.5;
    if (it.s === 'chopped') {
      s.prog += dt / COOK_TIME;
      if (s.prog >= 1) { it.s = 'cooked'; s.prog = 1; s.burn = 0; s.warned = false; ev(room, 'done', fx, fy); }
    } else if (it.s === 'cooked') {
      s.burn += dt / BURN_TIME;
      if (s.burn >= 0.55 && !s.warned) { s.warned = true; ev(room, 'warn', fx, fy); }
      if (s.burn >= 1) { it.s = 'burnt'; s.burn = 1; ev(room, 'burn', fx, fy); }
    }
  }
}

function spawnOrder(room) {
  if (room.orders.length >= MAX_ORDERS) return;
  const total = RECIPES.reduce((a, r) => a + r.w, 0);
  let x = Math.random() * total, rec = RECIPES[0];
  for (const r of RECIPES) { x -= r.w; if (x <= 0) { rec = r; break; } }
  const limit = 55 + rec.items.length * 12;
  room.orders.push({ id: ++room.orderSeq, r: rec.id, t: limit, l: limit });
  ev(room, 'order', 0, 0);
}

function updateOrders(room, dt) {
  room.nextOrder -= dt;
  if (room.orders.length === 0 && room.nextOrder > 2) room.nextOrder = 2;
  if (room.nextOrder <= 0) {
    spawnOrder(room);
    if (room.orderSeq === 1) room.nextOrder = 6;
    else {
      const elapsed = 1 - room.time / GAME_TIME;
      const f = [1, 1, 1.15, 1, 0.85][Math.min(room.players.size, 4)];
      room.nextOrder = Math.max(7, (17 - 6 * elapsed) * f + (Math.random() * 4 - 2));
    }
  }
  for (let i = room.orders.length - 1; i >= 0; i--) {
    const o = room.orders[i];
    o.t -= dt;
    if (o.t <= 0) {
      room.orders.splice(i, 1);
      room.expired++;
      room.score = Math.max(0, room.score - EXPIRE_PENALTY);
      ev(room, 'expire', 0, 0);
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
      const len = Math.hypot(dx, dy);
      moveBy(p, (dx / len) * SPEED * dt, (dy / len) * SPEED * dt);
      updateFacing(p, dx, dy);
    }
  }
  separate(list);
  for (const p of list) updateHold(room, p, dt);
  updateStoves(room, dt);
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
    else if (st.type === 'F') { if (st.item) s[key] = { i: st.item, p: r2(st.prog), b: r2(st.burn) }; }
    else if (st.type === 'W') { if (st.prog > 0) s[key] = { p: r2(st.prog) }; }
  }
  const events = room.events;
  room.events = [];
  return {
    t: r1(Math.max(0, room.time)),
    cd: r1(room.cd),
    sc: room.score,
    pl: [...room.players.values()].map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r2(p.x), y: r2(p.y), fx: p.fx, fy: p.fy, h: p.held,
    })),
    s,
    o: room.orders.map((o) => ({ id: o.id, r: o.r, t: r1(o.t), l: o.l })),
    d: room.plates,
    w: room.dirty,
    ev: events,
  };
}

/* ------------------------------------------------------------------ */
/*  Socket.io události                                                 */
/* ------------------------------------------------------------------ */
io.on('connection', (socket) => {
  socket.data.code = null;

  socket.on('create', (d) => {
    removePlayer(socket);
    const room = createRoom();
    addPlayer(room, socket, cleanName(d && d.name));
    socket.emit('joined', { id: socket.id, code: room.code });
    broadcastRoom(room);
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
  });

  socket.on('start', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state === 'playing') return;
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
    p.input = {
      dx: Math.sign(Number(d.dx) || 0),
      dy: Math.sign(Number(d.dy) || 0),
      hold: !!d.hold,
    };
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
  module.exports = { rooms, tickRoom, interact, snapshot, startGame, MAP }; // pro testy
}
