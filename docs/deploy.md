# Deploying

One always-on Node server with persistent storage. Not serverless: a refresh run takes one to
three minutes and would be killed by a function timeout.

What the container needs:
- a **persistent volume** mounted at `/data` (the SQLite database lives there)
- the secrets `SITE_PASSWORD`, `APP_SECRET` and `ANTHROPIC_API_KEY` (plus
  `ANTHROPIC_WORKSPACE_ID` if the key is an organisation-level key — see RECONCILE #16)
- port 3000

Generate `APP_SECRET` once and never change it casually — changing it signs out every device
**and** makes any key she stored in Settings undecryptable (the app then falls back to the
default key):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Local, with Docker

```bash
cp .env.example .env      # fill in SITE_PASSWORD, APP_SECRET, ANTHROPIC_API_KEY
docker compose up --build
```

Then open http://localhost:3000. The database persists in the `jobboard-data` volume across
rebuilds. `docker compose down -v` deletes it.

## Local, without Docker

```bash
npm install
cp .env.example .env      # fill it in; add USE_MOCK_PROVIDER=1 to use fixture data with no key
npm run dev               # http://localhost:3000
```

For a production build locally: `npm run build && npm start`.

---

## Fly.io

`fly.toml` is in the repo. Fill in `app`, then:

```bash
fly launch --no-deploy            # picks up fly.toml and the Dockerfile
fly volumes create jobboard_data --size 1 --region lhr
fly secrets set SITE_PASSWORD='…' APP_SECRET='…' ANTHROPIC_API_KEY='…'
# only for an organisation-level key:
fly secrets set ANTHROPIC_WORKSPACE_ID='…'
fly deploy
```

`auto_stop_machines = "off"` and `min_machines_running = 1` keep the one machine running so a
refresh in progress is never stopped. The health check in the Dockerfile hits `/login`.

## Railway

1. New project → Deploy from GitHub repo (or `railway up`). Railway detects the Dockerfile.
2. Service → **Volumes** → add a volume mounted at `/data`.
3. Service → **Variables**: `SITE_PASSWORD`, `APP_SECRET`, `ANTHROPIC_API_KEY`
   (and `ANTHROPIC_WORKSPACE_ID` if needed), `DATABASE_PATH=/data/jobs.db`, `PORT=3000`.
4. Service → Settings → Networking: generate a public domain on port 3000.
5. Make sure the service is not set to sleep on inactivity.

Railway's volume and sleep settings move around in their UI; check their current docs if the
above doesn't match what you see.

---

## After the first deploy

- Open the site, enter the password once. The first search runs on load.
- Settings → AI model → **Test** confirms the key and model work before she uses it.
- The UK sponsor register downloads in the background about five seconds after boot and then
  weekly; Settings → Searching shows when it last updated.

## Rotating the password

Change `SITE_PASSWORD` and restart. Every device is signed out; she enters the new password once.

## Backups

The whole state is one file: `/data/jobs.db` (plus `-wal`/`-shm` while running). Copy it while
the app is stopped, or use `sqlite3 /data/jobs.db ".backup /data/backup.db"` while it runs.
