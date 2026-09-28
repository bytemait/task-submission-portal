import 'dotenv/config';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tracks, type Submission } from '../shared/tracks.ts';
import { validateSubmission, checkRepository, normalizeEnrollment } from './validation.ts';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
const path = resolve(process.env.DB_PATH || './data/submissions.sqlite');
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS submissions (enrollment TEXT PRIMARY KEY, name_key TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT);');
const sessions = new Map<string, { role: 'admin' | 'draft'; enrollment?: string; expires: number }>();
const attempts = new Map<string, { count: number; until: number }>();
const secure = process.env.SECURE_COOKIES === '1';
const passwordHash = process.env.ADMIN_PASSWORD_HASH;
if (!passwordHash) console.warn('ADMIN_PASSWORD_HASH not configured; admin login disabled.');
function key(req: express.Request) { return req.ip || 'unknown'; }
function limited(req: express.Request, scope: string, max: number) {
  const id = scope + ':' + key(req), now = Date.now(), old = attempts.get(id);
  if (!old || old.until < now) { attempts.set(id, { count: 1, until: now + 15 * 60_000 }); return false; }
  old.count++;
  return old.count > max;
}
function cookies(req: express.Request) { return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p.length === 2)); }
function session(req: express.Request, type: 'admin' | 'draft') {
  const id = cookies(req)[type]; const s = id && sessions.get(id);
  if (!s || s.role !== type || s.expires < Date.now()) return null;
  return s;
}
function setSession(res: express.Response, role: 'admin' | 'draft', enrollment?: string) {
  const id = randomBytes(32).toString('hex');
  sessions.set(id, { role, enrollment, expires: Date.now() + (role === 'admin' ? 8 : 24) * 3600_000 });
  res.cookie(role, id, { httpOnly: true, secure, sameSite: 'strict', maxAge: (role === 'admin' ? 8 : 24) * 3600_000, path: '/' });
}
function clear(req: express.Request, res: express.Response, role: 'admin' | 'draft') {
  const id = cookies(req)[role]; if (id) sessions.delete(id);
  res.clearCookie(role, { path: '/', sameSite: 'strict', secure });
}
// Reject cross-origin writes. Dev proxy requests retain the browser's Origin
// while their Host becomes the API host, so explicitly allow configured UI origins.
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const host = req.get('host');
    try {
      if (origin && (!['http:', 'https:'].includes(new URL(origin).protocol) ||
        (new URL(origin).host !== host && !allowedOrigins.has(origin)))) {
        res.status(403).json({ error: 'Invalid origin.' }); return;
      }
    } catch { res.status(403).json({ error: 'Invalid origin.' }); return; }
  }
  next();
});
type Row = { enrollment: string; name_key: string; payload: string; status: string; updated_at: string; submitted_at: string | null };
const getRow = (enrollment: string) => db.prepare('SELECT * FROM submissions WHERE enrollment=?').get(enrollment) as Row | undefined;
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
app.get('/api/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); }
  catch { res.status(503).json({ status: 'unavailable' }); }
});
app.get('/api/tracks', (_req, res) => res.json(tracks));
app.post('/api/draft/recover', (req, res) => {
  if (limited(req, 'recover', 12)) { res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return; }
  const { name, enrollment } = req.body || {};
  if (typeof name !== 'string' || typeof enrollment !== 'string' || name.trim().length < 2 || name.length > 100 || !/^[a-zA-Z0-9/-]{4,30}$/.test(enrollment.trim())) { res.status(400).json({ error: 'Enter your full name and a valid enrollment number.' }); return; }
  const id = normalizeEnrollment(enrollment), row = getRow(id);
  if (row && row.name_key !== cleanName(name)) { res.status(409).json({ error: 'An entry exists for that enrollment number. Check your details or contact BYTE.' }); return; }
  if (row?.status === 'submitted') { res.status(409).json({ error: 'This enrollment number already has a final submission. Contact BYTE for changes.' }); return; }
  clear(req, res, 'draft'); setSession(res, 'draft', id);
  if (row) { res.json({ found: true, submission: JSON.parse(row.payload) }); return; }
  const initial: Submission = { student: { name: name.trim(), enrollment: id, email: '', phone: '', year: '' }, selected: [], answers: {}, status: 'draft' };
  const now = new Date().toISOString();
  db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?,NULL)').run(id, cleanName(name), JSON.stringify(initial), 'draft', now);
  res.json({ found: false, submission: initial });
});
app.get('/api/draft', (req, res) => {
  const s = session(req, 'draft'); if (!s) { res.status(401).json({ error: 'No active draft.' }); return; }
  const row = getRow(s.enrollment!); if (!row || row.status !== 'draft') { res.status(404).json({ error: 'Draft unavailable.' }); return; }
  res.json(JSON.parse(row.payload));
});
app.put('/api/draft', (req, res) => {
  const s = session(req, 'draft'); if (!s) { res.status(401).json({ error: 'Resume your draft to continue.' }); return; }
  const row = getRow(s.enrollment!); if (!row || row.status !== 'draft') { res.status(409).json({ error: 'This draft is already submitted.' }); return; }
  const payload = req.body as Submission;
  if (!payload || typeof payload.student?.enrollment !== 'string' || typeof payload.student?.name !== 'string' || normalizeEnrollment(payload.student.enrollment) !== s.enrollment || cleanName(payload.student.name) !== row.name_key) { res.status(400).json({ error: 'Name and enrollment cannot be changed after starting a draft.' }); return; }
  const errors = validateSubmission(payload, false);
  if (errors.length) { res.status(400).json({ error: errors[0] }); return; }
  const now = new Date().toISOString();
  db.prepare('UPDATE submissions SET payload=?,updated_at=? WHERE enrollment=? AND status=\'draft\'').run(JSON.stringify({ ...payload, status: 'draft', updatedAt: now }), now, s.enrollment);
  res.json({ updatedAt: now });
});
app.post('/api/repositories/check', async (req, res) => {
  if (limited(req, 'github', 60)) { res.status(429).json({ error: 'Too many checks. Please wait.' }); return; }
  const result = await checkRepository(req.body?.url);
  res.status(result.ok ? 200 : 422).json(result);
});
app.post('/api/draft/submit', async (req, res) => {
  const s = session(req, 'draft'); if (!s) { res.status(401).json({ error: 'Resume your draft first.' }); return; }
  const row = getRow(s.enrollment!); if (!row || row.status !== 'draft') { res.status(409).json({ error: 'Already submitted.' }); return; }
  const payload = JSON.parse(row.payload) as Submission;
  const errors = validateSubmission(payload, true);
  if (errors.length) { res.status(400).json({ error: errors[0] }); return; }
  for (const track of tracks.filter(t => payload.selected.includes(t.id))) for (const field of track.fields.filter(f => f.repo)) {
    const url = payload.answers[track.id]?.[field.key];
    if (url) { const result = await checkRepository(url); if (!result.ok) { res.status(422).json({ error: `${track.name}: ${result.error}` }); return; } }
  }
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE submissions SET payload=?,status=\'submitted\',updated_at=?,submitted_at=? WHERE enrollment=? AND status=\'draft\'').run(JSON.stringify({ ...payload, status: 'submitted', submittedAt: now, updatedAt: now }), now, now, s.enrollment);
  if (!result.changes) { res.status(409).json({ error: 'Already submitted.' }); return; }
  clear(req, res, 'draft'); res.json({ submittedAt: now });
});
app.post('/api/admin/login', (req, res) => {
  if (limited(req, 'login', 8)) { res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return; }
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length > 256 || !passwordHash || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash)) { res.status(401).json({ error: 'Invalid password.' }); return; }
  const [, salt, expected] = passwordHash.split(':');
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), 64);
  if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) { res.status(401).json({ error: 'Invalid password.' }); return; }
  clear(req, res, 'admin'); setSession(res, 'admin'); res.json({ ok: true });
});
app.get('/api/admin/session', (req, res) => res.json({ authenticated: !!session(req, 'admin') }));
app.post('/api/admin/logout', (req, res) => { clear(req, res, 'admin'); res.json({ ok: true }); });
app.get('/api/admin/submissions', (req, res) => {
  if (!session(req, 'admin')) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
  const rows = db.prepare('SELECT * FROM submissions ORDER BY updated_at DESC').all() as Row[];
  res.json(rows.map(row => ({ ...JSON.parse(row.payload), updatedAt: row.updated_at, submittedAt: row.submitted_at })));
});
const dist = resolve('./dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '0.0.0.0', () => console.log(`BYTE API listening on port ${port}`));
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing server and database.`);
  server.close(error => {
    try { db.close(); }
    catch (closeError) { console.error('Failed to close SQLite database cleanly:', closeError); process.exitCode = 1; }
    if (error) { console.error('Failed to close HTTP server cleanly:', error); process.exitCode = 1; }
  });
  setTimeout(() => { console.error('Graceful shutdown timed out.'); process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
