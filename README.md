# BYTE task submission portal

A student-facing guided submission form and an admin review desk for BYTE MAIT recruitment. Tracks reflect [bytesoc.dev/tasks](https://bytesoc.dev/tasks/) (11 tracks as of initial implementation); editable field definitions live in `shared/tracks.ts`.

## Get started

Requires Node.js 24+ (uses built-in `node:sqlite`).

```sh
npm install
cp .env.example .env
# Set ADMIN_PASSWORD_HASH and SECURE_COOKIES in .env as described below.
npm run dev
```

The wizard is at http://localhost:5173/; admin login at http://localhost:5173/login. Vite proxies `/api` to the Express API on port 3001. SQLite lives in `data/submissions.sqlite` (configurable via `DB_PATH`). `npm run build` checks TypeScript and builds the frontend; `npm start` serves both the API and the built frontend from port 3001. `npm test` runs validation tests.

To create the admin password hash (do not put the plaintext password in an environment variable or shell history), run:

```sh
node -e 'const {randomBytes,scryptSync}=require("node:crypto"); const {createInterface}=require("node:readline"); const rl=createInterface({input:process.stdin,output:process.stdout}); rl.question("Admin password: ",p=>{const salt=randomBytes(16); console.log("scrypt:"+salt.toString("hex")+":"+scryptSync(p,salt,64).toString("hex")); rl.close()})'
```

Copy the hash to `ADMIN_PASSWORD_HASH` in `.env`, and use a long, unique password. The server automatically loads `.env` via dotenv. Never commit `.env`. `SECURE_COOKIES=1` is required behind HTTPS in production. Set a persistent `DB_PATH` and back up the database together with its WAL files (or use SQLite's backup API). The API process needs one persistent instance: in-memory sessions and rate limits do not coordinate across replicas and restart invalidates sessions.

## Flow

1. Student enters name and enrollment number (other contact details follow); the server recovers or creates a draft. Same name and enrollment on another device resumes it. Saves are debounced and serialized; final submission is immutable.
2. Student picks any combination of the 11 tracks, fills out each track's fields and reviews answers.
3. GitHub links are checked live via GitHub's public repository API and again on final submission. A private repository and a nonexistent one both appear as 404 without authorization; both are refused. GitHub outages/rate limits fail closed, not open.
4. The single admin signs in at `/login` with only a password, then reviews/searches/filters drafts and submitted entries at `/admin`.

## Security and launch caveats

**Do not launch publicly with sensitive drafts until recovery is strengthened.** Name + enrollment number is not an identity proof; anyone who knows both can view/edit that student's draft. This matches the requested recovery experience but is unsuitable for confidential submissions. Implement email OTP or an unguessable recovery code before production release (tracked in issue #3). The current API rate-limits lookups per client IP, but that does not solve impersonation. Keep this deployment internal until resolved. The recovery endpoint's errors may also reveal whether an enrollment exists.

Use HTTPS, secure cookies, reverse-proxy security headers and backups. Set `SECURE_COOKIES=1` for HTTPS. Password hashes use salted scrypt; admin sessions are httpOnly, SameSite=Strict and expire after 8 hours. Sessions/rate limits are in-memory; production should add shared durable session storage, persistent throttling, audit logs, CSRF defense against same-origin XSS, admin password rotation, access policy and data retention. Public link fields other than GitHub are not availability-checked. The provided track answer fields are initial examples; task-specific requirements need review with BYTE.

## CodeGraph

The project was initialized with `codegraph init .`. The generated `.codegraph/` index is local and ignored by git. After editing run `codegraph sync .`; inspect with `codegraph explore '<query>'`, `codegraph node <symbol>`, or CodeGraph agent tools.
