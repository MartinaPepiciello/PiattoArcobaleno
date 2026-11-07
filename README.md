# Piatto Arcobaleno

Live at https://piatto-arcobaleno.mpepiciello.workers.dev

A family food diary in Italian. Log what you eat by category on a calendar, then see how the last 7 days, 30 days or any date range went in a color-coded bar chart.

Runs as a Cloudflare Worker (static files + a small API) with a Cloudflare D1 database. No passwords: the diary belongs to a nickname (case-insensitive), so anyone can open it on any device just by typing the same name. Each person sees only their own diary.

## What's in the app

- **Calendario**: a month view (week starts on Monday). Each thing eaten shows up in its day as a colored icon (on a wide screen, as a small labeled event). Tap a day to see its list below; tap an item to edit or delete it.
- **+**: pick one of nine categories, the number of portions (default 1; any number such as 0,5 or 1,3, with ½ / 1 / 1½ / 2 shortcuts) and an optional short note. The day can be changed too.
- **Statistiche**: a bar chart per category for the last 7 days, the last 30 days or a custom range, counting portions or number of times. Tap a bar for the daily and weekly average.
- **Promemoria** (bell icon at the top): an optional daily notification at a time you choose, set per device. "Mandami una notifica di prova" sends one right away to check it works.
  - Android: works from Chrome.
  - iPhone/iPad (iOS 16.4+): first add the app to the Home Screen (Share → Add to Home Screen), open it from there, then turn the reminder on.
- Installable on the phone's home screen.

Categories: carne rossa 🥩, carne bianca 🍗, pesce 🐟, latticini 🧀, farinacei 🍝, frutta 🍎, verdura 🥦, legumi 🫘, malefatte 🍩. They're defined in `public/app.js` (`CATS`) and `src/worker.js`.

## Files

- `public/`: the app (`index.html`, `styles.css`, `app.js`, icons, manifest)
- `src/worker.js`: the API (`/api/entries/:nick`)
- `schema.sql`: database tables
- `public/sw.js`: service worker that shows the reminder notification
- `scripts/build-icons.mjs`: regenerates the icons (`npm run icons`)
- `scripts/make-vapid-keys.mjs`: makes a new key pair for the reminders

## How reminders work

Each device that turns reminders on saves its push subscription, chosen time and time zone in the `push_subs` table. A cron trigger runs the Worker every 5 minutes and sends an empty push to every device whose time has passed today and hasn't had one yet; the service worker then shows the message. Pushes are signed with a VAPID key pair: the public key is `VAPID_PUBLIC_KEY` in `wrangler.jsonc`, the private key is the Worker secret `VAPID_PRIVATE_JWK` (and in `.dev.vars` locally, which is not committed).

## First deploy (already done)

Only needed to set it up on a new Cloudflare account.

```bash
npm install
npx wrangler login
npx wrangler d1 create piatto-arcobaleno
```
Copy the `database_id` it prints into `wrangler.jsonc`. Run `node scripts/make-vapid-keys.mjs`, put the public key it prints in `wrangler.jsonc` and upload the private one with `npx wrangler secret put VAPID_PRIVATE_JWK`. Then:
```bash
npm run db:init:remote
npm run deploy
```
`npm run deploy` prints the URL. To use your own domain, add a custom domain to the `piatto-arcobaleno` Worker in the Cloudflare dashboard.

## Later changes

`npm run deploy` again.

## Local development

```bash
npm run db:init:local
npm run dev
```
Then open http://localhost:8787. Notifications need HTTPS or localhost, and a `.dev.vars` file with the private key.
