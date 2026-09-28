import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function freePort() { const socket = net.createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve)); const address = socket.address(); const port = typeof address === 'object' && address ? address.port : 0; socket.close(); return port; }
test('API: draft recovery, autosave, immutable submission and admin access', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'byte-test-'));
  const port = await freePort();
  const salt = randomBytes(16); const password = 'test-admin-password';
  const hash = `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  const process = spawn('node', ['--import', 'tsx', 'server/index.ts'], { env: { ...globalThis.process.env, PORT: String(port), DB_PATH: join(dir, 'test.sqlite'), ADMIN_PASSWORD_HASH: hash }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api`;
  async function call(path: string, method = 'GET', body?: unknown, cookie = '') { const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() as any }; }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { await call('/tracks'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    assert.ok(ready, 'server started');
    assert.equal((await call('/health')).response.status, 200);
    assert.equal((await call('/admin/submissions')).response.status, 401);
    const foreignOrigin = await fetch(base + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ password }) });
    assert.equal(foreignOrigin.status, 403);
    const created = await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '12345678' });
    assert.equal(created.data.found, false);
    const cookie = created.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    const draft = created.data.submission;
    draft.student.email = 'test@example.com'; draft.student.phone = '9876543210'; draft.student.dept = 'CSE'; draft.student.year = '2nd year (Sem 3)';
    draft.selected = ['graphic-design']; draft.answers = { 'graphic-design': { work: 'https://example.com/portfolio' } };
    assert.equal((await call('/draft', 'PUT', draft, cookie)).response.status, 200);
    const recovered = await call('/draft/recover', 'POST', { name: 'test   student', enrollment: '12345678' });
    assert.equal(recovered.data.found, true);
    assert.equal(recovered.data.submission.answers['graphic-design'].work, draft.answers['graphic-design'].work);
    const recoveredCookie = recovered.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    assert.equal((await call('/draft/submit', 'POST', {}, recoveredCookie)).response.status, 200);
    assert.equal((await call('/draft', 'PUT', draft, recoveredCookie)).response.status, 401);
    assert.equal((await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '12345678' })).response.status, 409);
    assert.equal((await call('/admin/login', 'POST', { password: 'wrong' })).response.status, 401);
    const login = await call('/admin/login', 'POST', { password });
    assert.equal(login.response.status, 200);
    const adminCookie = login.response.headers.getSetCookie().find(c => c.startsWith('admin=') && !c.startsWith('admin=;'))?.split(';')[0] || '';
    const listing = await call('/admin/submissions', 'GET', undefined, adminCookie);
    assert.equal(listing.data.length, 1);
    assert.equal(listing.data[0].status, 'submitted');

    // Test unauthenticated export
    const unauthExport = await fetch(base + '/admin/export.csv');
    assert.equal(unauthExport.status, 401);

    // Test authenticated CSV export
    const csvExport = await fetch(base + '/admin/export.csv', { headers: { cookie: adminCookie } });
    assert.equal(csvExport.status, 200);
    assert.ok(csvExport.headers.get('content-type')?.includes('text/csv'));
    const csvText = await csvExport.text();
    assert.ok(csvText.includes('12345678,Test Student,test@example.com'));
    assert.ok(csvText.includes('https://example.com/portfolio'));

    // Test authenticated JSON export
    const jsonExport = await fetch(base + '/admin/export.json', { headers: { cookie: adminCookie } });
    assert.equal(jsonExport.status, 200);
    assert.ok(jsonExport.headers.get('content-type')?.includes('application/json'));
    const jsonData = await jsonExport.json() as any[];
    assert.equal(jsonData.length, 1);
    assert.equal(jsonData[0].student.enrollment, '12345678');

    await call('/admin/logout', 'POST', {}, adminCookie);
    assert.equal((await call('/admin/submissions', 'GET', undefined, adminCookie)).response.status, 401);
  } finally { process.kill(); rmSync(dir, { recursive: true, force: true }); }
});
