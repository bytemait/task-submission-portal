import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function freePort() { const socket = net.createServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve)); const address = socket.address(); const port = typeof address === 'object' && address ? address.port : 0; socket.close(); return port; }
test('API: draft recovery, autosave, immutable submission and admin management', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'byte-test-'));
  const port = await freePort();
  const salt = randomBytes(16); const password = 'test-admin-password';
  const hash = `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  const process = spawn('node', ['--import', 'tsx', 'server/index.ts'], { env: { ...globalThis.process.env, PORT: String(port), DB_PATH: join(dir, 'test.sqlite'), ADMIN_PASSWORD_HASH: hash, SUBMISSION_OPENS_AT: '2020-01-01T00:00:00Z', SUBMISSION_CLOSES_AT: '' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api`;
  async function call(path: string, method = 'GET', body?: unknown, cookie = '') { const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { response, data: await response.json() as any }; }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { await call('/tracks'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    assert.ok(ready, 'server started');
    assert.equal((await call('/health')).response.status, 200);
    assert.equal((await call('/admin/submissions')).response.status, 401);
    const foreignOrigin = await fetch(base + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ password }) });
    const invalidRecover = await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '' });
    assert.equal(invalidRecover.response.status, 400);
    for (const enrollment of ['   ', '123456789012345']) {
      assert.equal((await call('/draft/recover', 'POST', { name: 'Test Student', enrollment })).response.status, 400);
    }
    const created = await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '12345678901' });
    assert.equal(created.data.found, false);
    const cookie = created.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    const draft = created.data.submission;
    draft.student.email = 'test@example.com'; draft.student.phone = '9876543210'; draft.student.dept = 'CSE'; draft.student.year = '2nd year (Sem 3)';
    draft.student.semester = '3'; draft.student.academicBranch = 'CSE';
    draft.selected = ['outreach']; draft.answers = { 'outreach': { work: 'https://example.com/portfolio' } };
    draft.deptAnswers = { outreach: {
      docUrl: 'https://drive.google.com/file/d/abc123',
      docPublic: true, fileName: true, taskOrder: true,
      noRealContact: true, limitsRespected: true, llmDisclosure: true, q6Real: true,
    } };
    assert.equal((await call('/draft', 'PUT', draft, cookie)).response.status, 200);
    // Test draft logout
    const logoutRes = await call('/draft/logout', 'POST', {}, cookie);
    assert.equal(logoutRes.response.status, 200);
    const clearedDraftCookie = logoutRes.response.headers.getSetCookie().find(c => c.startsWith('draft=;'));
    assert.ok(clearedDraftCookie, 'draft cookie cleared');
    assert.equal((await call('/draft', 'GET', undefined, clearedDraftCookie)).response.status, 401);

    const recovered = await call('/draft/recover', 'POST', { name: 'test   student', enrollment: '12345678901' });
    assert.equal(recovered.data.found, true);
    assert.equal(recovered.data.submission.answers['outreach'].work, draft.answers['outreach'].work);
    const recoveredCookie = recovered.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    assert.equal((await call('/draft/submit', 'POST', {}, recoveredCookie)).response.status, 200);
    assert.equal((await call('/draft', 'PUT', draft, recoveredCookie)).response.status, 401);
    assert.equal((await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '12345678901' })).response.status, 409);
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
    assert.ok(csvText.includes('12345678901,Test Student,test@example.com'));
    assert.ok(csvText.includes('https://drive.google.com/file/d/abc123'));

    // Test authenticated JSON export
    const jsonExport = await fetch(base + '/admin/export.json', { headers: { cookie: adminCookie } });
    assert.equal(jsonExport.status, 200);
    assert.ok(jsonExport.headers.get('content-type')?.includes('application/json'));
    const jsonData = await jsonExport.json() as any[];
    assert.equal(jsonData.length, 1);
    assert.equal(jsonData[0].student.enrollment, '12345678901');

    const exportRes = await fetch(base + '/admin/export.csv', { headers: { cookie: adminCookie } });
    assert.equal(exportRes.status, 200);
    const csv = await exportRes.text();
    assert.ok(csv.includes('Name,Email,Phone'));
    assert.ok(csv.includes('Test Student'));
    assert.ok(csv.includes('Outreach'));
    // Admin mutations reject anonymous users, student sessions, and cross-origin writes.
    const entryPath = '/admin/submissions/12345678901';
    for (const unauthorizedCookie of ['', cookie]) {
      assert.equal((await call(entryPath, 'PATCH', { status: 'draft' }, unauthorizedCookie)).response.status, 401);
      assert.equal((await call(entryPath, 'DELETE', undefined, unauthorizedCookie)).response.status, 401);
    }
    for (const method of ['PATCH', 'DELETE']) {
      const response = await fetch(base + entryPath, {
        method, headers: { 'Content-Type': 'application/json', cookie: adminCookie, Origin: 'https://evil.example' },
        ...(method === 'PATCH' ? { body: JSON.stringify({ status: 'draft' }) } : {}),
      });
      assert.equal(response.status, 403);
    }
    assert.equal((await call('/admin/submissions', 'PATCH', { status: 'draft' }, adminCookie)).response.status, 400);
    assert.equal((await call('/admin/submissions', 'DELETE', {}, adminCookie)).response.status, 400);
    assert.equal((await call(entryPath, 'PATCH', { status: 'submitted' }, adminCookie)).response.status, 400);
    assert.equal((await call(entryPath, 'PATCH', {}, adminCookie)).response.status, 400);
    assert.equal((await call('/admin/submissions/99999999999', 'PATCH', { status: 'draft' }, adminCookie)).response.status, 404);
    assert.equal((await call('/admin/submissions/99999999999', 'DELETE', undefined, adminCookie)).response.status, 404);
    assert.equal((await call('/admin/submissions', 'GET', undefined, adminCookie)).data[0].status, 'submitted');

    // Moving back to draft preserves all answers/profile data and clears final timestamps.
    const moved = await call(entryPath, 'PATCH', { status: 'draft' }, adminCookie);
    assert.equal(moved.response.status, 200);
    assert.equal(moved.data.status, 'draft');
    assert.equal(moved.data.submittedAt, undefined);
    assert.ok(moved.data.updatedAt >= listing.data[0].updatedAt);
    assert.deepEqual(moved.data.student, listing.data[0].student);
    assert.deepEqual(moved.data.answers, listing.data[0].answers);
    assert.deepEqual(moved.data.deptAnswers, listing.data[0].deptAnswers);
    assert.deepEqual(moved.data.deptSelected, listing.data[0].deptSelected);
    assert.equal((await call(entryPath, 'PATCH', { status: 'draft' }, adminCookie)).response.status, 409);
    const draftListing = await call('/admin/submissions', 'GET', undefined, adminCookie);
    assert.equal(draftListing.data[0].status, 'draft');
    assert.equal(draftListing.data[0].submittedAt, null);
    const draftExport = await call('/admin/export.json', 'GET', undefined, adminCookie);
    assert.equal(draftExport.data[0].status, 'draft');
    assert.equal(draftExport.data[0].submittedAt, null);
    const resumed = await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '12345678901' });
    assert.equal(resumed.data.found, true);
    assert.equal(resumed.data.submission.status, 'draft');
    assert.equal(resumed.data.submission.submittedAt, undefined);
    const resumedCookie = resumed.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    resumed.data.submission.student.email = 'updated@example.com';
    assert.equal((await call('/draft', 'PUT', resumed.data.submission, resumedCookie)).response.status, 200);
    assert.equal((await call('/draft/submit', 'POST', {}, resumedCookie)).response.status, 200);

    // Submitted entries can be deleted and disappear from listings/exports.
    assert.equal((await call(entryPath, 'DELETE', undefined, adminCookie)).response.status, 200);
    assert.equal((await call(entryPath, 'DELETE', undefined, adminCookie)).response.status, 404);
    assert.deepEqual((await call('/admin/submissions', 'GET', undefined, adminCookie)).data, []);
    assert.deepEqual((await call('/admin/export.json', 'GET', undefined, adminCookie)).data, []);
    const emptyCsv = await fetch(base + '/admin/export.csv', { headers: { cookie: adminCookie } });
    assert.ok(!(await emptyCsv.text()).includes('12345678901'));

    // Drafts can also be deleted; stale student sessions cannot access a recreated entry.
    const replacement = await call('/draft/recover', 'POST', { name: 'Test Student', enrollment: '12345678901' });
    assert.equal(replacement.data.found, false);
    assert.deepEqual(replacement.data.submission.answers, {});
    const replacementCookie = replacement.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    assert.equal((await call(entryPath, 'DELETE', undefined, adminCookie)).response.status, 200);
    assert.equal((await call('/draft', 'GET', undefined, replacementCookie)).response.status, 401);
    assert.equal((await call('/draft/recover', 'POST', { name: 'New Student', enrollment: '12345678901' })).data.found, false);
    assert.equal((await call('/draft', 'GET', undefined, replacementCookie)).response.status, 401);
    assert.equal((await call('/draft', 'PUT', replacement.data.submission, replacementCookie)).response.status, 401);
    assert.equal((await call('/profile', 'GET', undefined, replacementCookie)).response.status, 401);

    // Both enrollment length boundaries work through recovery, autosave and profile validation.
    for (const enrollment of ['1', '12345678901234']) {
      const shortDraft = await call('/draft/recover', 'POST', { name: 'Short Roll Student', enrollment });
      assert.equal(shortDraft.response.status, 200);
      const shortCookie = shortDraft.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
      const payload = { ...draft, student: { ...draft.student, name: 'Short Roll Student', enrollment, year: '4' } };
      // A fresh profile needs only a semester; the API persists the derived year.
      for (const [semester, year] of [['1', '1'], ['2', '1'], ['3', '2'], ['4', '2'], ['5', '3']]) {
        const { year: _ignored, ...studentProfile } = payload.student;
        const profile = await call('/profile', 'PUT', { profile: { ...studentProfile, semester } }, shortCookie);
        assert.equal(profile.response.status, 200);
        assert.equal(profile.data.profileComplete, true);
        const stored = await call('/draft', 'GET', undefined, shortCookie);
        assert.equal(stored.data.student.semester, semester);
        assert.equal(stored.data.student.year, year);
      }
      assert.equal((await call('/draft', 'PUT', payload, shortCookie)).response.status, 200);
      assert.equal((await call('/draft', 'GET', undefined, shortCookie)).data.student.year, '2');
      assert.equal((await call('/draft/submit', 'POST', {}, shortCookie)).response.status, 200);
    }

    // Special enrollment numbers such as ".." work via body/query without path collapse issues.
    const dotDraft = await call('/draft/recover', 'POST', { name: 'Dot Student', enrollment: '..' });
    assert.equal(dotDraft.response.status, 200);
    const dotCookie = dotDraft.response.headers.getSetCookie().find(c => c.startsWith('draft=') && !c.startsWith('draft=;'))?.split(';')[0] || '';
    const dotPayload = { ...draft, student: { ...draft.student, name: 'Dot Student', enrollment: '..' } };
    assert.equal((await call('/draft', 'PUT', dotPayload, dotCookie)).response.status, 200);
    assert.equal((await call('/draft/submit', 'POST', {}, dotCookie)).response.status, 200);
    // Admin moves ".." to draft via request body
    const dotMoved = await call('/admin/submissions', 'PATCH', { enrollment: '..', status: 'draft' }, adminCookie);
    assert.equal(dotMoved.response.status, 200);
    assert.equal(dotMoved.data.status, 'draft');
    // Admin deletes ".." via request body
    assert.equal((await call('/admin/submissions', 'DELETE', { enrollment: '..' }, adminCookie)).response.status, 200);
    assert.equal((await call('/admin/submissions', 'DELETE', { enrollment: '..' }, adminCookie)).response.status, 404);

    await call('/admin/logout', 'POST', {}, adminCookie);
    assert.equal((await call('/admin/submissions', 'GET', undefined, adminCookie)).response.status, 401);
  } finally { process.kill(); rmSync(dir, { recursive: true, force: true }); }
});
