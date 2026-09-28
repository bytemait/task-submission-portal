import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRepository, repoCoordinates, validateSubmission } from './validation.ts';
import { emptySubmission } from '../shared/tracks.ts';

test('only exact GitHub repository URLs are accepted', () => {
  assert.deepEqual(repoCoordinates('https://github.com/bytemait/task-submission-portal'), { owner: 'bytemait', repo: 'task-submission-portal' });
  for (const url of ['https://github.com.evil.com/a/b', 'http://github.com/a/b', 'https://github.com/a/b/tree/main', 'https://github.com/a/b?query=1', 'https://github.com@evil.com/a/b', 'javascript:alert(1)']) assert.equal(repoCoordinates(url), null);
});
test('draft accepts partial answers; final requires selected track and contact', () => {
  const draft = emptySubmission(); draft.student.name = 'Test Student'; draft.student.enrollment = '12345678';
  assert.deepEqual(validateSubmission(draft, false), []);
  assert.ok(validateSubmission(draft, true).length > 0);
  draft.student.email = 'test@example.com'; draft.student.phone = '9876543210'; draft.student.year = '2nd year'; draft.selected = ['web-dev']; draft.answers['web-dev'] = { repo: 'https://github.com/bytemait/demo' };
  assert.deepEqual(validateSubmission(draft, true), []);
  draft.answers['web-dev'].repo = 'https://evil.com/repo';
  assert.ok(validateSubmission(draft, true).some(e => e.includes('GitHub')));
});
test('repository check rejects private, missing, and unavailable repos', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    assert.match((await checkRepository('https://github.com/a/b')).error!, /private or cannot be found/);
    globalThis.fetch = async () => new Response(JSON.stringify({ private: true }), { status: 200 });
    assert.match((await checkRepository('https://github.com/a/b')).error!, /private/);
    globalThis.fetch = async () => new Response(JSON.stringify({ private: false, visibility: 'public' }), { status: 200 });
    assert.equal((await checkRepository('https://github.com/a/b')).ok, true);
    globalThis.fetch = async () => { throw Error('network down'); };
    assert.equal((await checkRepository('https://github.com/a/b')).ok, false);
  } finally { globalThis.fetch = original; }
});
