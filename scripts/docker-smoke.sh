#!/usr/bin/env bash
set -euo pipefail

# Run against a disposable Compose project only. No real credentials/data are used.
cd "$(dirname "$0")/.."
command -v docker >/dev/null
project="byte-smoke-$$"
tmp="$(mktemp -d)"
trap 'docker compose --project-name "$project" --env-file "$tmp/.env" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

# Compose needs an env_file in its project directory; a disposable copy ensures
# the smoke test never reads or overwrites the operator's real .env.
cp compose.yaml "$tmp/compose.yaml"
cp Dockerfile "$tmp/Dockerfile"
cp .dockerignore package.json package-lock.json index.html tsconfig.json vite.config.ts "$tmp/"
cp -R src shared server scripts "$tmp/"
password='docker-smoke-admin'
hash="$(node -e 'const {randomBytes,scryptSync}=require("node:crypto");const salt=randomBytes(16);console.log(`scrypt:${salt.toString("hex")}:${scryptSync(process.argv[1],salt,64).toString("hex")}`)' "$password")"
host_port="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
printf 'ADMIN_PASSWORD_HASH=%s\nSECURE_COOKIES=0\nBIND_ADDRESS=127.0.0.1\nHOST_PORT=%s\n' "$hash" "$host_port" > "$tmp/.env"
chmod 600 "$tmp/.env"

compose=(docker compose --project-directory "$tmp" --project-name "$project" --env-file "$tmp/.env")
"${compose[@]}" up --build -d
port="$("${compose[@]}" port app 3001 | awk -F: '{print $NF}')"
url="http://127.0.0.1:$port"
export SMOKE_URL="$url" SMOKE_PASSWORD="$password"
for i in $(seq 1 60); do
  if curl --silent --fail "$url/api/health" >/dev/null; then break; fi
  if (( i == 60 )); then "${compose[@]}" logs; exit 1; fi
  sleep 1
done
uid="$("${compose[@]}" exec -T app id -u | tr -d '\r')"
if [[ "$uid" == 0 ]]; then echo 'Container must not run as root' >&2; exit 1; fi
"${compose[@]}" exec -T app sh -c 'test ! -e /app/.env && test -w /app/data'
if "${compose[@]}" exec -T app sh -c 'touch /app/should-not-write'; then echo 'Container root filesystem must be read-only' >&2; exit 1; fi
node --input-type=module <<'NODE'
const url = process.env.SMOKE_URL;
const password = process.env.SMOKE_PASSWORD;
async function request(route, method = 'GET', body, cookie = '', origin = url) {
  return fetch(url + route, { method, headers: { 'Content-Type': 'application/json', cookie, Origin: origin }, body: body === undefined ? undefined : JSON.stringify(body) });
}
for (const route of ['/', '/login', '/admin', '/api/tracks']) {
  const response = await request(route);
  if (response.status !== 200) throw Error(`${route}: ${response.status}`);
}
if ((await request('/api/admin/submissions')).status !== 401) throw Error('Admin API exposed');
if ((await request('/api/admin/login', 'POST', { password }, '', 'https://attacker.invalid')).status !== 403) throw Error('Cross-origin write accepted');
const login = await request('/api/admin/login', 'POST', { password });
if (login.status !== 200) throw Error(`Admin login failed: ${login.status}`);
const adminCookie = login.headers.getSetCookie().find(c => c.startsWith('admin=') && !c.startsWith('admin=;'))?.split(';')[0] || '';
if (!adminCookie || (await request('/api/admin/submissions', 'GET', undefined, adminCookie)).status !== 200) throw Error('Authenticated admin API unavailable');
const initial = await request('/api/draft/recover', 'POST', { name: 'Smoke Student', enrollment: '12345678901' });
if (initial.status !== 200) throw Error('Draft create failed');
const draftCookie = initial.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
const draft = (await initial.json()).submission;
draft.student.email = 'smoke@example.invalid';
if ((await request('/api/draft', 'PUT', draft, draftCookie)).status !== 200) throw Error('Draft save failed');
console.log('HTTP routes, auth, CSRF rejection and draft save: OK');
NODE

# Recreate the container (not the named volume) to verify durable storage.
"${compose[@]}" up -d --force-recreate --no-deps app
for i in $(seq 1 60); do
  if curl --silent --fail "$url/api/health" >/dev/null; then break; fi
  if (( i == 60 )); then "${compose[@]}" logs; exit 1; fi
  sleep 1
done
node --input-type=module <<'NODE'
const url = process.env.SMOKE_URL;
const response = await fetch(url + '/api/draft/recover', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ name: 'Smoke Student', enrollment: '12345678901' }) });
const result = await response.json();
if (response.status !== 200 || !result.found || result.submission.student.email !== 'smoke@example.invalid') throw Error('Draft did not survive container recreation');
console.log('Persistent draft after recreation: OK');
NODE

"${compose[@]}" exec -T -e BACKUP_PATH=/app/data/smoke-backup.sqlite app node scripts/backup-db.mjs
"${compose[@]}" stop app
"${compose[@]}" run --rm --no-deps --entrypoint node app -e 'const fs=require("node:fs"); for(const f of ["/app/data/submissions.sqlite","/app/data/submissions.sqlite-wal","/app/data/submissions.sqlite-shm"])try{fs.rmSync(f)}catch(e){if(e.code!=="ENOENT")throw e}; fs.copyFileSync("/app/data/smoke-backup.sqlite","/app/data/submissions.sqlite")'
"${compose[@]}" up -d --no-deps app
for i in $(seq 1 60); do
  if curl --silent --fail "$url/api/health" >/dev/null; then break; fi
  if (( i == 60 )); then "${compose[@]}" logs; exit 1; fi
  sleep 1
done
node --input-type=module <<'NODE'
const url = process.env.SMOKE_URL;
const response = await fetch(url + '/api/draft/recover', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ name: 'Smoke Student', enrollment: '12345678901' }) });
const result = await response.json();
if (response.status !== 200 || !result.found || result.submission.student.email !== 'smoke@example.invalid') throw Error('Restored backup did not contain the draft');
console.log('Consistent backup restore: OK');
NODE
