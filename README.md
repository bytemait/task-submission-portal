# BYTE task submission portal

A student-facing guided submission form and an admin review desk for BYTE MAIT recruitment. Tracks reflect [bytesoc.dev/tasks](https://bytesoc.dev/tasks/) (11 tracks as of initial implementation); editable field definitions live in `shared/tracks.ts`.

## Docker deployment (recommended)

Requires Docker Engine and the Docker Compose plugin. Docker runs the production build; Vite's development server is not included or exposed.

1. Create a runtime `.env` from the template and add a strong salted scrypt hash for the admin password:

   ```sh
   cp .env.example .env
   node -e 'const {randomBytes,scryptSync}=require("node:crypto"); const {createInterface}=require("node:readline"); const rl=createInterface({input:process.stdin,output:process.stdout}); rl.question("Admin password: ",p=>{const salt=randomBytes(16); console.log("scrypt:"+salt.toString("hex")+":"+scryptSync(p,salt,64).toString("hex")); rl.close()})'
   chmod 600 .env
   ```

   Put the printed hash in `ADMIN_PASSWORD_HASH`. The plaintext is not stored by the app. `.env` is ignored by git and excluded from the Docker build context. Never put credentials in Dockerfile `ARG`/`ENV`, Compose source, or image layers.

2. For local HTTP testing, set `SECURE_COOKIES=0` and keep the default `BIND_ADDRESS=127.0.0.1` so the app is reachable only from this host:

   ```sh
   docker compose up --build -d
   docker compose ps
   docker compose logs -f app
   # http://127.0.0.1:3001/  ·  http://127.0.0.1:3001/login
   ```

   Use `docker compose down` to stop it; do not use `down -v` unless intentionally deleting all submission data. Change `HOST_PORT` in `.env` to adjust the local host port. `BIND_ADDRESS=0.0.0.0` exposes the port on every host interface; only do this if a firewall and trusted HTTPS proxy protect it.

3. For an HTTPS deployment, put a trusted TLS-terminating reverse proxy on the host (or a separately managed proxy network) in front of port 3001. Keep the published app port bound to loopback, configure the proxy to forward only to this service, set `SECURE_COOKIES=1`, and enforce HTTPS/HSTS and request-size/time limits at the proxy. The browser and API use the same public origin, so no `ALLOWED_ORIGINS` entry is needed for the usual same-origin setup. Only add exact, trusted origins if the UI and API are intentionally served on different origins. Do not trust arbitrary forwarded host/proto headers. Admin/draft sessions and rate limits are process memory: deploy exactly one app replica; replacing/restarting the container invalidates active sessions.

Configuration used by Compose: `ADMIN_PASSWORD_HASH` (required for admin login), `SECURE_COOKIES` (0 for local HTTP, 1 for HTTPS), `HOST_PORT` (host port, default 3001), `BIND_ADDRESS` (default 127.0.0.1), and optional `ALLOWED_ORIGINS` (comma-separated exact origins; blank by default). `DB_PATH` is fixed by Compose at `/app/data/submissions.sqlite`.

### Persistence and backups

Compose creates a named volume, `submissions-data`, mounted at `/app/data`. It stores SQLite plus its WAL files across container replacement and image upgrades. Do not keep the only copy in the container writable layer or copy only the `.sqlite` file while the app is writing—the WAL may contain committed data. Create an online, consistent snapshot with the included Node SQLite backup API helper:

```sh
docker compose exec -T -e BACKUP_PATH=/app/data/backup.sqlite app node scripts/backup-db.mjs
# Copy the backup out of the container for off-host storage:
docker compose cp app:/app/data/backup.sqlite ./backup.sqlite
```

Restore from a consistent backup during a maintenance window (this **replaces** current data). The app must be stopped before removing old WAL/SHM files. Keep a copy of both the old volume and your backup until verification succeeds:

```sh
docker compose stop app
docker compose cp ./backup.sqlite app:/app/data/restore.sqlite
docker compose run --rm --no-deps --entrypoint node app -e 'const fs=require("node:fs"); for(const f of ["/app/data/submissions.sqlite","/app/data/submissions.sqlite-wal","/app/data/submissions.sqlite-shm"])try{fs.rmSync(f)}catch(e){if(e.code!=="ENOENT")throw e}; fs.copyFileSync("/app/data/restore.sqlite","/app/data/submissions.sqlite"); fs.rmSync("/app/data/restore.sqlite")'
docker compose up -d --no-deps app
curl -f http://127.0.0.1:3001/api/health
```

Ensure the off-host backup is readable before stopping the service. For upgrades, tag the existing local image before replacing it (`docker image tag byte-task-submission-portal:local byte-task-submission-portal:previous`), take a backup, then `docker compose up --build -d`. If necessary, restore the backup, retag the previous image as `byte-task-submission-portal:local`, and `docker compose up -d --no-build --force-recreate`. Never remove the data volume during rollback. The smoke script tests backup, restoration and draft recovery using an isolated disposable volume.

The image uses a pinned Node 24 Debian slim base, multi-stage `npm ci` builds, runs as non-root, has a read-only root filesystem (only `/tmp` and the persistent data volume are writable), drops Linux capabilities, and exposes only the Express service. `/api/health` checks SQLite readiness and is used by container health checks.

Run a disposable build/Compose smoke test (requires Docker and does not use the project's actual `.env` or data volume):

```sh
bash scripts/docker-smoke.sh
```

## Local development without Docker

Requires Node.js 24+ (`node:sqlite` is built in).

```sh
npm install
cp .env.example .env
# Set ADMIN_PASSWORD_HASH as described above.
npm run dev
```

The wizard is at http://localhost:5173/; admin login at http://localhost:5173/login. Vite proxies `/api` to Express on port 3001. For LAN development, set `ALLOWED_ORIGINS` to the exact dev origin(s), e.g. `http://192.168.0.23:5173,http://localhost:5173`. `npm run build` typechecks and builds the frontend; `npm start` serves the production frontend and API from one process; `npm test` runs validation and API integration tests.

## Flow

1. Student enters name and enrollment number (other contact details follow); the server recovers or creates a draft. Same name and enrollment on another device resumes it. Saves are debounced and serialized; final submission is immutable.
2. Student picks any combination of the 11 tracks, fills out each track's fields and reviews answers.
3. GitHub links are checked live via GitHub's public repository API and again on final submission. A private repository and a nonexistent one both appear as 404 without authorization; both are refused. GitHub outages/rate limits fail closed, not open.
4. The single admin signs in at `/login` with only a password, then reviews/searches/filters drafts and submitted entries at `/admin`.

## Security and launch caveats

**Do not launch publicly with sensitive drafts until recovery is strengthened.** Name + enrollment number is not an identity proof; anyone who knows both can view/edit that student's draft. This matches the requested recovery experience but is unsuitable for confidential submissions. Implement email OTP or an unguessable recovery code before production release (tracked in issue #3). The API rate-limits lookups per client IP, but that does not solve impersonation. Keep deployment internal until recovery is strengthened. Recovery errors may also reveal whether an enrollment exists.

Use HTTPS, secure cookies, reverse-proxy security headers and backups. Password hashes use salted scrypt; admin sessions are httpOnly, SameSite=Strict and expire after 8 hours. Sessions/rate limits are in-memory; the container deployment therefore supports one replica and restarts invalidate sessions. Public link fields other than GitHub are not availability-checked. The provided track answer fields are initial examples; task-specific requirements need review with BYTE. Dockerizing does not resolve these application-level security gaps or make the current recovery method suitable for public use.

## CodeGraph

The project was initialized with `codegraph init .`. The generated `.codegraph/` index is local and ignored by git. After editing run `codegraph sync .`; inspect with `codegraph explore '<query>'`, `codegraph node <symbol>`, or CodeGraph agent tools.
