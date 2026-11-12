# 🍔 Šílená kuchyně 3D

Multiplayerová kooperativní 3D kuchyňská hra (styl Overcooked) pro 2–4 hráče.
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
