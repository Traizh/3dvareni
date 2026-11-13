# 🍔 Šílená kuchyně 3D

Multiplayerová kooperativní 3D kuchyňská hra z pohledu první osoby (styl Overcooked) pro 2–4 hráče.
Server: Node.js + Express + Socket.io (autoritativní simulace). Klient: Three.js (modely se staví v kódu).

## Struktura
- `server.js` – herní server (Render)
- `public/` – klient (`index.html`, `style.css`, `game.js`) – **totéž se nahrává na itch.io**
- `render.yaml` – Render Blueprint (služba `threedvareni`)
- `.github/workflows/itch-build.yml` – při pushi vyrobí `itch-build.zip`

## Nasazení serveru (GitHub → Render)
1. Nahraj obsah této složky do GitHub repozitáře (větev `main`).
2. Render → New → Web Service → vyber repozitář (nebo „Blueprint“ – použije `render.yaml`).
   Build: `npm install`, Start: `npm start`, Health check: `/healthz`, název `threedvareni`.
3. Každý push na GitHub server sám přenasadí. Adresa: https://threedvareni.onrender.com

## itch.io
1. Zabal **obsah** složky `public/` do ZIPu (soubor `index.html` musí být v kořeni) – hotový je `itch-build.zip`.
2. itch.io → Create new project → Kind of project: **HTML** → nahraj ZIP → zaškrtni *This file will be played in the browser*.
3. Doporučená velikost okna: 1280 × 720, zapni *Fullscreen button*.

Klient se na server připojuje na pevnou adresu `SERVER_URL` v `public/game.js` (aktuálně `https://threedvareni.onrender.com`).
Server má povolené CORS pro všechny originy, takže hra z itch.io funguje.

## Poznámky
- Render free plán po ~15 min nečinnosti usíná; první připojení pak trvá až minutu (hra ukazuje stav připojení a server rovnou „budí“).
- Kód místnosti se na itch.io kopíruje jako text (odkaz s `?room=` funguje jen na adrese Renderu).
- Three.js a Socket.io klient se načítají z CDN (cdnjs → jsDelivr → server).

## Lokální spuštění
```
npm install
npm start      # http://localhost:3000  (v game.js přepiš SERVER_URL na http://localhost:3000)
```

## Ovládání
WASD / ↑↓ – chůze a úkrok, myš (klikni do hry) nebo ←→ – rozhlížení, E / mezerník / levé tlačítko myši – interakce s tím, na co se díváš. Krájení a mytí: podrž interakci.

## Režimy
- **Klasika** – jedno kolo 180 s, týmové skóre a hvězdy.
- **Dny** – každý den 120 s. Suroviny z beden ubývají ze skladu, peníze získáváš z odevzdaných objednávek. Mezi dny se v obchodě objednávají zásoby a platí se nájem (25 Kč a každý den o 10 víc). Hra končí, když nezaplatíš nájem nebo ti nezbydou zásoby ani peníze na nákup.
- **Hrát sám** – tlačítko v menu spustí zvolený režim hned a bez dalších hráčů.

## Pití, oheň, krysy a chaos
- **Pití:** kelímek ze stohu → podrž ho u kohoutku (cola / limonáda / džus) → odnes na výdej. Objednávky mohou být jen pití, nebo menu (jídlo + pití; za kompletní menu je bonus). V režimu Dny pití spotřebovává sirup ze skladu.
- **Oheň:** připálené maso se po 4 s vznítí, oheň se šíří na sousední pulty, ničí věci a zákazníci kvůli kouři rychleji odcházejí. Hasicák je v držáku vlevo (dá se vrátit a naplní se). Míř na plameny a podrž E / levé tlačítko myši.
- **Krysy:** přibíhají z kouta, hlodají jídlo na pultech, talíře a (ve Dnech) zásoby. Plaší je přiblížení, dají se plácnout (E) za bonus.
- **Náhodné události:** rush hodina, přehřáté sporáky, výpadek proudu, krysí invaze, jiskra (požár), žízeň.
- **Dny navíc:** denní modifikátor (rušný den, VIP hosté, žíznivý den, krysí den, vedro), denní cíl s bonusem, kolísající ceny surovin a trvalá vylepšení (nůž, boty, pánev, talíře, pasti, hasicák, nápis).
