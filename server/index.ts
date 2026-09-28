import 'dotenv/config';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tracks, type Submission } from '../shared/tracks.ts';
import { validateSubmission, checkRepository, normalizeEnrollment, normalizeStudentProfile, studentToProfileData, isSubmissionProfileComplete, checkDriveAccessibility } from './validation.ts';
import { buildSubmissionsCsv, buildSubmissionsJson } from './export.ts';
import { validateProfile } from '../shared/validation.ts';
import { deptConfigs, getDeptConfig } from '../shared/submissionConfig.ts';

// ── Submission window (server-side enforcement) ─────────────────────────────
const SUBMISSION_OPENS = new Date(process.env.SUBMISSION_OPENS_AT || '2025-09-29T00:01:00+05:30');
const SUBMISSION_CLOSES_STR = process.env.SUBMISSION_CLOSES_AT || '';
const SUBMISSION_CLOSES = SUBMISSION_CLOSES_STR ? new Date(SUBMISSION_CLOSES_STR) : null;
function isSubmissionWindowOpen(): boolean {
  const now = Date.now();
  if (now < SUBMISSION_OPENS.getTime()) return false;
  if (SUBMISSION_CLOSES && now > SUBMISSION_CLOSES.getTime()) return false;
  return true;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
const path = resolve(process.env.DB_PATH || './data/submissions.sqlite');
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS submissions (enrollment TEXT PRIMARY KEY, name_key TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, submitted_at TEXT);');

// ── Migration: add profile_completed_at column (idempotent) ─────────────────
try {
  // Check if column exists by querying table info
  const cols = db.prepare("PRAGMA table_info(submissions)").all() as { name: string }[];
  if (!cols.some(c => c.name === 'profile_completed_at')) {
    db.exec('ALTER TABLE submissions ADD COLUMN profile_completed_at TEXT;');
    console.log('Migration: added profile_completed_at column.');
  }
} catch (e) {
  console.error('Migration check failed:', e);
}

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
const isDev = process.env.NODE_ENV !== 'production';
const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001'];
const allowedOrigins = new Set([
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
  ...(isDev ? defaultDevOrigins : []),
]);

app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const host = req.get('host');
    try {
      if (origin) {
        const originUrl = new URL(origin);
        if (!['http:', 'https:'].includes(originUrl.protocol)) {
          res.status(403).json({ error: 'Invalid origin.' }); return;
        }
        const isAllowed = originUrl.host === host ||
          allowedOrigins.has(origin) ||
          (isDev && (
            originUrl.hostname === 'localhost' ||
            originUrl.hostname === '127.0.0.1' ||
            originUrl.hostname.startsWith('192.168.') ||
            originUrl.hostname.startsWith('10.') ||
            originUrl.hostname.endsWith('.local')
          ));
        if (!isAllowed) {
          res.status(403).json({ error: 'Invalid origin.' }); return;
        }
      }
    } catch { res.status(403).json({ error: 'Invalid origin.' }); return; }
  }
  next();
});
type Row = { enrollment: string; name_key: string; payload: string; status: string; updated_at: string; submitted_at: string | null; profile_completed_at: string | null };
const getRow = (enrollment: string) => db.prepare('SELECT * FROM submissions WHERE enrollment=?').get(enrollment) as Row | undefined;
const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
app.get('/api/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); }
  catch { res.status(503).json({ status: 'unavailable' }); }
});
app.get('/api/tracks', (_req, res) => res.json(tracks));
app.get('/api/config/window', (_req, res) => res.json({
  opens: SUBMISSION_OPENS.toISOString(),
  closes: SUBMISSION_CLOSES ? SUBMISSION_CLOSES.toISOString() : null,
  isOpen: isSubmissionWindowOpen(),
}));
app.get('/api/config/departments', (_req, res) => res.json(deptConfigs.map(d => ({
  id: d.id, name: d.name, category: d.category, color: d.color, comingSoon: d.comingSoon || false,
}))));

// ── Profile endpoints ───────────────────────────────────────────────────────
app.get('/api/profile', (req, res) => {
  const s = session(req, 'draft');
  if (!s) { res.status(401).json({ error: 'Sign in to view your profile.' }); return; }
  const row = getRow(s.enrollment!);
  if (!row) { res.status(404).json({ error: 'No profile found.' }); return; }
  const submission = JSON.parse(row.payload) as Submission;
  res.json({
    profile: submission.student,
    profileComplete: isSubmissionProfileComplete(submission),
    profileCompletedAt: row.profile_completed_at || submission.profileCompletedAt || null,
    updatedAt: row.updated_at,
  });
});

app.put('/api/profile', (req, res) => {
  const s = session(req, 'draft');
  if (!s) { res.status(401).json({ error: 'Sign in to update your profile.' }); return; }
  if (limited(req, 'profile:' + (s.enrollment || key(req)), 30)) {
    res.status(429).json({ error: 'Too many updates. Please wait a few minutes.' }); return;
  }
  const row = getRow(s.enrollment!);
  if (!row) { res.status(404).json({ error: 'No draft found. Start a new submission first.' }); return; }
  if (row.status === 'submitted') { res.status(409).json({ error: 'Already submitted. Profile cannot be changed.' }); return; }

  // Optimistic concurrency: if client sends updatedAt, verify it matches
  const clientUpdatedAt = req.body?.updatedAt;
  if (clientUpdatedAt && clientUpdatedAt !== row.updated_at) {
    res.status(409).json({ error: 'This profile was updated in another tab. Refresh to see the latest version.' }); return;
  }

  const existing = JSON.parse(row.payload) as Submission;
  const body = req.body?.profile;
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Invalid profile data.' }); return; }

  // Reject unknown fields
  const allowed = new Set(['name', 'email', 'phone', 'enrollment', 'academicBranch', 'year', 'semester', 'inOtherSocieties', 'societies', 'instagram', 'twitter', 'discord']);
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) { res.status(400).json({ error: `Unknown field: ${k}` }); return; }
  }

  // Name and enrollment cannot change after draft creation
  if (body.name !== undefined && cleanName(body.name) !== row.name_key) {
    res.status(400).json({ error: 'Name cannot be changed after starting a draft.' }); return;
  }
  if (body.enrollment !== undefined && normalizeEnrollment(body.enrollment) !== s.enrollment) {
    res.status(400).json({ error: 'Enrollment cannot be changed after starting a draft.' }); return;
  }

  // Merge profile fields
  const updatedStudent = {
    ...existing.student,
    email: body.email !== undefined ? body.email : existing.student.email,
    phone: body.phone !== undefined ? body.phone : existing.student.phone,
    academicBranch: body.academicBranch !== undefined ? body.academicBranch : existing.student.academicBranch,
    year: body.year !== undefined ? body.year : existing.student.year,
    semester: body.semester !== undefined ? body.semester : existing.student.semester,
    inOtherSocieties: body.inOtherSocieties !== undefined ? body.inOtherSocieties : existing.student.inOtherSocieties,
    societies: body.societies !== undefined ? body.societies : existing.student.societies,
    instagram: body.instagram !== undefined ? body.instagram : existing.student.instagram,
    twitter: body.twitter !== undefined ? body.twitter : existing.student.twitter,
    discord: body.discord !== undefined ? body.discord : existing.student.discord,
  };

  // Normalize server-side
  const normalized = normalizeStudentProfile(updatedStudent);

  // Validate
  const profileData = studentToProfileData(normalized);
  const errors = validateProfile(profileData);

  // Allow saving with errors (partial save) but track completion
  const complete = Object.keys(errors).length === 0;
  const now = new Date().toISOString();
  const updatedSubmission: Submission = {
    ...existing,
    student: normalized,
    profileCompletedAt: complete ? (existing.profileCompletedAt || now) : undefined,
    updatedAt: now,
  };

  db.prepare('UPDATE submissions SET payload=?,updated_at=?,profile_completed_at=? WHERE enrollment=? AND status=\'draft\'')
    .run(JSON.stringify(updatedSubmission), now, complete ? (row.profile_completed_at || now) : null, s.enrollment);

  // Return field errors for client-side display (but still save)
  res.json({
    updatedAt: now,
    profileComplete: complete,
    profileCompletedAt: complete ? (row.profile_completed_at || now) : null,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
});

app.post('/api/draft/recover', (req, res) => {
  if (limited(req, 'recover', 12)) { res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return; }
  const { name, enrollment } = req.body || {};
  if (typeof name !== 'string' || typeof enrollment !== 'string' || name.trim().length < 2 || name.length > 100 || !/^[a-zA-Z0-9/-]{4,30}$/.test(enrollment.trim())) { res.status(400).json({ error: 'Enter your full name and a valid enrollment number.' }); return; }
  const id = normalizeEnrollment(enrollment), row = getRow(id);
  if (row && row.name_key !== cleanName(name)) { res.status(409).json({ error: 'An entry exists for that enrollment number. Check your details or contact BYTE.' }); return; }
  if (row?.status === 'submitted') { res.status(409).json({ error: 'This enrollment number already has a final submission. Contact BYTE for changes.' }); return; }
  clear(req, res, 'draft'); setSession(res, 'draft', id);
  if (row) { res.json({ found: true, submission: JSON.parse(row.payload) }); return; }
  const initial: Submission = {
    student: {
      name: name.trim(),
      enrollment: id,
      email: '',
      phone: '',
      dept: '',
      year: '',
      semester: '',
      academicBranch: '',
      inOtherSocieties: false,
      societies: [],
      instagram: '',
      twitter: '',
      discord: '',
      otherSocieties: '',
      socials: { instagram: '', twitter: '', discord: '' },
    },
    selected: [],
    answers: {},
    deptAnswers: {},
    deptSelected: {},
    status: 'draft'
  };
  const now = new Date().toISOString();
  db.prepare('INSERT INTO submissions VALUES (?,?,?,?,?,NULL,NULL)').run(id, cleanName(name), JSON.stringify(initial), 'draft', now);
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

  // Server-side submission window check
  if (!isSubmissionWindowOpen()) {
    const now = Date.now();
    if (now < SUBMISSION_OPENS.getTime()) {
      res.status(403).json({ error: `Submissions open on ${SUBMISSION_OPENS.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. Please wait.` }); return;
    }
    res.status(403).json({ error: 'The submission window has closed. Contact BYTE if you need assistance.' }); return;
  }

  const row = getRow(s.enrollment!); if (!row || row.status !== 'draft') { res.status(409).json({ error: 'Already submitted.' }); return; }
  const payload = JSON.parse(row.payload) as Submission;

  // Gate on profile completion
  if (!isSubmissionProfileComplete(payload)) {
    res.status(403).json({ error: 'Complete your applicant profile (Step 1) before submitting.' }); return;
  }

  const errors = validateSubmission(payload, true);
  if (errors.length) { res.status(400).json({ error: errors[0] }); return; }
  for (const track of tracks.filter(t => payload.selected.includes(t.id))) for (const field of track.fields.filter(f => f.repo)) {
    const url = payload.answers[track.id]?.[field.key];
    if (url) { const result = await checkRepository(url); if (!result.ok) { res.status(422).json({ error: `${track.name}: ${result.error}` }); return; } }
  }

  // Best-effort Drive accessibility check (non-blocking warning)
  const warnings: string[] = [];
  const deptAnswers = payload.deptAnswers || {};
  for (const deptId of payload.selected) {
    const config = getDeptConfig(deptId);
    if (!config) continue;
    for (const field of config.globalFields) {
      if (field.urlType === 'drive-folder' && deptAnswers[deptId]?.[field.key]) {
        const warning = await checkDriveAccessibility(String(deptAnswers[deptId][field.key]));
        if (warning) warnings.push(`${config.name}: ${warning}`);
      }
    }
  }

  // Check GitHub repos from dept answers too
  for (const deptId of payload.selected) {
    const config = getDeptConfig(deptId);
    if (!config) continue;
    const answers = deptAnswers[deptId] || {};
    for (const field of [...config.globalFields, ...config.tasks.flatMap(t => t.fields)]) {
      if (field.urlType === 'github' && answers[field.key]) {
        const result = await checkRepository(answers[field.key]);
        if (!result.ok) { res.status(422).json({ error: `${config.name}: ${result.error}` }); return; }
      }
    }
  }

  const now = new Date().toISOString();
  const result = db.prepare('UPDATE submissions SET payload=?,status=\'submitted\',updated_at=?,submitted_at=? WHERE enrollment=? AND status=\'draft\'').run(JSON.stringify({ ...payload, status: 'submitted', submittedAt: now, updatedAt: now }), now, now, s.enrollment);
  if (!result.changes) { res.status(409).json({ error: 'Already submitted.' }); return; }
  clear(req, res, 'draft'); res.json({ submittedAt: now, warnings: warnings.length ? warnings : undefined });
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
app.get('/api/admin/export.csv', (req, res) => {
  if (!session(req, 'admin')) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
  const rows = db.prepare('SELECT * FROM submissions ORDER BY status DESC, updated_at DESC').all() as Row[];
  const submissions: Submission[] = rows.map(row => ({ ...JSON.parse(row.payload), updatedAt: row.updated_at, submittedAt: row.submitted_at }));
  const csv = buildSubmissionsCsv(submissions);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="byte-submissions-${date}.csv"`);
  res.send(csv);
});
app.get('/api/admin/export.json', (req, res) => {
  if (!session(req, 'admin')) { res.status(401).json({ error: 'Sign in to continue.' }); return; }
  const rows = db.prepare('SELECT * FROM submissions ORDER BY status DESC, updated_at DESC').all() as Row[];
  const submissions: Submission[] = rows.map(row => ({ ...JSON.parse(row.payload), updatedAt: row.updated_at, submittedAt: row.submitted_at }));
  const json = buildSubmissionsJson(submissions);
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="byte-submissions-${date}.json"`);
  res.send(json);
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
