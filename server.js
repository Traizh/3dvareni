'use strict';
/**
 * Šílená kuchyně – multiplayerový server (Express + Socket.io)
 *
 * Server je plně autoritativní: simuluje pohyb hráčů, suroviny, krájení,
 * sporáky, objednávky, mytí talířů i skóre. Klienti posílají jen vstupy
 * (směr, držení interakce, stisk interakce) a vykreslují snapshoty stavu.
 */
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
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
const CMD_DT = 1 / 60;       // délka jednoho pohybového kroku (klient posílá příkazy po 1/60 s)
const MAX_QUEUE = 40;        // nejvýš tolik nezpracovaných příkazů na hráče
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
const FLAME_CAP = 40;        // max. počet plamenů najednou
const SPRAY_RANGE = 2.8;     // dosah hasicáku (v dlaždicích)
const SPRAY_COS = 0.88;      // polovina úhlu kuželu (~28°)
const EXT_DRAIN = 0.1;       // spotřeba hasicáku za s stříkání (10 s plně)
// Krysy
const RAT_SPEED = 2.3;
const RAT_HALF = 0.15;
const RAT_EAT = 3.2;         // s hlodání, než krysa něco odnese
// Režim „Dny“: zásoby, nákup surovin, nájem
const DAY_TIME = 120;        // délka jednoho dne (s)
const START_MONEY = 50;
const PRICES = {   // základní ceny
  bun: 2, meat: 5, cheese: 3, lettuce: 2, tomato: 2, cola: 2, lemon: 2, juice: 3,
  rice: 2, fish: 5, nori: 2, cucumber: 2, shrimp: 5, dough: 2, sauce: 1, pepperoni: 4, mushroom: 3,
};
// Sklad a police
const BOX_SIZE = 10;                   // kusů v jedné krabici
const SHELF_CAP = 15;                  // max. kusů na polici v kuchyni
const BOX_CAP = 8;                     // max. krabic jednoho druhu ve skladu (Dny)
const BOX_DISCOUNT = 0.8;              // krabice je levnější než kusy
const BOX_SPEED = 0.75;                // s krabicí v ruce se jde pomaleji
const SHELF_START_CLASSIC = 6;         // na začátku kola je police zpola plná
const SHELF_START_DAYS = 8;
const START_BOXES = { bun: 1, meat: 1, cheese: 1, lettuce: 1, tomato: 1, cola: 1, lemon: 1, juice: 1 };
const RENT_BASE = 25, RENT_STEP = 10;
const rentFor = (day) => RENT_BASE + RENT_STEP * (day - 1);
const ING_CS = {
  bun: 'housky', meat: 'masa', cheese: 'sýra', lettuce: 'salátu', tomato: 'rajčat', cola: 'koly', lemon: 'limonády', juice: 'džusu',
  rice: 'rýže', fish: 'ryby', nori: 'nori', cucumber: 'okurek', shrimp: 'krevet', dough: 'těsta', sauce: 'omáčky', pepperoni: 'salámu', mushroom: 'hub',
};
const MODES = ['classic', 'days'];
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
const SPAWNS = [[3.5, 2.5], [12.5, 2.5], [3.5, 7.5], [12.5, 7.5]];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/*
 * Mapa = kuchyně (řádky 0–9) + sklad pod ní (řádky 10–16). Každá restaurace má vlastní rozložení kuchyně.
 *  . podlaha   # zeď        C pult (odkládání)    = palety (ozdoba)
 *  B M S L T R H N G Q J V I Z   police se surovinami v kuchyni (podle restaurace)
 *  b m s l t r h n g q j v i z c e o   regály s krabicemi ve skladu
 *  K krájecí prkénko   F sporák / rýžovar / pec   P výdejní pult (okno do jídelny)
 *  X koš   D stoh čistých talířů   W dřez (mytí)
 *  U kelímky   A kohoutek cola   E kohoutek limonáda   O kohoutek džus
 *  Y držák hasicího přístroje
 */
const KITCHENS = {
  burger: [
    '#CBCMCSCLCTCCCC#',
    '#..............#',
    '#..............#',
    'C..............P',
    'F....CKKKCC....P',
    'C....CCFFCC....P',
    'Y..............P',
    '#..............#',
    '#..............#',
    '#X..UAEOCCCWWDC#',
  ],
  // sushi: police na levé stěně, prostřední ostrov, rýžovary u horní zdi
  sushi: [
    '#CCCFCCFCCCCCCC#',
    'R..............#',
    'H..............#',
    'N...KKKK.......P',
    'G...CCCC.......P',
    'Q..............P',
    'Y..............P',
    '#..............#',
    '#..............#',
    '#X..WWCCUAEOCDC#',
  ],
  // pizza: police na spodní zdi, dva ostrůvky s prkénky, pece u pultu s pitím
  pizza: [
    '#CCUAEOCCFFCCWC#',
    '#..............#',
    '#..............#',
    'C..KK...KK.....P',
    'Y..CC...CC.....P',
    'C..............P',
    'C..............P',
    '#..............#',
    '#..............#',
    '#X..JCVCSCICZWD#',
  ],
};
const RACK_LETTERS = { burger: 'bmslt', sushi: 'rhngq', pizza: 'jvsiz' };
const warehouseRows = (letters) => [
  '##..############',
  '#..............#',
  '#..............#',
  '#.....====.....#',
  '#.....====.....#',
  '#..............#',
  '#' + letters + 'C' + 'ceo' + 'CCCCC' + '#',
];
const MAP = KITCHENS.burger.concat(warehouseRows(RACK_LETTERS.burger));
const H = MAP.length;
const W = MAP[0].length;
MAP.forEach((row, i) => {
  if (row.length !== W) throw new Error('Řádek mapy ' + i + ' má špatnou délku');
});

// Bedny se surovinami (každá restaurace má svoje; písmena se nepřekrývají)
const CRATES = {
  B: 'bun', M: 'meat', S: 'cheese', L: 'lettuce', T: 'tomato',          // burger
  R: 'rice', H: 'fish', N: 'nori', G: 'cucumber', Q: 'shrimp',          // sushi
  J: 'dough', V: 'sauce', I: 'pepperoni', Z: 'mushroom',                // pizza (+ S sýr)
};
const RACKS = {
  b: 'bun', m: 'meat', s: 'cheese', l: 'lettuce', t: 'tomato', r: 'rice', h: 'fish', n: 'nori', g: 'cucumber', q: 'shrimp',
  j: 'dough', v: 'sauce', i: 'pepperoni', z: 'mushroom', c: 'cola', e: 'lemon', o: 'juice',
};
const TAPS = { A: 'cola', E: 'lemon', O: 'juice' };
const DRINK_IDS = ['cola', 'lemon', 'juice'];
const DRINK_NAME = { cola: 'Cola', lemon: 'Limonáda', juice: 'Džus' };
const FLAMMABLE = new Set('CKFDUAEOBMSLTRHNGQJVIZ'.split(''));   // co může hořet

// Suroviny: chop = jde krájet (raw → chopped), cook = z jakého stavu se peče/vaří, need = stav pro talíř
const ING = {
  bun: { need: 'raw' },
  meat: { chop: true, cook: 'chopped', need: 'cooked' },
  cheese: { need: 'raw' },
  lettuce: { chop: true, need: 'chopped' },
  tomato: { chop: true, need: 'chopped' },
  rice: { cook: 'raw', need: 'cooked' },
  fish: { chop: true, need: 'chopped' },
  nori: { need: 'raw' },
  cucumber: { chop: true, need: 'chopped' },
  shrimp: { cook: 'raw', need: 'cooked' },
  dough: { chop: true, cook: 'chopped', need: 'cooked' },
  sauce: { need: 'raw' },
  pepperoni: { chop: true, need: 'chopped' },
  mushroom: { chop: true, need: 'chopped' },
};
const NEED = {}, CHOPPABLE = {}, COOK_FROM = {};
for (const k in ING) {
  NEED[k] = ING[k].need;
  if (ING[k].chop) CHOPPABLE[k] = true;
  if (ING[k].cook) COOK_FROM[k] = ING[k].cook;
}

// Restaurace: mapa se liší jen horní řadou beden
const REST = {
  burger: {
    id: 'burger', name: 'Burger bar', icon: '🍔', cost: 0, pay: 1, stove: 'Sporák',
    starter: { bun: 5, meat: 5, cheese: 3, lettuce: 3, tomato: 3 },
    recipes: [
      { id: 'cheese', name: 'Cheeseburger', items: ['bun', 'meat', 'cheese'], w: 3 },
      { id: 'salad', name: 'Salátový burger', items: ['bun', 'meat', 'lettuce', 'tomato'], w: 3 },
      { id: 'plain', name: 'Hamburger', items: ['bun', 'meat'], w: 2 },
      { id: 'bowl', name: 'Zeleninový salát', items: ['lettuce', 'tomato'], w: 1 },
    ],
  },
  sushi: {
    id: 'sushi', name: 'Sushi bar', icon: '🍣', cost: 250, pay: 1.2, stove: 'Rýžovar',
    starter: { rice: 6, fish: 4, nori: 5, cucumber: 3, shrimp: 3 },
    recipes: [
      { id: 'nigiri', name: 'Nigiri s rybou', items: ['rice', 'fish'], w: 3 },
      { id: 'maki', name: 'Maki s okurkou', items: ['rice', 'nori', 'cucumber'], w: 3 },
      { id: 'sakemaki', name: 'Rybí maki', items: ['rice', 'nori', 'fish'], w: 3 },
      { id: 'ebi', name: 'Ebi maki', items: ['rice', 'nori', 'shrimp'], w: 2 },
      { id: 'dragon', name: 'Dragon roll', items: ['rice', 'nori', 'fish', 'shrimp'], w: 1 },
    ],
  },
  pizza: {
    id: 'pizza', name: 'Pizzerie', icon: '🍕', cost: 180, pay: 1.1, stove: 'Pec',
    starter: { dough: 5, sauce: 5, cheese: 4, pepperoni: 3, mushroom: 3 },
    recipes: [
      { id: 'margherita', name: 'Margherita', items: ['dough', 'sauce', 'cheese'], w: 3 },
      { id: 'pepperoni', name: 'Pizza Salám', items: ['dough', 'sauce', 'cheese', 'pepperoni'], w: 3 },
      { id: 'funghi', name: 'Pizza Funghi', items: ['dough', 'sauce', 'cheese', 'mushroom'], w: 3 },
      { id: 'bianca', name: 'Pizza Bianca', items: ['dough', 'cheese', 'mushroom'], w: 2 },
    ],
  },
};
const REST_IDS = Object.keys(REST);
const RECIPES_ALL = [].concat(...REST_IDS.map((id) => REST[id].recipes));
const RECIPES_PUBLIC = {};
RECIPES_ALL.forEach((r) => { RECIPES_PUBLIC[r.id] = { name: r.name, items: r.items }; });
const MAPS = {};
REST_IDS.forEach((id) => { MAPS[id] = KITCHENS[id].concat(warehouseRows(RACK_LETTERS[id])); });
const restPublic = (id) => ({
  id, name: REST[id].name, icon: REST[id].icon, stove: REST[id].stove,
  crates: Object.fromEntries([...MAPS[id].join('')].filter((c) => CRATES[c]).map((c) => [c, CRATES[c]])),
  racks: Object.fromEntries([...MAPS[id].join('')].filter((c) => RACKS[c]).map((c) => [c, RACKS[c]])),
});
const recipesPublicOf = (id) => Object.fromEntries(REST[id].recipes.map((r) => [r.id, { name: r.name, items: r.items }]));

// Vzhled postavy (indexy do palet, které zná i klient)
const LOOK_MAX = { h: 8, s: 4, t: 3, c: 8 };
const HAT_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#ecf0f1', '#34495e'];
function cleanLook(l, slot) {
  const out = { h: slot % 4, s: 0, t: 0, c: 0 };
  if (l && typeof l === 'object') {
    for (const k of ['h', 's', 't', 'c']) {
      const v = Math.floor(Number(l[k]));
      if (v >= 0 && v < LOOK_MAX[k]) out[k] = v;
    }
  }
  return out;
}

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
// Trvalá vylepšení (kupují se mezi dny). cat = záložka v obchodě, minDay = od kterého dne se dají koupit.
const UPGRADES = {
  // 🍳 Kuchyň
  knife:    { cat: 'kitchen', minDay: 1, name: 'Ostrý nůž', icon: '🔪', desc: 'Krájení o 25 % rychlejší za úroveň', cost: [60, 110, 180, 280, 420] },
  oven:     { cat: 'kitchen', minDay: 2, name: 'Silnější plotna', icon: '🔥', desc: 'Pečení a vaření o 15 % rychlejší', cost: [70, 130, 220, 350] },
  pan:      { cat: 'kitchen', minDay: 1, name: 'Nepřilnavá pánev', icon: '🍳', desc: 'Jídlo se pálí o 30 % pomaleji', cost: [50, 90, 150, 240] },
  pour:     { cat: 'kitchen', minDay: 2, name: 'Rychlé kohoutky', icon: '🥤', desc: 'Nalévání pití o 25 % rychlejší', cost: [50, 100, 180] },
  dish:     { cat: 'kitchen', minDay: 2, name: 'Rychlá myčka', icon: '🧼', desc: 'Mytí nádobí o 30 % rychlejší', cost: [60, 110, 190] },
  plates:   { cat: 'kitchen', minDay: 1, name: 'Sada talířů', icon: '🍽', desc: '+2 čisté talíře na začátku dne', cost: [40, 70, 110, 170] },
  // 👟 Obsluha
  boots:    { cat: 'staff', minDay: 1, name: 'Sportovní boty', icon: '👟', desc: 'Rychlejší chůze (+6 % za úroveň)', cost: [60, 100, 170, 260, 400] },
  cart:     { cat: 'staff', minDay: 2, name: 'Vozík na krabice', icon: '🛒', desc: 'S krabicí se zpomaluješ míň', cost: [60, 110, 190] },
  tips:     { cat: 'staff', minDay: 2, name: 'Sklenice na spropitné', icon: '💰', desc: '+2 Kč spropitné ke každé vydané části', cost: [70, 130, 220, 350] },
  // 📦 Sklad
  shelf:    { cat: 'storage', minDay: 2, name: 'Větší police', icon: '🗄', desc: '+3 ks na každé polici a kohoutku', cost: [60, 110, 190, 300] },
  bigbox:   { cat: 'storage', minDay: 3, name: 'Velké krabice', icon: '📦', desc: '+2 ks v každé krabici za stejnou cenu', cost: [90, 160, 260, 400] },
  whcap:    { cat: 'storage', minDay: 2, name: 'Větší sklad', icon: '🏭', desc: '+2 krabice od každého druhu ve skladu', cost: [60, 110, 190] },
  supplier: { cat: 'storage', minDay: 3, name: 'Dohoda s dodavatelem', icon: '🤝', desc: 'Krabice o 5 % levnější', cost: [80, 140, 230, 360] },
  // 🧯 Bezpečnost
  ext:      { cat: 'safety', minDay: 1, name: 'Lepší hasicák', icon: '🧯', desc: 'Hasí rychleji a vydrží déle', cost: [50, 90, 150] },
  sprinkler:{ cat: 'safety', minDay: 4, name: 'Sprinklery', icon: '🚿', desc: 'Oheň pomalu hasne sám', cost: [120, 200, 320] },
  trap:     { cat: 'safety', minDay: 1, name: 'Pasti na krysy', icon: '🪤', desc: 'Méně krys a hlodají pomaleji', cost: [45, 80, 130, 210] },
  cat:      { cat: 'safety', minDay: 3, name: 'Kuchyňská kočka', icon: '🐈', desc: 'Občas chytí krysu za tebe', cost: [100, 170, 280] },
  insure:   { cat: 'safety', minDay: 3, name: 'Pojištění', icon: '📄', desc: 'Pokuta za propadlou objednávku −25 %', cost: [70, 120, 200] },
  // 💼 Provoz
  sign:     { cat: 'biz', minDay: 1, name: 'Neonový nápis', icon: '💡', desc: '+10 % tržeb z objednávek', cost: [80, 140, 230, 360, 540] },
  patience: { cat: 'biz', minDay: 2, name: 'Pohodlné židle', icon: '🪑', desc: 'Hosté vydrží čekat o 10 % déle', cost: [70, 120, 200, 320, 480] },
  vip:      { cat: 'biz', minDay: 4, name: 'VIP klub', icon: '⭐', desc: 'Častěji přijdou VIP hosté (dvojnásobná platba)', cost: [90, 160, 270] },
  hours:    { cat: 'biz', minDay: 3, name: 'Delší otevírací doba', icon: '🕒', desc: 'Den trvá o 10 s déle', cost: [100, 180, 300, 480] },
  ads:      { cat: 'biz', minDay: 5, name: 'Reklama', icon: '📣', desc: 'Zákazníci chodí o 10 % častěji', cost: [110, 200, 340] },
};
// Zákazníci: typ ovlivňuje trpělivost, platbu a reputaci
const CUSTOMER_TYPES = {
  normal: { w: 62, time: 1, pay: 1, tip: 0 },
  picky: { w: 14, time: 1, pay: 1.25, tip: 0 },            // nechce jednu surovinu („bez sýra“)
  impatient: { w: 10, time: 0.6, pay: 1.4, tip: 0 },       // spěchá
  regular: { w: 8, time: 1.35, pay: 1, tip: 3 },           // štamgast: trpělivý, dává spropitné
  critic: { w: 6, time: 1, pay: 2, tip: 0, minDay: 3 },    // kritik: vždy menu, platí dvojnásobek, hodně ovlivní reputaci
};
// Pomocníci (jen Dny): najímají se v obchodě, platí se jim denní plat
const HELPERS = {
  dish: { name: 'Myč nádobí', icon: '🧽', desc: 'Sám myje špinavé talíře', hire: 80, wage: 10, train: [90, 150], minDay: 2 },
  cook: { name: 'Pomocný kuchař', icon: '🔪', desc: 'Sám krájí suroviny na prkénkách', hire: 120, wage: 15, train: [130, 200], minDay: 2 },
  stock: { name: 'Skladník', icon: '📦', desc: 'Sám doplňuje police a kohoutky z krabic', hire: 100, wage: 12, train: [110, 180], minDay: 3 },
};
const wageOf = (id, lvl) => (lvl > 0 ? Math.round(HELPERS[id].wage * (1 + 0.5 * (lvl - 1))) : 0);
const totalWages = (room) => Object.keys(HELPERS).reduce((a, id) => a + wageOf(id, (room.helpers && room.helpers[id]) || 0), 0);

const boxSizeOf = (room) => BOX_SIZE + 2 * ((room.upgrades && room.upgrades.bigbox) || 0);
const boxCapOf = (room) => BOX_CAP + 2 * ((room.upgrades && room.upgrades.whcap) || 0);
const shelfCapOf = (room) => SHELF_CAP + 3 * ((room.upgrades && room.upgrades.shelf) || 0);
const boxDiscountOf = (room) => Math.max(0.5, BOX_DISCOUNT - 0.05 * ((room.upgrades && room.upgrades.supplier) || 0));

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

let curMap = MAP;           // mapa místnosti, která se právě zpracovává (kolize)
const tileAt = (x, y) => (y < 0 || y >= H || x < 0 || x >= W ? '#' : curMap[y][x]);
const tileAtR = (room, x, y) => (y < 0 || y >= H || x < 0 || x >= W ? '#' : room.map[y][x]);
const isSolid = (x, y) => tileAt(x, y) !== '.';
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;

const newIngredient = (k) => ({ t: 'i', k, s: 'raw' });
const newPlate = () => ({ t: 'p', c: [] });
const isPlate = (it) => !!it && it.t === 'p';
const isIng = (it) => !!it && it.t === 'i';
const plateReady = (it) => isIng(it) && it.s === NEED[it.k];
const isCup = (it) => !!it && it.t === 'c';
const isExt = (it) => !!it && it.t === 'x';
const isBox = (it) => !!it && it.t === 'b';
const newBox = (room, k) => ({ t: 'b', k, n: boxSizeOf(room) });
const boxPrice = (room, k) => Math.max(1, Math.round(room.prices[k] * BOX_SIZE * boxDiscountOf(room)));
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
function canAdd(plate, ing) {   // recepty všech restaurací – v jedné kuchyni jsou jen suroviny té jedné
  if (!plateReady(ing) || plate.c.includes(ing.k)) return false;
  const want = plate.c.concat(ing.k);
  return RECIPES_ALL.some((r) => want.every((k) => r.items.includes(k)));
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
    rest: 'burger', nextRest: 'burger', owned: { burger: true }, map: MAPS.burger, recipes: REST.burger.recipes, pstats: {},
    mode: mode === 'days' ? 'days' : 'classic', host: null, len: GAME_TIME,
    money: 0, stock: {}, day: 1, dayStartMoney: 0, ready: new Set(), lastSummary: null,
    totalDelivered: 0, totalExpired: 0,
    rep: 3, helpers: { dish: 0, cook: 0, stock: 0 }, hk: { dish: 0, stock: 0, flash: 0, cookOn: false },
    upgrades: {}, prices: Object.assign({}, PRICES), today: null, nextGoal: null, goal: null,
    stat: { dishes: 0, drinks: 0, rats: 0, fires: 0 },
    fires: {}, flames: [], flameSeq: 0, fuel: {}, wet: {}, ag: {}, rats: [], ratSeq: 0, nextRat: 0, chaos: null, nextChaos: 0,
    st: {}, stoves: [], sinks: [], orders: [], returns: [], events: [],
    time: 0, cd: 0, score: 0, plates: 0, dirty: 0,
    delivered: 0, expired: 0, orderSeq: 0, nextOrder: 0, last: null,
  };
  rooms.set(code, room);
  return room;
}

function applyRest(room, id) {
  if (!REST[id]) id = 'burger';
  room.rest = id; room.map = MAPS[id]; room.recipes = REST[id].recipes;
}

/* ---------- Statistiky hráčů a MVP ---------- */
const MVP_W = { dishes: 10, drinks: 6, pours: 2, chops: 1, cooks: 3, washes: 1.5, rats: 6, fires: 8 };
const blankStat = () => ({ dishes: 0, drinks: 0, pours: 0, chops: 0, cooks: 0, washes: 0, rats: 0, fires: 0 });
function initPstat(room, p) {
  room.pstats[p.id] = { id: p.id, n: p.name, lk: p.look, t: blankStat(), d: blankStat() };
}
function bump(room, pid, key) {
  const ps = room.pstats[pid];
  if (!ps) return;
  ps.t[key]++; ps.d[key]++;
}
function board(room, which) {
  return Object.values(room.pstats).map((ps) => {
    const st = ps[which];
    let pts = 0;
    for (const k in MVP_W) pts += st[k] * MVP_W[k];
    return { id: ps.id, n: ps.n, lk: ps.lk, pts: Math.round(pts), st: Object.assign({}, st) };
  }).sort((a, b) => b.pts - a.pts);
}
const mvpOf = (b) => (b.length && b[0].pts > 0 ? b[0] : null);

function roomInfo(room) {
  return {
    code: room.code, state: room.state, mode: room.mode, host: room.host, min: MIN_PLAYERS, max: MAX_PLAYERS, rest: room.rest,
    players: [...room.players.values()].map((p) => ({ id: p.id, n: p.name, c: p.color, lk: p.look })),
  };
}
const broadcastRoom = (room) => io.to(room.code).emit('room', roomInfo(room));

function addPlayer(room, socket, name, look) {
  const used = new Set([...room.players.values()].map((p) => p.slot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const p = {
    id: socket.id, name, slot, color: COLORS[slot], look: null,
    x: SPAWNS[slot][0], y: SPAWNS[slot][1], fx: 0, fy: 1,
    held: null, input: { dx: 0, dy: 0, hold: false }, sfxT: 0,
    cmd: false, queue: [], qseq: 0, ack: 0, budget: 0,   // pohyb řízený příkazy z klienta (viz runCmd)
  };
  p.look = cleanLook(look, slot);
  p.color = HAT_COLORS[p.look.h];
  room.players.set(socket.id, p);
  initPstat(room, p);
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
  const startN = room.mode === 'days' ? SHELF_START_DAYS : SHELF_START_CLASSIC;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = room.map[y][x], key = x + ',' + y;
      if (ch === 'C') room.st[key] = { type: 'C', x, y, item: null };
      else if (ch === 'K') room.st[key] = { type: 'K', x, y, item: null, prog: 0 };
      else if (ch === 'F') {
        const s = { type: 'F', x, y, item: null, prog: 0, burn: 0, warned: false };
        room.st[key] = s; room.stoves.push(s);
      } else if (ch === 'W') {
        const s = { type: 'W', x, y, prog: 0 };
        room.st[key] = s; room.sinks.push(s);
      } else if (TAPS[ch]) room.st[key] = { type: 'T', x, y, drink: TAPS[ch], prog: 0, n: startN };
      else if (CRATES[ch]) room.st[key] = { type: 'S', x, y, k: CRATES[ch], n: startN };      // police v kuchyni
      else if (RACKS[ch]) room.st[key] = { type: 'R', x, y, k: RACKS[ch] };                    // regál ve skladu
      else if (ch === 'Y') room.st[key] = { type: 'Y', x, y, has: true };
    }
  }
}

// kolik kusů dané suroviny je v policích (všech kuchyní restaurace, které se hrály)
function shelfUnits(room, k) {
  let n = 0;
  const sets = [room.st].concat(Object.values(room.saved || {}).map((v) => v.st));
  const seen = new Set();
  for (const st of sets) {
    if (!st || seen.has(st)) continue;
    seen.add(st);
    for (const key in st) { const x = st[key]; if ((x.type === 'S' && x.k === k) || (x.type === 'T' && x.drink === k)) n += x.n; }
  }
  return n;
}

function startGame(room) {
  for (const ps of Object.values(room.pstats)) { ps.t = blankStat(); ps.d = blankStat(); }
  if (room.mode === 'days') {
    room.owned = { burger: true }; room.nextRest = 'burger'; applyRest(room, 'burger');
    room.day = 1; room.money = START_MONEY; room.boxes = Object.assign({}, START_BOXES); room.saved = {};
    room.totalDelivered = 0; room.totalExpired = 0; room.lastSummary = null;
    room.upgrades = {};
    room.rep = 3; room.helpers = { dish: 0, cook: 0, stock: 0 };
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
  if (room.mode === 'days') applyRest(room, room.nextRest);
  for (const ps of Object.values(room.pstats)) ps.d = blankStat();
  room.state = 'playing';
  room.len = room.mode === 'days' ? DAY_TIME + 10 * up(room, 'hours') : GAME_TIME;
  room.catT = 18;
  room.time = room.len; room.cd = COUNTDOWN;
  room.score = 0; room.delivered = 0; room.expired = 0;
  room.dayStartMoney = room.money;
  room.stat = { dishes: 0, drinks: 0, rats: 0, fires: 0 };
  room.goal = room.mode === 'days' ? room.nextGoal : null;
  room.fires = {}; room.flames = []; room.fuel = {}; room.wet = {}; room.ag = {}; room.rats = []; room.chaos = null;
  const slow = room.players.size <= 1 ? 1.3 : 1;
  room.nextRat = (modIs(room, 'vermin') ? 14 : 24) * slow * (1 + 0.4 * up(room, 'trap'));
  room.nextChaos = 32 * slow;
  room.ready.clear();
  room.orders = []; room.orderSeq = 0; room.nextOrder = 1;
  room.returns = []; room.events = [];
  curMap = room.map;
  const sv = room.mode === 'days' ? room.saved[room.rest] : null;
  if (sv) {                                    // Dny: kuchyně si pamatuje, co v ní zbylo
    room.st = sv.st; room.stoves = []; room.sinks = [];
    for (const key in room.st) {
      const o = room.st[key];
      if (o.type === 'F') { room.stoves.push(o); o.warned = false; o.smolder = 0; }
      if (o.type === 'W') room.sinks.push(o);
    }
    room.plates = Math.max(sv.plates, START_PLATES + 2 * up(room, 'plates'));
    room.dirty = sv.dirty;
  } else {
    room.plates = START_PLATES + 2 * up(room, 'plates'); room.dirty = 0;
    buildStations(room);
  }
  for (const p of room.players.values()) {
    p.x = SPAWNS[p.slot][0]; p.y = SPAWNS[p.slot][1];
    p.fx = 0; p.fy = 1; p.held = null;
    p.input = { dx: 0, dy: 0, hold: false }; p.sfxT = 0;
    p.queue = []; p.qseq = 0; p.ack = 0; p.budget = 0;
  }
  room.gn = (room.gn || 0) + 1;        // číslo hry/dne: příkazy ze starého kola se ignorují
  io.to(room.code).emit('gameStart', { gn: room.gn, map: room.map, recipes: recipesPublicOf(room.rest), rest: restPublic(room.rest), time: room.len, cd: COUNTDOWN, mode: room.mode, day: room.day,
    up: room.upgrades, today: room.today ? { id: room.today.id, n: room.today.n } : null, goal: room.goal });
  broadcastRoom(room);
}

/* ---------- Režim „Dny“: obchod mezi dny ---------- */
function shopPayload(room) {
  return {
    day: room.day, money: room.money, boxes: room.boxes, boxPrice: Object.fromEntries(Object.keys(room.prices).map((k) => [k, boxPrice(room, k)])), boxSize: boxSizeOf(room), boxCap: boxCapOf(room), shelfCap: shelfCapOf(room),
    baseBox: Object.fromEntries(Object.keys(PRICES).map((k) => [k, Math.max(1, Math.round(PRICES[k] * BOX_SIZE * boxDiscountOf(room)))])),
    shelves: Object.fromEntries(Object.keys(room.prices).map((k) => [k, shelfUnits(room, k)])), prices: room.prices, base: PRICES,
    rent: rentFor(room.day), summary: room.lastSummary,
    ready: [...room.ready], players: room.players.size,
    rep: r1(room.rep), wages: totalWages(room),
    staff: Object.keys(HELPERS).map((id) => {
      const H0 = HELPERS[id], lvl = room.helpers[id] || 0;
      return { id, name: H0.name, icon: H0.icon, desc: H0.desc, lvl, hire: H0.hire, wage: wageOf(id, lvl || 1), minDay: H0.minDay, locked: room.day < H0.minDay, train: lvl > 0 && lvl < 3 ? H0.train[lvl - 1] : null };
    }),
    rests: REST_IDS.map((id) => ({ id, name: REST[id].name, icon: REST[id].icon, cost: REST[id].cost, owned: !!room.owned[id], sel: room.nextRest === id, pay: REST[id].pay, recipes: REST[id].recipes.map((r) => r.name) })),
    ings: Object.values(restPublic(room.nextRest).crates),
    today: room.today ? { id: room.today.id, n: room.today.n, d: room.today.d } : null,
    goal: room.nextGoal ? { text: room.nextGoal.text, reward: room.nextGoal.reward } : null,
    up: Object.keys(UPGRADES).map((id) => {
      const u = UPGRADES[id], lvl = up(room, id);
      return { id, cat: u.cat, minDay: u.minDay, locked: room.day < u.minDay, name: u.name, icon: u.icon, desc: u.desc, lvl, max: u.cost.length, next: lvl < u.cost.length ? u.cost[lvl] : null };
    }),
  };
}
/* ---------- Uložení a pokračování (Dny) ----------
 * Kód uložení je podepsaný (HMAC), takže ho nejde snadno upravit. Podpis klíčuje proměnná SAVE_SECRET. */
const SAVE_SECRET = process.env.SAVE_SECRET || 'threedvareni-save-key';
const MAP_HASH = crypto.createHash('sha1').update(JSON.stringify(MAPS)).digest('hex').slice(0, 8);
const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (t) => Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const signSave = (t) => b64u(crypto.createHmac('sha256', SAVE_SECRET).update(t).digest()).slice(0, 22);

function makeSave(room) {
  const data = {
    v: 1, mv: MAP_HASH, day: room.day, money: room.money, boxes: room.boxes, upgrades: room.upgrades, owned: room.owned,
    nextRest: room.nextRest, rep: room.rep, helpers: room.helpers, td: room.totalDelivered, te: room.totalExpired, saved: room.saved || {},
  };
  const body = b64u(zlib.deflateSync(Buffer.from(JSON.stringify(data))));
  return body + '.' + signSave(body);
}
function readSave(code) {
  if (typeof code !== 'string' || code.length > 120000) return null;
  const parts = code.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expect = signSave(parts[0]);
  if (expect.length !== parts[1].length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(parts[1]))) return null;
  try {
    const data = JSON.parse(zlib.inflateSync(fromB64u(parts[0])).toString('utf8'));
    return data && data.v === 1 ? data : null;
  } catch (e) { return null; }
}
const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

// naplní místnost uloženou hrou; po načtení se hráči ocitnou v obchodě
function restoreRoom(room, d) {
  room.mode = 'days';
  room.day = clampInt(d.day, 1, 999);
  room.money = clampInt(d.money, 0, 1e7);
  room.boxes = {};
  for (const k in PRICES) room.boxes[k] = clampInt(d.boxes && d.boxes[k], 0, 40);
  room.upgrades = {};
  for (const id in UPGRADES) { const l = clampInt(d.upgrades && d.upgrades[id], 0, UPGRADES[id].cost.length); if (l) room.upgrades[id] = l; }
  room.owned = { burger: true };
  for (const id of REST_IDS) if (d.owned && d.owned[id]) room.owned[id] = true;
  room.nextRest = room.owned[d.nextRest] ? d.nextRest : 'burger';
  applyRest(room, room.nextRest);
  room.rep = Math.max(0, Math.min(5, Number(d.rep) || 3));
  room.helpers = { dish: 0, cook: 0, stock: 0 };
  for (const id in HELPERS) room.helpers[id] = clampInt(d.helpers && d.helpers[id], 0, 3);
  room.totalDelivered = clampInt(d.td, 0, 1e6); room.totalExpired = clampInt(d.te, 0, 1e6);
  room.saved = {};
  if (d.mv === MAP_HASH && d.saved && typeof d.saved === 'object') {
    for (const id of REST_IDS) {
      const sv = d.saved[id];
      if (sv && sv.st && typeof sv.st === 'object') room.saved[id] = { st: sv.st, plates: clampInt(sv.plates, 0, 99), dirty: clampInt(sv.dirty, 0, 99) };
    }
  }
  room.lastSummary = null;
  room.state = 'shop';
  room.ready.clear();
  planDay(room);
}

const saveInfo = (room) => ({ code: makeSave(room), day: room.day, money: room.money, rest: room.nextRest });
const broadcastShop = (room) => {
  io.to(room.code).emit('shop', shopPayload(room));
  io.to(room.code).emit('save', saveInfo(room));           // klienti si aktuální uložení pamatují
};

function checkReady(room) {
  if (room.state !== 'shop' || room.players.size === 0) return;
  for (const id of room.players.keys()) if (!room.ready.has(id)) return;
  beginRound(room);
}

// jde z toho, co zbylo (a za co se dá koupit), uvařit aspoň jedno jídlo?
function canProduce(room) {
  return REST_IDS.filter((id) => room.owned[id]).some((id) => REST[id].recipes.some((r) => r.items.reduce((c, k) => c + (((room.boxes[k] || 0) > 0 || shelfUnits(room, k) > 0) ? 0 : boxPrice(room, k)), 0) <= room.money));
}

function endDay(room) {
  const net = room.money - room.dayStartMoney;
  const rent = rentFor(room.day);
  room.totalDelivered += room.delivered; room.totalExpired += room.expired;
  const g = room.goal;
  const gOk = goalOk(room, g);
  const bonus = gOk ? g.reward : 0;
  const wages = totalWages(room);
  room.money += bonus - rent - wages;
  // úklid po zavírací době: hasicák do držáku, plné krabice do skladu, talíř na stoh
  for (const p of room.players.values()) {
    const h = p.held;
    if (isExt(h)) restoreExt(room);
    else if (isPlate(h)) room.plates++;
    else if (isBox(h) && h.n >= boxSizeOf(room)) room.boxes[h.k] = Math.min(boxCapOf(room), (room.boxes[h.k] || 0) + 1);
    p.held = null; p.input = { dx: 0, dy: 0, hold: false };
  }
  // oheň zhasne, krysy odejdou, spálené jídlo se uklidí; věci na pultech a v polici zůstanou na další den
  for (const a of Object.values(room.ag)) {                       // rozpracovaná krabice se vrátí do skladu
    if (a.job && a.job.k && (a.st === 'toRack' || a.st === 'toShelf')) room.boxes[a.job.k] = Math.min(boxCapOf(room), (room.boxes[a.job.k] || 0) + 1);
  }
  room.fires = {}; room.flames = []; room.fuel = {}; room.wet = {}; room.ag = {}; room.rats = []; room.chaos = null;
  for (const key in room.st) {
    const o = room.st[key];
    delete o.claimed;
    if (o.type === 'F' && o.item && o.item.s === 'burnt') { o.item = null; resetStation(o); }
  }
  room.dirty += room.returns.length; room.returns = [];
  room.saved[room.rest] = { st: room.st, plates: room.plates, dirty: room.dirty };
  ev(room, 'end', 0, 0);
  io.to(room.code).emit('state', snapshot(room));
  room.lastSummary = {
    day: room.day, net, rent, wages, rep: r1(room.rep), delivered: room.delivered, expired: room.expired,
    goal: g ? { text: g.text, ok: gOk, reward: g.reward } : null,
    stat: Object.assign({}, room.stat), mod: room.today ? room.today.n : null, rest: REST[room.rest].name,
    mvp: mvpOf(board(room, 'd')),
  };

  let bust = null, daysDone = room.day;
  if (room.money < 0) { bust = 'Nezbyly peníze na nájem a platy (' + (rent + wages) + ' Kč).'; daysDone = room.day - 1; }
  else if (room.rep < 0.3) { bust = 'Restaurace přišla o dobré jméno.'; }
  else if (!canProduce(room)) { bust = 'Došly zásoby a není za co nakoupit.'; }

  if (bust) {
    room.state = 'ended';
    room.last = {
      mode: 'days', days: daysDone, money: Math.max(0, room.money), reason: bust,
      delivered: room.totalDelivered, expired: room.totalExpired,
      stars: daysDone >= 7 ? 3 : daysDone >= 4 ? 2 : daysDone >= 2 ? 1 : 0,
      board: board(room, 't'), mvp: mvpOf(board(room, 't')),
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
    mode: 'classic', score: s, delivered: room.delivered, expired: room.expired, rest: REST[room.rest].name,
    board: board(room, 't'), mvp: mvpOf(board(room, 't')),
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
  if (ch === 'F') return isIng(item) && COOK_FROM[item.k] === item.s;
  return false;
}

function resetStation(st) {
  st.prog = 0; st.burn = 0; st.warned = false; st.smolder = 0;
}

function checkChop(room, st, p) {
  if (st.prog >= 1) {
    if (p) bump(room, p.id, 'chops');
    st.item.s = 'chopped';
    st.prog = 0;
    ev(room, 'done', st.x + 0.5, st.y + 0.5);
  }
}

function checkWash(room, st, p) {
  if (st.prog >= 1) {
    if (p) bump(room, p.id, 'washes');
    st.prog = 0;
    room.dirty--; room.plates++;
    ev(room, 'done', st.x + 0.5, st.y + 0.5);
  }
}

function interactStorage(room, p, st, ch, fx, fy) {
  const held = p.held, item = st.item;
  if (held && !item) {
    if (!canPlaceOn(ch, held)) return ev(room, 'no', fx, fy);
    if (isBox(held)) held.r = r2(Math.atan2(-p.fx, -p.fy));       // štítek krabice se otočí ke hráči, který ji položil
    st.item = held; p.held = null; resetStation(st); st.by = p.id;
    return ev(room, 'drop', fx, fy);
  }
  if (!held && item) {
    // syrová surovina na prkénku se krájí (mačkání / držení), nezvedá se
    if (ch === 'K' && isIng(item) && CHOPPABLE[item.k] && item.s === 'raw') {
      st.prog += CHOP_BUMP * (1 + 0.25 * up(room, 'knife'));
      ev(room, 'chop', fx, fy);
      return checkChop(room, st, p);
    }
    if (isBox(item)) delete item.r;
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
    const items = o.it || RECIPES_PUBLIC[o.r].items;
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
  let v = base * REST[room.rest].pay;
  if (o && o.pm) v *= o.pm;
  if (o && o.tip) v += o.tip;
  if (o && o.vip) v *= 2;
  if (drink && thirstOn(room)) v *= 2;
  if (room.mode === 'days') {
    v *= 1 + 0.1 * up(room, 'sign');
    v += 2 * up(room, 'tips');
    if (modIs(room, 'rush')) v *= 1.25;
  }
  v = Math.round(v);
  if (room.mode === 'days') room.money += v; else room.score += v;
  return v;
}
function reward(room, v) { if (room.mode === 'days') room.money += v; else room.score += v; }

// reputace (jen Dny): spokojení hosté ji zvedají, propadlé objednávky snižují
function repAdd(room, d, ty) {
  if (room.mode !== 'days') return;
  room.rep = Math.max(0, Math.min(5, room.rep + d));
  if (Math.abs(d) >= 0.3) ev(room, 'rep', 15.5, 4.5, { d: r2(d), ty });
}

function completeOrder(room, o) {
  if ((o.r && !o.fd) || (o.dr && !o.dd)) return 0;
  const i = room.orders.indexOf(o);
  if (i >= 0) room.orders.splice(i, 1);
  const frac = Math.max(0, o.t / o.l);
  let g = frac > 0.5 ? 0.12 : 0.06;
  if (o.ty === 'critic') g = frac > 0.3 ? 0.6 : 0.3;
  else if (o.ty === 'regular') g += 0.1;
  else if (o.ty === 'picky') g += 0.05;
  repAdd(room, g, o.ty);
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
// přesune kusy z krabice do police / kohoutku (max. kapacita police)
function refillFromBox(room, p, st, fx, fy) {
  const box = p.held;
  const cap = shelfCapOf(room);
  const space = cap - st.n;
  if (space <= 0) return ev(room, 'no', fx, fy, { m: 'Police je plná (max ' + cap + ')' });
  const moved = Math.min(space, box.n);
  st.n += moved; box.n -= moved;
  if (box.n <= 0) p.held = null;
  return ev(room, 'drop', fx, fy, { m: '+' + moved });
}
function checkFill(room, p, st, fx, fy) {
  if (st.prog < 1) return;
  st.prog = 0;
  st.n = Math.max(0, st.n - 1);
  p.held.d = st.drink;
  bump(room, p.id, 'pours');
  ev(room, 'done', fx, fy);
}
function fillBlocked(room, p, st, fx, fy) {
  if (st.n <= 0) {
    if (p.sfxT <= 0) { ev(room, 'no', fx, fy, { m: 'Došlo ' + ING_CS[st.drink] + '! Doplň ze skladu' }); p.sfxT = 1; }
    return true;
  }
  return false;
}

/* ---------- Oheň a hasicák ----------
 * Plameny jsou volné body v prostoru (ne dlaždice): rostou, spotřebovávají palivo pultu, na kterém hoří,
 * a šíří se do okolí podle své síly – na hořlavé pulty i jako krátké plameny po podlaze.
 * room.fires je odvozená mapa „které políčko hoří“ (pro blokování pultu, krysy, objednávky...). */
function rebuildFires(room) {
  room.fires = {};
  for (const f of room.flames) {
    if (!f.key || f.h <= 0.12) continue;
    const t = room.fires[f.key] || (room.fires[f.key] = { x: f.tx, y: f.ty, hp: 0 });
    t.hp = Math.max(t.hp, f.h);
  }
}

function addFlame(room, x, z, h, floor) {
  const tx = Math.floor(x), ty = Math.floor(z);
  room.flames.push({ id: ++room.flameSeq, x, z, h, tx, ty, floor: !!floor, key: floor ? null : tx + ',' + ty, sp: 1.6 + Math.random() * 1.8 });
}

// zapálí bod ve světových souřadnicích; vrací true, pokud tam vznikl nový plamen
function igniteWorld(room, x, z, h) {
  const tx = Math.floor(x), ty = Math.floor(z);
  const ch = tileAtR(room, tx, ty);
  if (!FLAMMABLE.has(ch)) return false;
  const key = tx + ',' + ty;
  if ((room.fuel[key] === undefined ? 1 : room.fuel[key]) <= 0 || (room.wet[key] || 0) > 0) return false;
  if (room.flames.some((o) => !o.floor && Math.hypot(o.x - x, o.z - z) < 0.4)) return false;
  if (room.flames.length >= FLAME_CAP) return false;
  const first = !room.fires[key];
  addFlame(room, x, z, h, false);
  if (first) {
    const st = room.st[key];
    if (st) {
      destroyItem(room, st);
      if (st.type === 'T') st.prog = 0;
      if (st.type === 'S' || st.type === 'T') st.n = Math.floor(st.n / 2);      // část zásob shoří
    }
    room.fires[key] = { x: tx, y: ty, hp: h };
    ev(room, 'fire', tx + 0.5, ty + 0.5, { m: 'Hoří!' });
  }
  return true;
}
// zapálí políčko (sporák, jiskra…) – plamen vznikne poblíž jeho středu
function igniteAt(room, x, y) {
  return igniteWorld(room, x + 0.3 + Math.random() * 0.4, y + 0.3 + Math.random() * 0.4, 0.4);
}

function updateFires(room, dt) {
  const sp = up(room, 'sprinkler');
  for (const k in room.wet) { room.wet[k] -= dt; if (room.wet[k] <= 0) delete room.wet[k]; }
  const fl = room.flames;
  for (let i = fl.length - 1; i >= 0; i--) {
    const f = fl[i];
    if (sp) f.h -= dt * 0.07 * sp;                                  // sprinklery pomalu hasí
    if (f.floor) f.h -= dt * 0.22;                                  // plamen na podlaze nemá palivo
    else {
      f.h = Math.min(1, f.h + dt * 0.1);
      const fu = (room.fuel[f.key] === undefined ? 1 : room.fuel[f.key]) - dt * 0.026 * f.h;
      room.fuel[f.key] = fu;
      if (fu <= 0) f.h = 0;                                         // pult dohořel
    }
    if (f.h <= 0) { fl.splice(i, 1); continue; }
    f.sp -= dt * (0.25 + 0.75 * f.h);
    if (f.sp <= 0) {
      f.sp = 2.2 + Math.random() * 1.8;
      const ang = Math.random() * Math.PI * 2, d = 0.45 + Math.random() * (0.4 + 0.9 * f.h);
      const nx = f.x + Math.cos(ang) * d, nz = f.z + Math.sin(ang) * d;
      if (!igniteWorld(room, nx, nz, 0.3) && f.h > 0.5 && Math.random() < 0.3 && fl.length < FLAME_CAP && tileAtR(room, Math.floor(nx), Math.floor(nz)) === '.') addFlame(room, nx, nz, 0.35, true);
    }
  }
  rebuildFires(room);
  // hráč u plamenů si spálí ruce a upustí věc (hasicák je v bezpečí)
  for (const p of room.players.values()) {
    p.burnT = (p.burnT || 0) - dt;
    if (p.sprayT > 0) p.sprayT -= dt;
    if (p.burnT > 0 || !p.held || isExt(p.held)) continue;
    for (const f of fl) {
      if (f.h < 0.3 || Math.hypot(p.x - f.x, p.y - f.z) > 0.28 + 0.3 * f.h) continue;
      if (isPlate(p.held)) room.returns.push(DIRTY_DELAY);
      p.held = null; p.burnT = 2.5;
      ev(room, 'no', p.x, p.y, { m: 'Au, horko! Upustil jsi věc' });
      break;
    }
  }
}

// stříkání hasicákem: kužel před hráčem, míření podle pohledu (ne podle políčka)
function sprayCone(room, p, dt) {
  const held = p.held;
  if (held.c <= 0) {
    if (p.sfxT <= 0) { ev(room, 'no', p.x, p.y, { m: 'Hasicák je prázdný!' }); p.sfxT = 1; }
    return;
  }
  const lv = up(room, 'ext');
  held.c = Math.max(0, held.c - EXT_DRAIN * dt * (1 - 0.2 * lv));
  p.sprayT = 0.25;
  if (p.sfxT <= 0) { ev(room, 'spray', p.x + p.fx, p.y + p.fy); p.sfxT = 0.25; }
  const before = [...new Set(room.flames.filter((f) => f.key).map((f) => f.key))];
  const power = dt * 1.8 * (1 + 0.35 * lv);
  const fl = room.flames;
  for (let i = fl.length - 1; i >= 0; i--) {
    const f = fl[i];
    const dx = f.x - p.x, dz = f.z - p.y, d = Math.hypot(dx, dz);
    if (d > SPRAY_RANGE || d < 0.05) continue;
    if ((dx * p.fx + dz * p.fy) / d < SPRAY_COS) continue;
    f.h -= power * (1 - 0.55 * d / SPRAY_RANGE);
    if (f.key) room.wet[f.key] = 6;                                  // zalitý pult se hned znovu nevznítí
    if (f.h <= 0) fl.splice(i, 1);
  }
  rebuildFires(room);
  for (const key of before) {
    if (room.flames.some((f) => f.key === key)) continue;
    const [kx, ky] = key.split(',').map(Number);
    room.stat.fires++; bump(room, p.id, 'fires');
    ev(room, 'extinguish', kx + 0.5, ky + 0.5, { m: 'Uhašeno!' });
  }
}

/* ---------- Krysy ---------- */
const FLOOR_EDGE = {};
REST_IDS.forEach((id) => {
  FLOOR_EDGE[id] = [];
  for (let y = 1; y <= 8; y++) for (let x = 1; x < W - 1; x++) if (MAPS[id][y][x] === '.' && (x === 1 || x === W - 2 || y === 1 || y === 8)) FLOOR_EDGE[id].push([x, y]);
});

function spawnRat(room) {
  const [tx, ty] = pick(FLOOR_EDGE[room.rest]);
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
    if (y > 9) break;
    const ch = room.map[y][x];
    if (room.fires[x + ',' + y]) continue;
    if (ch === 'D' && room.plates > 0) cands.push({ kind: 'plates', gx: x, gy: y });
    else if (CRATES[ch] && room.st[x + ',' + y] && room.st[x + ',' + y].n > 0) cands.push({ kind: 'crate', gx: x, gy: y });
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
  return !!(room.st[key] && room.st[key].n > 0);
}

function updateRats(room, dt) {
  if (room.cd > 0) return;
  const cat = up(room, 'cat');
  if (cat && room.rats.length) {                                  // kočka čas od času chytí krysu
    room.catT -= dt;
    if (room.catT <= 0) {
      const r = room.rats.splice(Math.floor(Math.random() * room.rats.length), 1)[0];
      ev(room, 'splat', r.x, r.y, { v: 0, cat: true });
      room.catT = 26 / cat;
    }
  }
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
        else { room.st[key].n = Math.max(0, room.st[key].n - 2); m = 'Krysa žere zásoby!'; }
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
  curMap = room.map;
  const [tx, ty] = targetOf(p);
  const ch = tileAtR(room, tx, ty);
  const st = room.st[tx + ',' + ty];
  const held = p.held;
  const fx = tx + 0.5, fy = ty + 0.5;
  const key = tx + ',' + ty;

  // krysa před nosem? – plácnutí
  const kx = p.x + p.fx * 0.75, ky = p.y + p.fy * 0.75;
  const ri = room.rats.findIndex((r) => Math.hypot(r.x - kx, r.y - ky) < 0.8);
  if (ri >= 0) {
    const r = room.rats.splice(ri, 1)[0];
    reward(room, 5); room.stat.rats++; bump(room, p.id, 'rats');
    return ev(room, 'splat', r.x, r.y, { v: 5 });
  }
  // hořící políčko – použitelný je jen hasicák
  const fire = room.fires[key];
  if (fire) {
    if (isExt(held)) return undefined;                 // hasicák se používá držením tlačítka
    return ev(room, 'no', fx, fy, { m: 'Hoří! Vezmi hasicák!' });
  }

  if (CRATES[ch]) {                       // police v kuchyni
    if (!held) {
      if (st.n <= 0) return ev(room, 'no', fx, fy, { m: 'Došlo ' + ING_CS[st.k] + '! Doplň ze skladu' });
      st.n--;
      p.held = newIngredient(st.k);
      return ev(room, 'pick', fx, fy);
    }
    if (isBox(held) && held.k === st.k) return refillFromBox(room, p, st, fx, fy);
    return ev(room, 'no', fx, fy);
  }
  if (RACKS[ch]) {                        // regál ve skladu
    if (!held) {
      if (room.mode === 'days') {
        if ((room.boxes[st.k] || 0) <= 0) return ev(room, 'no', fx, fy, { m: 'Sklad je prázdný – kup krabice' });
        room.boxes[st.k]--;
      }
      p.held = newBox(room, st.k);
      return ev(room, 'pick', fx, fy);
    }
    if (isBox(held) && held.k === st.k && held.n >= boxSizeOf(room)) {
      if (room.mode === 'days') room.boxes[st.k] = Math.min(boxCapOf(room), (room.boxes[st.k] || 0) + 1);
      p.held = null;
      return ev(room, 'drop', fx, fy);
    }
    return ev(room, 'no', fx, fy, { m: isBox(held) ? 'Vrátit jde jen plná krabice' : '' });
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
        st.prog += WASH_BUMP * (1 + 0.3 * up(room, 'dish')); ev(room, 'wash', fx, fy);
        return checkWash(room, st, p);
      }
      return ev(room, 'no', fx, fy);

    case 'U': // kelímky
      if (!held) { p.held = newCup(); return ev(room, 'pick', fx, fy); }
      if (isCup(held) && !held.d) { p.held = null; return ev(room, 'drop', fx, fy); }
      return ev(room, 'no', fx, fy);

    case 'A': case 'E': case 'O': // kohoutky s pitím
      if (isBox(held) && held.k === st.drink) return refillFromBox(room, p, st, fx, fy);
      if (!isCup(held)) return ev(room, 'no', fx, fy, { m: 'Potřebuješ kelímek' });
      if (held.d) return ev(room, 'no', fx, fy, { m: 'Kelímek je plný' });
      if (fillBlocked(room, p, st, fx, fy)) return undefined;
      st.prog += FILL_BUMP * (1 + 0.25 * up(room, 'pour'));
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
      if (isBox(held)) return ev(room, 'no', fx, fy, { m: 'Krabici nevyhazuj!' });
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
        o.dd = true; room.stat.drinks++; bump(room, p.id, 'drinks'); p.held = null;
        pts += completeOrder(room, o);
        return ev(room, 'serve', fx, fy, { v: pts, o: o.id, part: 'drink', d: held.d });
      }
      if (!isPlate(held) || !held.c.length) return ev(room, 'no', fx, fy, { m: 'Potřebuješ talíř s jídlem nebo pití' });
      const idx = findOrder(room, held.c);
      if (idx < 0) return ev(room, 'no', fx, fy, { m: 'Tohle nikdo neobjednal!' });
      const o = room.orders[idx];
      let pts = payout(room, o, 15 + 5 * (o.it || RECIPES_PUBLIC[o.r].items).length + Math.round(10 * Math.max(0, o.t / o.l)), false);
      o.fd = true; room.delivered++; room.stat.dishes++; bump(room, p.id, 'dishes');
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
  if (isExt(p.held)) { sprayCone(room, p, dt); return; }
  const fire = room.fires[key];
  if (fire) return;
  const st = room.st[key];
  if (!st) return;
  if (isCup(p.held)) {
    if (st.type === 'T' && !p.held.d && !fillBlocked(room, p, st, fx, fy)) {
      st.prog += dt / FILL_TIME * (1 + 0.25 * up(room, 'pour'));
      if (p.sfxT <= 0) { ev(room, 'pour', fx, fy); p.sfxT = 0.22; }
      checkFill(room, p, st, fx, fy);
    }
    return;
  }
  if (p.held) return;
  if (st.type === 'K' && isIng(st.item) && CHOPPABLE[st.item.k] && st.item.s === 'raw') {
    st.prog += dt / CHOP_TIME * (1 + 0.25 * up(room, 'knife'));
    if (p.sfxT <= 0) { ev(room, 'chop', fx, fy); p.sfxT = 0.22; }
    checkChop(room, st, p);
  } else if (st.type === 'W' && room.dirty > 0) {
    st.prog += dt / WASH_TIME * (1 + 0.3 * up(room, 'dish'));
    if (p.sfxT <= 0) { ev(room, 'wash', fx, fy); p.sfxT = 0.3; }
    checkWash(room, st, p);
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
    if (it.s === COOK_FROM[it.k]) {
      s.prog += dt * heat * (1 + 0.15 * up(room, 'oven')) / COOK_TIME;
      if (s.prog >= 1) { it.s = 'cooked'; s.prog = 1; s.burn = 0; s.warned = false; ev(room, 'done', fx, fy); if (s.by) bump(room, s.by, 'cooks'); }
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
    rec = weighted(room.recipes);
    if (thirst || Math.random() < 0.4) dr = pick(DRINK_IDS);                 // menu: jídlo + pití
  }
  // typ zákazníka
  const pool = Object.keys(CUSTOMER_TYPES)
    .filter((id) => !(CUSTOMER_TYPES[id].minDay && room.day < CUSTOMER_TYPES[id].minDay))
    .filter((id) => rec || (id !== 'picky' && id !== 'critic'))
    .map((id) => ({ id, w: CUSTOMER_TYPES[id].w }));
  let ty = weighted(pool).id;
  let items = rec ? rec.items.slice() : null, no = null;
  if (ty === 'picky') {
    if (items.length >= 3) { no = pick(items.slice(1)); items = items.filter((k) => k !== no); }   // základ (první surovina) zůstane
    else ty = 'normal';
  }
  if (ty === 'critic' && rec && !dr) dr = pick(DRINK_IDS);
  const T = CUSTOMER_TYPES[ty];
  let limit = (rec ? 55 + rec.items.length * 12 : 38) + (rec && dr ? 12 : 0);
  limit = Math.round(limit * (room.players.size <= 1 ? 1.3 : 1) * T.time);
  let vip = false;
  if (room.mode === 'days') {
    limit = Math.round(limit * (1 + 0.1 * up(room, 'patience')));
    const chance = modIs(room, 'vip') ? 0.35 : Math.min(0.25, 0.06 + 0.01 * room.day + 0.04 * up(room, 'vip') + 0.02 * room.rep);
    vip = Math.random() < chance;
    if (vip) limit = Math.round(limit * 0.75);
  }
  room.orders.push({ id: ++room.orderSeq, r: rec ? rec.id : null, dr, it: items, no, ty, pm: T.pay, tip: T.tip, fd: false, dd: false, vip, t: limit, l: limit });
  ev(room, 'order', 0, 0, { vip });
}

function updateOrders(room, dt) {
  const rush = (chaosIs(room, 'rush') ? 2 : 1) * (modIs(room, 'rush') ? 1.4 : 1) * (room.mode === 'days' ? (1 + 0.1 * up(room, 'ads')) * (0.8 + 0.1 * room.rep) : 1);
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
      if (room.mode === 'days') room.money = Math.max(0, room.money - Math.round(EXPIRE_PENALTY * (1 - 0.25 * up(room, 'insure'))));
      else room.score = Math.max(0, room.score - EXPIRE_PENALTY);
      repAdd(room, o.ty === 'critic' ? -1 : o.ty === 'regular' ? -0.45 : -0.3, o.ty);
      ev(room, 'expire', 0, 0, { o: o.id });
    }
  }
}

// Rychlost chůze hráče (boty, krabice v ruce) – klient počítá úplně stejně
const walkSpeed = (room, p) => SPEED * (1 + 0.06 * up(room, 'boots')) *
  (isBox(p.held) ? Math.min(1, BOX_SPEED + 0.08 * up(room, 'cart')) : 1);

/*
 * Pohyb řízený příkazy: klient posílá posloupnost příkazů po 1/60 s
 * (směr chůze, směr pohledu, držení, stisk interakce) s pořadovým číslem.
 * Server je zpracuje ve stejném pořadí a stejnými kroky, jaké klient předpověděl,
 * takže po zastavení nic „nedoklouzává“. Číslo posledního zpracovaného příkazu
 * (ack) jde zpět ve snapshotu a klient podle něj opraví předpověď.
 */
function runCmd(room, p, c) {
  p.fx = c.fx; p.fy = c.fy;
  if (c.dx || c.dy) {
    const k = walkSpeed(room, p) * CMD_DT;
    moveBy(p, c.dx * k, c.dy * k);
  }
  p.input = { dx: c.dx, dy: c.dy, hold: c.h };
  if (c.a) interact(room, p);
  updateHold(room, p, CMD_DT);
  p.ack = c.s;
}

function runCmds(room, p, dt) {
  // rozpočet času: klient nemůže běžet rychleji než skutečný čas (max. malá rezerva na výkyvy sítě)
  p.budget = Math.min(0.25, p.budget + dt);
  while (p.queue.length && p.budget >= CMD_DT - 1e-9) {
    p.budget -= CMD_DT;
    runCmd(room, p, p.queue.shift());
  }
}

function tickRoom(room, dt) {
  if (room.state !== 'playing') return;
  curMap = room.map;
  if (room.cd > 0) {
    room.cd = Math.max(0, room.cd - dt);
    if (room.cd === 0) ev(room, 'go', 0, 0);
    return;
  }
  room.time -= dt;

  const list = [...room.players.values()];
  for (const p of list) {
    if (p.cmd) { runCmds(room, p, dt); continue; }      // nový klient: pohyb podle příkazů
    // starý klient (události „input“ / „press“): původní chování
    const { dx, dy } = p.input;
    if (dx || dy) {
      // analogový pohyb z pohledu první osoby (délka vektoru max. 1)
      const k = walkSpeed(room, p) * dt / Math.max(1, Math.hypot(dx, dy));
      moveBy(p, dx * k, dy * k);
    }
  }
  separate(list);
  for (const p of list) if (!p.cmd) updateHold(room, p, dt);
  updateStoves(room, dt);
  updateHelpers(room, dt);
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
/* ---------- Pomocníci (Dny): skuteční NPC, kteří chodí po kuchyni ---------- */
function floorNeighbor(map, x, y) {
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (map[y + dz] && map[y + dz][x + dx] === '.') return [x + dx, y + dz];
  return null;
}
// nejkratší cesta po podlaze (BFS), vrací středy dlaždic
function bfsPath(map, sx, sy, gx, gy) {
  if (sx === gx && sy === gy) return [];
  const Hh = map.length, Ww = map[0].length;
  const prev = new Map([[sx + ',' + sy, null]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= Ww || ny >= Hh || prev.has(k) || map[ny][nx] !== '.') continue;
      prev.set(k, [x, y]);
      if (nx === gx && ny === gy) {
        const path = [];
        let c = [nx, ny];
        while (c && !(c[0] === sx && c[1] === sy)) { path.unshift([c[0] + 0.5, c[1] + 0.5]); c = prev.get(c[0] + ',' + c[1]); }
        return path;
      }
      q.push([nx, ny]);
    }
  }
  return null;
}
function findChar(map, ch) {
  for (let y = 0; y < map.length; y++) { const x = map[y].indexOf(ch); if (x >= 0) return [x, y]; }
  return null;
}

function agentHome(room, kind) {
  const target = kind === 'dish' ? room.sinks[0] : kind === 'cook' ? Object.values(room.st).find((st) => st.type === 'K') : Object.values(room.st).find((st) => st.type === 'R');
  if (!target) return null;
  const nb = floorNeighbor(room.map, target.x, target.y);
  return nb ? { x: nb[0] + 0.5, y: nb[1] + 0.5, ang: Math.atan2(target.x - nb[0], target.y - nb[1]) } : null;
}
const agentTile = (a) => [Math.floor(a.x), Math.floor(a.y)];
function agentGo(room, a, nb) {            // naplánuje cestu k dlaždici; false, když se tam nedá dojít
  if (!nb) return false;
  const [sx, sy] = agentTile(a);
  const path = bfsPath(room.map, sx, sy, nb[0], nb[1]);
  if (!path) return false;
  a.path = path;
  return true;
}
function agentMove(a, speed, dt) {          // true, když dorazil
  if (!a.path.length) return true;
  const t = a.path[0], dx = t[0] - a.x, dy = t[1] - a.y, d = Math.hypot(dx, dy), step = speed * dt;
  if (d <= step) { a.x = t[0]; a.y = t[1]; a.path.shift(); }
  else { a.x += dx / d * step; a.y += dy / d * step; }
  if (d > 0.001) a.ang = Math.atan2(dx, dy);
  a.mv = 1;
  return a.path.length === 0;
}
function agentFace(a, tx, ty) { a.ang = Math.atan2(tx + 0.5 - a.x, ty + 0.5 - a.y); }
function agentGoHome(room, a) { a.st = 'back'; a.carry = null; if (!agentGo(room, a, [Math.floor(a.home.x), Math.floor(a.home.y)])) { a.x = a.home.x; a.y = a.home.y; a.path = []; } }

function updateHelpers(room, dt) {
  if (room.mode !== 'days') return;
  for (const id in HELPERS) {
    const lvl = room.helpers[id] || 0;
    if (!lvl) { delete room.ag[id]; continue; }
    if (!room.ag[id]) {
      const home = agentHome(room, id);
      if (!home) continue;
      room.ag[id] = { k: id, x: home.x, y: home.y, ang: home.ang, home, st: 'idle', path: [], t: 0, wait: 1, carry: null, job: null };
    }
  }
  const spd = (lvl) => 2.4 + 0.4 * lvl;
  for (const id in room.ag) {
    const a = room.ag[id], lvl = room.helpers[id] || 1;
    a.mv = 0; a.work = 0;
    if (a.st === 'back') {
      if (agentMove(a, spd(lvl), dt)) { a.st = 'idle'; a.wait = 0.4; a.ang = a.home.ang; }
      continue;
    }
    if (id === 'dish') {                                            // myč: dřez → špinavý talíř umýt → odnést na stoh
      if (a.st === 'idle') {
        a.wait -= dt;
        if (a.wait <= 0 && room.dirty > 0 && room.sinks[0] && agentGo(room, a, floorNeighbor(room.map, room.sinks[0].x, room.sinks[0].y))) a.st = 'toSink';
      } else if (a.st === 'toSink') {
        if (agentMove(a, spd(lvl), dt)) { a.st = 'wash'; a.t = 0; }
      } else if (a.st === 'wash') {
        if (room.dirty <= 0) { agentGoHome(room, a); continue; }
        a.work = 1; a.t += dt; agentFace(a, room.sinks[0].x, room.sinks[0].y);
        if (a.t >= [6, 4.5, 3][lvl - 1]) {
          room.dirty--; a.carry = 'plate';
          const d = findChar(room.map, 'D');
          if (d && agentGo(room, a, floorNeighbor(room.map, d[0], d[1]))) a.st = 'toStack';
          else { room.plates++; a.carry = null; agentGoHome(room, a); }
        }
      } else if (a.st === 'toStack') {
        if (agentMove(a, spd(lvl), dt)) { room.plates++; a.carry = null; a.work = 1; agentGoHome(room, a); }
      }
    } else if (id === 'cook') {                                     // kuchař: dojde k prkénku se syrovou surovinou a nakrájí ji
      if (a.st === 'idle') {
        a.wait -= dt;
        if (a.wait <= 0) {
          let best = null, bd = 1e9;
          for (const key in room.st) {
            const st = room.st[key];
            if (st.type !== 'K' || room.fires[key] || !isIng(st.item) || !CHOPPABLE[st.item.k] || st.item.s !== 'raw') continue;
            const d = Math.hypot(st.x + 0.5 - a.x, st.y + 0.5 - a.y);
            if (d < bd) { bd = d; best = st; }
          }
          if (best && agentGo(room, a, floorNeighbor(room.map, best.x, best.y))) { a.job = { key: best.x + ',' + best.y }; a.st = 'toBoard'; }
          else a.wait = 0.5;
        }
      } else if (a.st === 'toBoard') {
        if (agentMove(a, spd(lvl), dt)) a.st = 'chop';
      } else if (a.st === 'chop') {
        const st = room.st[a.job.key];
        if (!st || !isIng(st.item) || !CHOPPABLE[st.item.k] || st.item.s !== 'raw') { agentGoHome(room, a); continue; }
        a.work = 1; agentFace(a, st.x, st.y);
        st.prog += dt / CHOP_TIME * [0.7, 1.1, 1.6][lvl - 1];
        checkChop(room, st, null);
      }
    } else if (id === 'stock') {                                    // skladník: krabice z regálu → donést na polici, která dochází
      if (a.st === 'idle') {
        a.wait -= dt;
        if (a.wait <= 0) {
          a.wait = 0.5;
          const bs = boxSizeOf(room), cap = shelfCapOf(room);
          let best = null;
          for (const key in room.st) {
            const st = room.st[key];
            const k = st.type === 'S' ? st.k : st.type === 'T' ? st.drink : null;
            if (!k || room.fires[key] || st.n > cap - bs || (room.boxes[k] || 0) <= 0 || st.claimed) continue;
            if (!best || st.n < best.st.n) best = { st, k, key };
          }
          if (best) {
            const rack = Object.values(room.st).find((r) => r.type === 'R' && r.k === best.k);
            if (rack && agentGo(room, a, floorNeighbor(room.map, rack.x, rack.y))) {
              room.boxes[best.k]--; best.st.claimed = true;
              a.job = { key: best.key, k: best.k, rack };
              a.st = 'toRack';
            }
          }
        }
      } else if (a.st === 'toRack') {
        if (agentMove(a, spd(lvl), dt)) {
          a.carry = 'box:' + a.job.k;
          const t = room.st[a.job.key];
          if (agentGo(room, a, floorNeighbor(room.map, t.x, t.y))) a.st = 'toShelf';
          else { room.boxes[a.job.k]++; t.claimed = false; agentGoHome(room, a); }
        }
      } else if (a.st === 'toShelf') {
        if (agentMove(a, spd(lvl), dt)) {
          const t = room.st[a.job.key];
          const moved = Math.min(shelfCapOf(room) - t.n, boxSizeOf(room));
          t.n += Math.max(0, moved); t.claimed = false;
          if (moved < boxSizeOf(room)) room.boxes[a.job.k] = Math.min(boxCapOf(room), (room.boxes[a.job.k] || 0) + 1);
          a.work = 1; agentFace(a, t.x, t.y);
          ev(room, 'drop', t.x + 0.5, t.y + 0.5, { m: '+' + Math.max(0, moved) + ' 📦' });
          agentGoHome(room, a);
          a.wait = [4, 2.5, 1.5][lvl - 1];
        }
      }
    }
  }
}

// pozice pomocníků pro klienta
function helperSnapshot(room) {
  return Object.values(room.ag).map((a) => ({ k: a.k, l: room.helpers[a.k] || 1, x: r2(a.x), y: r2(a.y), ang: r2(a.ang), a: a.work ? 1 : 0, m: a.mv ? 1 : 0, c: a.carry }));
}

function snapshot(room) {
  const s = {};
  for (const key in room.st) {
    const st = room.st[key];
    if (st.type === 'C') { if (st.item) s[key] = { i: st.item }; }
    else if (st.type === 'K') { if (st.item) s[key] = { i: st.item, p: r2(st.prog) }; }
    else if (st.type === 'F') { if (st.item) s[key] = { i: st.item, p: r2(st.prog), b: r2(st.burn), f: r2(Math.min(1, (st.smolder || 0) / FIRE_IGNITE_DELAY)) }; }
    else if (st.type === 'W') { if (st.prog > 0) s[key] = { p: r2(st.prog) }; }
    else if (st.type === 'T') s[key] = { n: st.n, p: r2(st.prog) };
    else if (st.type === 'S') s[key] = { n: st.n };
    else if (st.type === 'R') s[key] = { n: room.mode === 'days' ? (room.boxes[st.k] || 0) : -1 };
    else if (st.type === 'Y') s[key] = { x: st.has ? 1 : 0 };
  }
  const events = room.events;
  room.events = [];
  const out = {
    t: r1(Math.max(0, room.time)),
    cd: r1(room.cd),
    sc: room.mode === 'days' ? room.money : room.score,
    pl: [...room.players.values()].map((p) => ({
      id: p.id, n: p.name, c: p.color, lk: p.look, sp: p.sprayT > 0 ? 1 : 0, x: p.x, y: p.y, fx: r2(p.fx), fy: r2(p.fy), h: p.held, ak: p.ack,   // přesná pozice: klient z ní přehrává kroky bit po bitu stejně
    })),
    s,
    o: room.orders.map((o) => ({ id: o.id, r: o.r, dr: o.dr, it: o.it, no: o.no, ty: o.ty, fd: o.fd, dd: o.dd, v: o.vip ? 1 : 0, t: r1(o.t), l: o.l })),
    fl: room.flames.slice(0, 48).map((f) => ({ x: r2(f.x), z: r2(f.z), h: r2(f.h), f: f.floor ? 1 : 0 })),
    rt: room.rats.map((r) => ({ id: r.id, x: r2(r.x), y: r2(r.y), a: r2(r.a), s: r.st === 'eat' ? 1 : r.st === 'flee' ? 2 : 0 })),
    ch: room.chaos ? { id: room.chaos.id, n: room.chaos.n, t: r1(room.chaos.t), d: room.chaos.d } : null,
    d: room.plates,
    w: room.dirty,
    ev: events,
  };
  out.cap = shelfCapOf(room);
  if (room.mode === 'days') {
    out.dy = room.day;
    out.rp = r1(room.rep);
    out.hp = helperSnapshot(room);
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
    if (room.mode === 'classic' && d && REST[d.rest]) applyRest(room, d.rest);
    addPlayer(room, socket, cleanName(d && d.name), d && d.look);
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
    addPlayer(room, socket, cleanName(d.name), d.look);
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
    if (mode === 'days') applyRest(room, 'burger');       // ve Dnech se začíná burgerem
    broadcastRoom(room);
  });

  // Hostitel vybírá restaurantu v lobby (jen klasika; ve Dnech se restaurace kupují)
  socket.on('setRest', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'lobby' || room.host !== socket.id || room.mode !== 'classic') return;
    if (!d || !REST[d.id] || d.id === room.rest) return;
    applyRest(room, d.id);
    broadcastRoom(room);
  });

  // Dny: nákup a výběr restaurace pro další den
  socket.on('buyRest', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d || !REST[d.id] || room.owned[d.id]) return;
    const r = REST[d.id];
    if (r.cost > room.money) return socket.emit('err', { m: 'Na tuhle restauraci nemáš dost peněz.' });
    room.money -= r.cost;
    room.owned[d.id] = true;
    for (const k in r.starter) room.boxes[k] = Math.min(boxCapOf(room), (room.boxes[k] || 0) + 1);       // pár krabic na start
    room.nextRest = d.id;
    broadcastShop(room);
  });
  socket.on('pickRest', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d || !REST[d.id] || !room.owned[d.id]) return;
    room.nextRest = d.id;
    broadcastShop(room);
  });

  // Režim „Dny“: nákup surovin mezi dny
  socket.on('buy', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d) return;
    const k = String(d.k);
    if (!Object.prototype.hasOwnProperty.call(room.prices, k)) return;
    let n = Math.floor(Number(d.n));
    if (!(n >= 1)) return;
    const have = room.boxes[k] || 0;
    n = Math.min(n, boxCapOf(room) - have);
    if (n <= 0) return socket.emit('err', { m: 'Sklad je plný (max ' + boxCapOf(room) + ' krabic).' });
    const cost = boxPrice(room, k) * n;
    if (cost > room.money) return socket.emit('err', { m: 'Nemáš dost peněz.' });
    room.money -= cost;
    room.boxes[k] = have + n;
    broadcastShop(room);
  });

  // pokračování uložené hry (kód z obchodu)
  socket.on('resume', (d) => {
    d = d || {};
    const data = readSave(d.code);
    if (!data) return socket.emit('err', { m: 'Neplatný nebo poškozený kód uložení.' });
    removePlayer(socket);
    const room = createRoom('days');
    addPlayer(room, socket, cleanName(d.name), d.look);
    restoreRoom(room, data);
    socket.emit('joined', { id: socket.id, code: room.code });
    broadcastRoom(room);
    broadcastShop(room);
  });

  socket.on('saveReq', () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop') return;
    socket.emit('save', saveInfo(room));
  });

  // pomocníci: najmout / vycvičit / propustit
  socket.on('hire', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d || !HELPERS[d.id]) return;
    const H0 = HELPERS[d.id];
    if (room.day < H0.minDay) return socket.emit('err', { m: 'Odemkne se až ve dni ' + H0.minDay + '.' });
    if (room.helpers[d.id] > 0) return;
    if (H0.hire > room.money) return socket.emit('err', { m: 'Nemáš dost peněz.' });
    room.money -= H0.hire;
    room.helpers[d.id] = 1;
    broadcastShop(room);
  });
  socket.on('train', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d || !HELPERS[d.id]) return;
    const lvl = room.helpers[d.id] || 0;
    if (lvl < 1 || lvl >= 3) return;
    const cost = HELPERS[d.id].train[lvl - 1];
    if (cost > room.money) return socket.emit('err', { m: 'Nemáš dost peněz.' });
    room.money -= cost;
    room.helpers[d.id] = lvl + 1;
    broadcastShop(room);
  });
  socket.on('dismiss', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d || !HELPERS[d.id]) return;
    room.helpers[d.id] = 0;
    broadcastShop(room);
  });

  socket.on('upgrade', (d) => {
    const room = rooms.get(socket.data.code);
    if (!room || room.state !== 'shop' || !d) return;
    const id = String(d.id);
    if (!Object.prototype.hasOwnProperty.call(UPGRADES, id)) return;
    const lvl = up(room, id), u = UPGRADES[id];
    if (room.day < u.minDay) return socket.emit('err', { m: 'Odemkne se až ve dni ' + u.minDay + '.' });
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
    if (p && !p.cmd && room.state === 'playing' && room.cd === 0) interact(room, p);
  });

  // Dávka pohybových příkazů: { g: číslo hry, c: [[seq, dx, dy, fx, fy, příznaky], ...] }
  // příznaky: 1 = držení interakce, 2 = stisk interakce v tomto kroku
  socket.on('cmds', (d) => {
    const room = rooms.get(socket.data.code);
    const p = room && room.players.get(socket.id);
    if (!p || !d || !Array.isArray(d.c) || room.state !== 'playing' || room.cd > 0 || d.g !== room.gn) return;
    p.cmd = true;
    const num = (n) => { n = Number(n); return isFinite(n) ? n : 0; };
    for (const c of d.c.slice(0, MAX_QUEUE)) {
      if (!Array.isArray(c)) continue;
      const s = Math.floor(num(c[0]));
      if (s <= p.qseq) continue;                          // duplicita nebo starý příkaz
      p.qseq = s;
      let dx = num(c[1]), dy = num(c[2]);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      let fx = num(c[3]), fy = num(c[4]);
      const fl = Math.hypot(fx, fy);
      if (fl > 0.01) { fx /= fl; fy /= fl; } else { fx = p.fx; fy = p.fy; }
      const flags = Math.floor(num(c[5]));
      p.queue.push({ s, dx, dy, fx, fy, h: !!(flags & 1), a: !!(flags & 2) });
    }
    if (p.queue.length > MAX_QUEUE) {                     // klient je příliš napřed – zahodíme nejstarší
      const cut = p.queue.splice(0, p.queue.length - MAX_QUEUE);
      p.ack = cut[cut.length - 1].s;
    }
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
  module.exports = { rooms, tickRoom, interact, snapshot, startGame, MAP, MAPS, REST, PRICES, rentFor, makeSave, readSave, CUSTOMER_TYPES, HELPERS }; // pro testy
}
