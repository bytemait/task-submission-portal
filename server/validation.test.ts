import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRepository, repoCoordinates, validateSubmission, isSubmissionProfileComplete } from './validation.ts';
import { emptySubmission } from '../shared/tracks.ts';
import {
  normalizePhone, validatePhone, normalizeInstagram, normalizeTwitter,
  normalizeDiscord, validateInstagram, validateTwitter, validateDiscord,
  validateSemester, validateYear, validateSocieties, validateProfile,
  isProfileComplete,
} from '../shared/validation.ts';

test('only exact GitHub repository URLs are accepted', () => {
  assert.deepEqual(repoCoordinates('https://github.com/bytemait/task-submission-portal'), { owner: 'bytemait', repo: 'task-submission-portal' });
  assert.deepEqual(repoCoordinates('https://github.com/bytemait/task-submission-portal.git'), { owner: 'bytemait', repo: 'task-submission-portal' });
  assert.deepEqual(repoCoordinates('https://github.com/bytemait/task-submission-portal/'), { owner: 'bytemait', repo: 'task-submission-portal' });
  for (const url of ['https://github.com.evil.com/a/b', 'http://github.com/a/b', 'https://github.com/a/b/tree/main', 'https://github.com/a/b?query=1', 'https://github.com@evil.com/a/b', 'javascript:alert(1)', 'https://github.com/bytemait/.git']) assert.equal(repoCoordinates(url), null);
});
test('draft accepts partial answers; final requires selected track and contact', () => {
  const draft = emptySubmission(); draft.student.name = 'Test Student'; draft.student.enrollment = '12345678901';
  assert.deepEqual(validateSubmission(draft, false), []);
  assert.ok(validateSubmission(draft, true).length > 0);
  draft.student.email = 'test@example.com'; draft.student.phone = '9876543210'; draft.student.dept = 'CSE'; draft.student.year = '2nd year (Sem 3)';
  draft.student.year = '2';
  draft.student.semester = '3'; draft.student.academicBranch = 'CSE';
  draft.selected = ['web-dev']; draft.answers['web-dev'] = { repo: 'https://github.com/bytemait/demo' };
  // Dept-specific answers for web-dev
  draft.deptAnswers = { 'web-dev': {
    repoPublic: true, noSecrets: true,
    forkUrl: 'https://github.com/student/canteen-chaos',
    logMd: true,
  } };
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

// ── Phone normalization ─────────────────────────────────────────────────────
test('phone normalization variants', () => {
  assert.equal(normalizePhone('9876543210'), '+919876543210');
  assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalizePhone('91-9876543210'), '+919876543210');
  assert.equal(normalizePhone('09876543210'), '+919876543210');
  assert.equal(normalizePhone('+91-987-654-3210'), '+919876543210');
  assert.equal(normalizePhone('6000000000'), '+916000000000');
  assert.equal(normalizePhone('5000000000'), null); // doesn't start with 6-9
  assert.equal(normalizePhone('12345'), null); // too short
  assert.equal(normalizePhone(''), null);
  assert.equal(validatePhone('9876543210'), null); // valid
  assert.ok(validatePhone('1234567890')); // invalid start digit
  assert.ok(validatePhone('')); // required
});

// ── Year/Semester dependency ────────────────────────────────────────────────
test('year/semester dependency', () => {
  assert.equal(validateYear('1'), null);
  assert.equal(validateYear('4'), null);
  assert.ok(validateYear('5')); // invalid
  assert.ok(validateYear('')); // required
  assert.equal(validateSemester('1', '1'), null);
  assert.equal(validateSemester('2', '1'), null);
  assert.ok(validateSemester('3', '1')); // sem 3 not valid for year 1
  assert.equal(validateSemester('3', '2'), null);
  assert.equal(validateSemester('4', '2'), null);
  assert.ok(validateSemester('5', '2')); // sem 5 not valid for year 2
  assert.equal(validateSemester('7', '4'), null);
  assert.equal(validateSemester('8', '4'), null);
  assert.ok(validateSemester('1', '4')); // sem 1 not valid for year 4
});

// ── Society toggle clearing ─────────────────────────────────────────────────
test('society toggle clearing', () => {
  assert.equal(validateSocieties(false, []), null);
  assert.equal(validateSocieties(false, ['Society A']), null); // ignored when toggle is off
  assert.ok(validateSocieties(true, [])); // yes but empty
  assert.ok(validateSocieties(true, [''])); // yes but all empty strings
  assert.equal(validateSocieties(true, ['Society A']), null);
  assert.ok(validateSocieties(true, ['Society A', 'society a'])); // case-insensitive dedupe
  assert.ok(validateSocieties(true, ['A'])); // too short (< 2 chars)
  const tooMany = Array.from({ length: 11 }, (_, i) => `Society ${i}`);
  assert.ok(validateSocieties(true, tooMany)); // max 10
});

// ── Handle normalization from URLs ──────────────────────────────────────────
test('handle normalization from URLs', () => {
  // Instagram
  assert.equal(normalizeInstagram('https://instagram.com/john_doe'), 'john_doe');
  assert.equal(normalizeInstagram('https://www.instagram.com/john.doe/'), 'john.doe');
  assert.equal(normalizeInstagram('@john_doe'), 'john_doe');
  assert.equal(normalizeInstagram('john_doe'), 'john_doe');
  assert.equal(normalizeInstagram(''), '');
  assert.equal(validateInstagram('https://instagram.com/john_doe'), null);
  assert.ok(validateInstagram('a'.repeat(31))); // too long

  // Twitter
  assert.equal(normalizeTwitter('https://twitter.com/jack'), 'jack');
  assert.equal(normalizeTwitter('https://x.com/jack'), 'jack');
  assert.equal(normalizeTwitter('@jack'), 'jack');
  assert.equal(normalizeTwitter('jack'), 'jack');
  assert.equal(validateTwitter('jack'), null);
  assert.ok(validateTwitter('a'.repeat(16))); // too long

  // Discord
  assert.equal(normalizeDiscord('username'), 'username');
  assert.equal(normalizeDiscord('@Username'), 'username'); // lowercase
  assert.equal(normalizeDiscord('Player#1234'), 'Player#1234'); // legacy kept as-is
  assert.equal(validateDiscord('Player#1234'), null);
  assert.equal(validateDiscord('user.name'), null);
  assert.ok(validateDiscord('a')); // too short
});

// ── Profile completion ──────────────────────────────────────────────────────
test('profile completion check', () => {
  const complete = {
    name: 'Test Student', email: 'test@example.com', phone: '9876543210',
    enrollment: '12345678901', academicBranch: 'CSE', year: '2', semester: '3',
    inOtherSocieties: false, societies: [], instagram: '', twitter: '', discord: '',
  };
  assert.ok(isProfileComplete(complete));

  const incomplete = { ...complete, email: '' };
  assert.ok(!isProfileComplete(incomplete));

  const badSemester = { ...complete, semester: '1' }; // year 2, sem 1 invalid
  assert.ok(!isProfileComplete(badSemester));
});

// ── Submission profile gating ───────────────────────────────────────────────
test('incomplete profile gates final submission', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.email = 'test@example.com'; sub.student.phone = '9876543210';
  sub.student.year = '2'; sub.student.semester = '3'; sub.student.academicBranch = 'CSE';
  sub.selected = ['outreach']; sub.answers['outreach'] = { work: 'https://example.com' }; sub.student.dept = 'CSE';
  sub.deptAnswers = { outreach: {
    docUrl: 'https://drive.google.com/file/d/abc123',
    docPublic: true, fileName: true, taskOrder: true,
    noRealContact: true, limitsRespected: true, llmDisclosure: true, q6Real: true,
  } };

  assert.ok(isSubmissionProfileComplete(sub));
  const errors = validateSubmission(sub, true);
  assert.deepEqual(errors, []);

  // Remove branch => incomplete
  sub.student.academicBranch = '';
  assert.ok(!isSubmissionProfileComplete(sub));
  const errors2 = validateSubmission(sub, true);
  assert.ok(errors2.some(e => e.includes('profile')));
});

// ── URL validators ──────────────────────────────────────────────────────────
import {
  validateDriveFolderUrl, validateDriveFileUrl, validateGoogleDocUrl,
  validateGitHubUrl, validateWokwiUrl, validateMangaJsonl,
  countWords, validateWordLimit, isFieldActive,
  formatCheckboxLabel, buildFilenameHint, getEffectiveTaskTag, isCadTask2Required,
} from '../shared/submissionConfig.ts';

test('Drive folder URL validation', () => {
  assert.equal(validateDriveFolderUrl('https://drive.google.com/drive/folders/abc123'), null);
  assert.equal(validateDriveFolderUrl('https://drive.google.com/drive/folders/abc123/'), null);
  assert.equal(validateDriveFolderUrl('https://drive.google.com/drive/folders/abc123?usp=sharing'), null);
  assert.equal(validateDriveFolderUrl('https://drive.google.com/drive/folders/1abcxyz?resourcekey=0-AbC_123'), null);
  assert.equal(validateDriveFolderUrl('https://drive.google.com/drive/folders/1abcxyz/?usp=sharing#grid'), null);
  assert.ok(validateDriveFolderUrl('https://drive.google.com/file/d/abc123')); // file link, not folder
  assert.ok(validateDriveFolderUrl('https://docs.google.com/document/d/abc')); // wrong domain
  assert.ok(validateDriveFolderUrl('')); // empty
  assert.ok(validateDriveFolderUrl('not-a-url'));
});

test('GitHub URL validation', () => {
  assert.equal(validateGitHubUrl('https://github.com/user/repo'), null);
  assert.equal(validateGitHubUrl('https://github.com/user/repo/'), null); // trailing slash stripped
  assert.equal(validateGitHubUrl('https://github.com/user/repo.git'), null); // .git stripped
  assert.ok(validateGitHubUrl('https://github.com/user/repo/tree/main')); // too deep
  assert.ok(validateGitHubUrl('http://github.com/user/repo')); // http not https
  assert.ok(validateGitHubUrl('')); // empty
});

test('Wokwi URL validation', () => {
  assert.equal(validateWokwiUrl('https://wokwi.com/projects/12345'), null);
  assert.ok(validateWokwiUrl('https://wokwi.com/projects/')); // no ID
  assert.ok(validateWokwiUrl('https://wokwi.com/something/12345')); // wrong path
  assert.ok(validateWokwiUrl('')); // empty
});

// ── JSONL validation ────────────────────────────────────────────────────────
test('Manga JSONL validation', () => {
  // Valid JSONL
  const validLine = (i: number) => JSON.stringify({
    sequence_id: i,
    pages: [
      [{ speaker: 'A', text: 'hello' }],
      [{ speaker: 'B', text: 'world' }],
      [{ speaker: 'C', text: 'test' }],
    ],
  });
  const validContent = Array.from({ length: 15 }, (_, i) => validLine(i)).join('\n');
  assert.equal(validateMangaJsonl(validContent), null);

  // Wrong line count
  const tooFew = Array.from({ length: 10 }, (_, i) => validLine(i)).join('\n');
  assert.ok(validateMangaJsonl(tooFew)?.includes('15'));

  // Invalid JSON on a line
  const badJson = validContent.replace(validLine(5), '{broken');
  assert.ok(validateMangaJsonl(badJson)?.includes('Line 6'));

  // Missing sequence_id
  const noId = validContent.replace(validLine(3), JSON.stringify({ pages: [[], [], []] }));
  assert.ok(validateMangaJsonl(noId)?.includes('sequence_id'));

  // Wrong pages count
  const wrongPages = validContent.replace(validLine(0), JSON.stringify({ sequence_id: 0, pages: [[], []] }));
  assert.ok(validateMangaJsonl(wrongPages)?.includes('3 lists'));
});

// ── ML year rule ────────────────────────────────────────────────────────────
import { getDeptConfig } from '../shared/submissionConfig.ts';

test('ML year-based task selection rules', () => {
  const ml = getDeptConfig('ml')!;
  assert.ok(ml);
  const rule = ml.yearRule!;

  // Must pick exactly 2
  assert.ok(rule(1, ['agentic-task'])); // only 1
  assert.ok(rule(1, ['agentic-task', 'manga-task', 'ml-research-basic'])); // 3

  // 1st year: any two OK
  assert.equal(rule(1, ['agentic-task', 'ml-research-basic']), null);
  assert.equal(rule(1, ['manga-task', 'ml-research-advanced']), null);

  // 2nd year: at least one advanced
  assert.ok(rule(2, ['agentic-task', 'ml-research-basic'])); // both basic
  assert.equal(rule(2, ['agentic-task', 'manga-task']), null); // one advanced
  assert.equal(rule(2, ['manga-task', 'ml-research-advanced']), null); // both advanced

  // 3rd year: both advanced
  assert.ok(rule(3, ['agentic-task', 'manga-task'])); // one basic
  assert.equal(rule(3, ['manga-task', 'ml-research-advanced']), null); // both advanced
});

// ── Department submission validation ────────────────────────────────────────
import { validateDeptSubmission } from './validation.ts';

test('CAD dept validation requires Drive link and Task 1 checkbox', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.year = '1';
  sub.selected = ['cad'];
  sub.deptAnswers = { cad: {} };

  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('Drive folder link')));
  assert.ok(errors.some(e => e.includes('Viewer')));

  // Fill in required fields
  sub.deptAnswers!.cad = {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    task1Files: true,
  };
  const errors2 = validateDeptSubmission(sub);
  assert.deepEqual(errors2, []);
});

test('Electronics Task 2 required for year >= 2, optional for year 1', () => {
  const baseSub = () => {
    const sub = emptySubmission();
    sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
    sub.selected = ['electronics'];
    return sub;
  };

  // year 1, task2Attempted=false → no Task2-related error
  const subY1 = baseSub();
  subY1.student.year = '1';
  subY1.deptAnswers = { electronics: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: false,
    wokwiUrl: 'https://wokwi.com/projects/12345',
    linkTxt: true, codeTxt: true, rationale: true,
    task2Attempted: false,
  } };
  const errorsY1 = validateDeptSubmission(subY1);
  assert.ok(!errorsY1.some(e => e.includes('Task 2') || e.includes('Simon Says')));

  // year 2, task2Attempted=false → error mentioning Task 2 / "required from 2nd year onward"
  const subY2 = baseSub();
  subY2.student.year = '2';
  subY2.deptAnswers = { electronics: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: false,
    wokwiUrl: 'https://wokwi.com/projects/12345',
    linkTxt: true, codeTxt: true, rationale: true,
    task2Attempted: false,
  } };
  const errorsY2 = validateDeptSubmission(subY2);
  assert.ok(errorsY2.some(e => e.includes('Task 2') && e.includes('required from 2nd year onward')));

  // year 3, task2Attempted=false → same error
  const subY3 = baseSub();
  subY3.student.year = '3';
  subY3.deptAnswers = { electronics: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: false,
    wokwiUrl: 'https://wokwi.com/projects/12345',
    linkTxt: true, codeTxt: true, rationale: true,
    task2Attempted: false,
  } };
  const errorsY3 = validateDeptSubmission(subY3);
  assert.ok(errorsY3.some(e => e.includes('Task 2') && e.includes('required from 2nd year onward')));

  // year 4, task2Attempted=false → same error
  const subY4 = baseSub();
  subY4.student.year = '4';
  subY4.deptAnswers = { electronics: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: false,
    wokwiUrl: 'https://wokwi.com/projects/12345',
    linkTxt: true, codeTxt: true, rationale: true,
    task2Attempted: false,
  } };
  const errorsY4 = validateDeptSubmission(subY4);
  assert.ok(errorsY4.some(e => e.includes('Task 2') && e.includes('required from 2nd year onward')));

  // year 2, task2Attempted=true, all Task2 fields valid → no error
  const subY2Valid = baseSub();
  subY2Valid.student.year = '2';
  subY2Valid.deptAnswers = { electronics: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: false,
    wokwiUrl: 'https://wokwi.com/projects/12345',
    linkTxt: true, codeTxt: true, rationale: true,
    task2Attempted: true,
    hardware2: false,
    wokwiUrl2: 'https://wokwi.com/projects/67890',
    linkTxt2: true, codeTxt2: true, rationale2: true,
  } };
  const errorsY2Valid = validateDeptSubmission(subY2Valid);
  assert.deepEqual(errorsY2Valid, []);
});

// ── New URL validators ──────────────────────────────────────────────────────

test('Drive file URL validation', () => {
  assert.equal(validateDriveFileUrl('https://drive.google.com/file/d/abc123'), null);
  assert.equal(validateDriveFileUrl('https://drive.google.com/file/d/abc123/view'), null);
  assert.equal(validateDriveFileUrl('https://drive.google.com/file/d/abc123/view?usp=sharing'), null);
  assert.equal(validateDriveFileUrl('https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view?usp=drivesdk'), null);
  assert.equal(validateDriveFileUrl('https://drive.google.com/file/d/abc123/preview#page=1'), null);
  assert.ok(validateDriveFileUrl('https://drive.google.com/drive/folders/abc123')); // folder, not file
  assert.ok(validateDriveFileUrl('https://docs.google.com/document/d/abc')); // wrong type
  assert.ok(validateDriveFileUrl('')); // empty
  assert.ok(validateDriveFileUrl('not-a-url'));
});

test('Google Doc URL validation', () => {
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/abc123'), null);
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/abc123/edit'), null);
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/abc123/edit?usp=sharing'), null);
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?tab=t.0'), null);
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit?usp=drive_link'), null);
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#heading=h.gjdgxs'), null);
  assert.equal(validateGoogleDocUrl('https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/preview'), null);
  assert.ok(validateGoogleDocUrl('https://drive.google.com/file/d/abc123')); // file, not doc
  assert.ok(validateGoogleDocUrl('https://docs.google.com/spreadsheets/d/abc123')); // spreadsheet
  assert.ok(validateGoogleDocUrl('')); // empty
});

// ── Word count ───────────────────────────────────────────────────────────────
test('word count and limit validation', () => {
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('  spaced   out   words  '), 3);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);

  assert.equal(validateWordLimit('one two three', 5), null);
  assert.equal(validateWordLimit('one two three', 3), null);
  assert.ok(validateWordLimit('one two three four', 3)?.includes('4/3'));
  assert.equal(validateWordLimit('', 50), null);
});

// ── Conditional field logic ──────────────────────────────────────────────────
test('isFieldActive handles numeric range (2+) and string match', () => {
  // Numeric range
  const stage2Field = { key: 'auth', label: 'Auth', type: 'checkbox' as const, conditionalOn: 'stageReached:2+' };
  assert.equal(isFieldActive(stage2Field, { stageReached: '1' }), false);
  assert.equal(isFieldActive(stage2Field, { stageReached: '2' }), true);
  assert.equal(isFieldActive(stage2Field, { stageReached: '3' }), true);

  // String contains match
  const canvaField = { key: 'canva', label: 'Canva link', type: 'url' as const, conditionalOn: 'software:Canva' };
  assert.equal(isFieldActive(canvaField, { software: 'Canva' }), true);
  assert.equal(isFieldActive(canvaField, { software: 'canva pro' }), true);
  assert.equal(isFieldActive(canvaField, { software: 'Figma' }), false);
  assert.equal(isFieldActive(canvaField, { software: '' }), false);
});

// ── Video Editing: 50-word creative note ─────────────────────────────────────
test('Video Editing: word limit enforcement on creative note', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.email = 'test@example.com'; sub.student.phone = '9876543210';
  sub.student.year = '1'; sub.student.semester = '1'; sub.student.academicBranch = 'CSE';
  sub.selected = ['video-editing'];
  sub.deptAnswers = { 'video-editing': {
    driveUrl: 'https://drive.google.com/file/d/abc123',
    software: 'Premiere Pro',
    creativeNote: Array(51).fill('word').join(' '), // 51 words
    drivePublic: true, fileName: true, originalQuality: true,
    duration: true, byteFootage: true, noTemplate: true,
  } };
  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('51/50')));

  // Fix: 50 words exactly
  sub.deptAnswers!['video-editing']!.creativeNote = Array(50).fill('word').join(' ');
  const errors2 = validateDeptSubmission(sub);

  assert.ok(!errors2.some(e => e.includes('word limit')));
});
test('Video Editing accepts an optional portfolio URL and rejects malformed URLs', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['video-editing'];
  sub.deptAnswers = { 'video-editing': {
    driveUrl: 'https://drive.google.com/file/d/abc123',
    software: 'DaVinci Resolve',
    creativeNote: 'A short creative note.',
    drivePublic: true, fileName: true, originalQuality: true,
    duration: true, byteFootage: true, noTemplate: true,
  } };
  assert.deepEqual(validateDeptSubmission(sub), []);
  sub.deptAnswers['video-editing']!.portfolioUrl = 'javascript:alert(1)';
  assert.ok(validateDeptSubmission(sub).some(error => error.includes('HTTP(S) link')));
});

test('Graphic Design portfolio is optional and accepts a valid link', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['graphic-design'];
  sub.deptAnswers = { 'graphic-design': {
    driveUrl: 'https://drive.google.com/file/d/abc123',
    software: 'Figma', concept: 'A clean minimal poster',
    posterPublic: true, posterFile: true, qrReadable: true,
    resolution: true, contentPack: true, noTemplate: true,
  } };
  assert.deepEqual(validateDeptSubmission(sub), []);
  sub.deptAnswers['graphic-design']!.portfolioUrl = 'https://behance.net/example';
  assert.deepEqual(validateDeptSubmission(sub), []);
  sub.deptAnswers['graphic-design']!.portfolioUrl = 'javascript:alert(1)';
  assert.ok(validateDeptSubmission(sub).some(error => error.includes('HTTP(S) link')));
});

// ── Cybersecurity: GitHub + Google Doc URLs ──────────────────────────────────
test('Cybersecurity requires GitHub repo and Google Doc', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.year = '1';
  sub.selected = ['cybersecurity'];
  sub.deptAnswers = { cybersecurity: {} };

  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('GitHub')));
  assert.ok(errors.some(e => e.includes('Google Doc')));

  // Fill with valid URLs
  sub.deptAnswers!.cybersecurity = {
    repoUrl: 'https://github.com/user/ctf-solutions',
    docUrl: 'https://docs.google.com/document/d/abc123',
    repoPublic: true, docPublic: true, docExplains: true,
  };
  const errors2 = validateDeptSubmission(sub);
  assert.deepEqual(errors2, []);

  // Bad doc URL
  sub.deptAnswers!.cybersecurity!.docUrl = 'https://drive.google.com/file/d/abc';
  const errors3 = validateDeptSubmission(sub);
  assert.ok(errors3.some(e => e.includes('Google Doc link')));
});

// ── App Dev: stage-conditional fields ────────────────────────────────────────
test('App Dev stage 3 requires advanced missions (multi-select)', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.year = '2';
  sub.selected = ['app-dev'];
  sub.deptAnswers = { 'app-dev': {
    appName: 'SaveLater', stageReached: '3',
    repoUrl: 'https://github.com/user/save-later',
    commitHistory: true, readmeComplete: true, archDiagram: true,
    authExplained: true, privacyBackend: true, shareInto: true,
    advancedMissions: [], // empty — should fail
  } };
  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('Advanced missions')));

  // Fix: select at least 1
  sub.deptAnswers!['app-dev']!.advancedMissions = ['sync'];
  const errors2 = validateDeptSubmission(sub);
  assert.ok(!errors2.some(e => e.includes('Advanced missions')));
});

// ── Outreach: accepts Drive file OR Google Doc URL ──────────────────────────
test('Outreach accepts Drive file or Google Doc', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.year = '1';
  sub.selected = ['outreach'];

  // Drive file — valid
  sub.deptAnswers = { outreach: {
    docUrl: 'https://drive.google.com/file/d/abc123',
    docPublic: true, fileName: true, taskOrder: true,
    noRealContact: true, limitsRespected: true, llmDisclosure: true, q6Real: true,
  } };
  assert.deepEqual(validateDeptSubmission(sub), []);

  // Google Doc — also valid
  sub.deptAnswers!.outreach!.docUrl = 'https://docs.google.com/document/d/xyz';
  assert.deepEqual(validateDeptSubmission(sub), []);
});

// ── Graphic Design: conditional Canva field ──────────────────────────────────
test('Graphic Design Canva edit link is optional and validated when provided', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
  sub.student.year = '1';
  sub.selected = ['graphic-design'];
  // Note: NOT setting deptSelected — for non-taskPicker depts, attempted tasks are derived automatically
  sub.deptAnswers = { 'graphic-design': {
    driveUrl: 'https://drive.google.com/file/d/abc123',
    software: 'Figma',
    concept: 'A clean minimal poster',
    posterPublic: true, posterFile: true, qrReadable: true,
    resolution: true, contentPack: true, noTemplate: true,
  } };
  // No Canva URL needed when software = Figma
  const errors = validateDeptSubmission(sub);
  assert.ok(!errors.some(e => e.includes('Canva')));

  // The editable Canva link is optional.
  sub.deptAnswers!['graphic-design']!.software = 'Canva';
  assert.deepEqual(validateDeptSubmission(sub), []);

  // But a supplied URL must still be a valid HTTP(S) URL.
  sub.deptAnswers!['graphic-design']!.canvaUrl = 'javascript:alert(1)';
  assert.ok(validateDeptSubmission(sub).some(error => error.includes('HTTP(S) link')));

  sub.deptAnswers!['graphic-design']!.canvaUrl = 'https://www.canva.com/design/abc/edit';
  assert.deepEqual(validateDeptSubmission(sub), []);
});

// ── ML department selection ──────────────────────────────────────────────────
test('selecting ML department (ml) or combinations with ML is valid in draft and submission', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test Student';
  sub.student.enrollment = '12345678901';
  sub.student.year = '2';
  sub.selected = ['ml'];
  assert.deepEqual(validateSubmission(sub, false), []);

  // Multi-department selection including ML
  sub.selected = ['ml', 'app-dev', 'cybersecurity', 'graphic-design', 'video-editing'];
  assert.deepEqual(validateSubmission(sub, false), []);
});

// ── Enrollment: 11-digit numeric validation ─────────────────────────────────
import { validateEnrollment, normalizeEnrollment } from '../shared/validation.ts';

test('enrollment accepts valid enrollment or class roll no', () => {
  assert.equal(validateEnrollment('12345678901'), null);
  assert.equal(validateEnrollment('G15'), null);
  assert.equal(validateEnrollment('0241MAIT123'), null);
  assert.ok(validateEnrollment('X'));             // too short (< 2 chars)
  assert.ok(validateEnrollment(''));              // empty
  assert.equal(normalizeEnrollment('  g15  '), 'G15');
});

// ── Paper Craft: select paper, optional repo, required template ─────────────
test('Paper Craft requires paper choice and template URL', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['ml'];
  sub.deptSelected = { ml: ['ml-research-basic', 'agentic-task'] };
  sub.deptAnswers = { ml: {} };

  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('Paper choice')));
  assert.ok(errors.some(e => e.includes('Paper Craft Reading Template')));

  // Fill required fields
  sub.deptAnswers!.ml = {
    paperChoice: 'vit',
    templateUrl: 'https://docs.google.com/document/d/abc',
    readPaper: true,
    // Agentic fields
    repo: 'https://github.com/user/agent',
    chronologicalCommits: true, fiveTools: true, readmeTools: true,
    toolUse: true, generalDatasets: true, notWrapper: true,
    techStack: 'LangChain + GPT-4',
  };
  const errors2 = validateDeptSubmission(sub);
  assert.ok(!errors2.some(e => e.includes('Paper Craft')));
});

test('Paper Craft "Other" requires paper title', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['ml'];
  sub.deptSelected = { ml: ['ml-research-basic', 'agentic-task'] };
  sub.deptAnswers = { ml: {
    paperChoice: 'other',
    templateUrl: 'https://docs.google.com/document/d/abc',
    readPaper: true,
    // Agentic fields (minimal)
    repo: 'https://github.com/user/agent',
    chronologicalCommits: true, fiveTools: true, readmeTools: true,
    toolUse: true, generalDatasets: true, notWrapper: true,
    techStack: 'LangChain + GPT-4',
  } };

  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('Paper title')));

  sub.deptAnswers!.ml!.otherPaperTitle = 'Attention Is All You Need';
  const errors2 = validateDeptSubmission(sub);
  assert.ok(!errors2.some(e => e.includes('Paper title')));
});

// ── Falsification Challenge: experiment toggle gates repo ────────────────────
test('Falsification Challenge: repo required only when experiments ran', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '3';
  sub.selected = ['ml'];
  sub.deptSelected = { ml: ['ml-research-advanced', 'manga-task'] };
  sub.deptAnswers = { ml: {
    // Falsification — no experiments
    proposalUrl: 'https://docs.google.com/document/d/proposal',
    experimentRan: false,
    researchQuestion: true, experimentSuite: true, controls: true,
    limitations: true, ownWork: true,
    // Manga — required fields
    repo: 'https://github.com/user/manga',
    predictions: '{"sequence_id":0,"pages":[[{"speaker":"A","text":"a"}],[{"speaker":"B","text":"b"}],[{"speaker":"C","text":"c"}]]}',
    readmeOwn: true, openWeight: true, noHostedApi: true,
    autoPredictions: true, citedExternal: true,
  } };

  // Without experiments: no repo error for Falsification
  delete sub.deptAnswers!.ml!.repo;
  const errors = validateDeptSubmission(sub);
  assert.ok(!errors.some(e => e.includes('Falsification') && e.includes('GitHub repository')));

  // With experiments: repo IS required
  sub.deptAnswers!.ml!.experimentRan = true;
  const errors2 = validateDeptSubmission(sub);
  assert.ok(errors2.some(e => e.includes('Falsification') && e.includes('GitHub repository')));
});

// ── Agentic Task: memory toggle ─────────────────────────────────────────────
test('Agentic Task: memory description required when toggle is on', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['ml'];
  sub.deptSelected = { ml: ['agentic-task', 'ml-research-basic'] };
  sub.deptAnswers = { ml: {
    // Agentic fields
    repo: 'https://github.com/user/agent',
    chronologicalCommits: true, fiveTools: true, readmeTools: true,
    toolUse: true, generalDatasets: true, notWrapper: true,
    techStack: 'LangChain + GPT-4',
    memoryToggle: true, // toggle ON but no description
    // Paper Craft fields
    paperChoice: 'vit',
    templateUrl: 'https://docs.google.com/document/d/abc',
    readPaper: true,
  } };

  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('memory retains')));

  sub.deptAnswers!.ml!.memoryDescription = 'Retains conversation summaries in SQLite';
  const errors2 = validateDeptSubmission(sub);
  assert.ok(!errors2.some(e => e.includes('memory retains')));
});

// ── Electronics hardware toggle branches ─────────────────────────────────────
test('Electronics Task 1 hardware toggle: linkTxt vs hardwareDemo', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['electronics'];

  // Wokwi mode (hardware=false): linkTxt required, hardwareDemo NOT required
  sub.deptAnswers = { electronics: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: false,
    wokwiUrl: 'https://wokwi.com/projects/12345',
    codeTxt: true, rationale: true,
    // linkTxt NOT checked
  } };
  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('Link.txt')));
  assert.ok(!errors.some(e => e.includes('Demo.mp4')));

  // Hardware mode (hardware=true): hardwareDemo required, linkTxt NOT required
  sub.deptAnswers!.electronics = {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    hardware: true,
    codeTxt: true, rationale: true,
    // hardwareDemo NOT checked
  };
  const errors2 = validateDeptSubmission(sub);
  assert.ok(errors2.some(e => e.includes('Demo.mp4')));
  assert.ok(!errors2.some(e => e.includes('Link.txt')));

  // Hardware mode with hardwareDemo checked: clean
  sub.deptAnswers!.electronics!.hardwareDemo = true;
  const errors3 = validateDeptSubmission(sub);
  assert.deepEqual(errors3, []);
});

// ── 4th year ML rule: both tasks must be Advanced ───────────────────────────
test('4th year ML: both tasks must be Advanced', () => {
  const ml = getDeptConfig('ml')!;
  const rule = ml.yearRule!;

  // 4th year: same rule as 3rd year — both advanced required
  assert.ok(rule(4, ['agentic-task', 'manga-task'])); // one basic
  assert.ok(rule(4, ['agentic-task', 'ml-research-basic'])); // both basic
  assert.equal(rule(4, ['manga-task', 'ml-research-advanced']), null); // both advanced
});

// ── Web Dev Task 2 repoUrl requirement when attempted ───────────────────────
test('Web Development: Task 2 repoUrl is required when attempted', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['web-dev'];

  // Task 1 complete, Task 2 attempted with checkboxes checked but missing repoUrl
  sub.deptAnswers = { 'web-dev': {
    repoPublic: true,
    noSecrets: true,
    forkUrl: 'https://github.com/test/canteen-chaos',
    logMd: true,
    task2Attempted: true,
    commitHistory: true,
    readmeComplete: true,
  } };
  const errors = validateDeptSubmission(sub);
  assert.ok(errors.some(e => e.includes('Task 2 — Gym Slot Booking') && e.includes('GitHub repository URL is required')));

  // Adding repoUrl passes validation
  sub.deptAnswers['web-dev'].repoUrl = 'https://github.com/test/gym-booking';
  const cleanErrors = validateDeptSubmission(sub);
  assert.deepEqual(cleanErrors, []);
});

// ── CAD Task 2 year-gating ──────────────────────────────────────────────────
test('CAD Task 2 required for year >= 2, optional for year 1', () => {
  const cad = getDeptConfig('cad')!;
  const task2 = cad.tasks.find(t => t.id === 'cad-task2')!;
  assert.equal(getEffectiveTaskTag(task2, 'cad', 1), 'Optional');
  assert.equal(getEffectiveTaskTag(task2, 'cad', 2), 'Required');
  assert.equal(getEffectiveTaskTag(task2, 'cad', 3), 'Required');
  assert.equal(isCadTask2Required(1), false);
  assert.equal(isCadTask2Required(2), true);
  assert.equal(isCadTask2Required(3), true);

  const baseSub = () => {
    const sub = emptySubmission();
    sub.student.name = 'Test'; sub.student.enrollment = '12345678901';
    sub.selected = ['cad'];
    return sub;
  };

  // Year 1 student: Task 2 not attempted → clean
  const subY1 = baseSub();
  subY1.student.year = '1';
  subY1.deptAnswers = { cad: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    task1Files: true,
    task2Attempted: false,
  } };
  assert.deepEqual(validateDeptSubmission(subY1), []);

  // Year 2 student: Task 2 not attempted → error
  const subY2 = baseSub();
  subY2.student.year = '2';
  subY2.deptAnswers = { cad: {
    driveUrl: 'https://drive.google.com/drive/folders/abc123',
    drivePublic: true,
    task1Files: true,
    task2Attempted: false,
  } };
  const errorsY2 = validateDeptSubmission(subY2);
  assert.ok(errorsY2.some(e => e.includes('Task 2 is required from 2nd year onward')));

  // Year 2 student: Task 2 attempted with all checkboxes checked → clean
  subY2.deptAnswers.cad.task2Attempted = true;
  subY2.deptAnswers.cad.task2Step = true;
  subY2.deptAnswers.cad.task2Demo = true;
  subY2.deptAnswers.cad.task2Rationale = true;
  assert.deepEqual(validateDeptSubmission(subY2), []);
});

// ── formatCheckboxLabel formatting and fallback ─────────────────────────────
test('formatCheckboxLabel formats filename hints correctly', () => {
  assert.equal(
    formatCheckboxLabel('video-editing', 'fileName', 'File named in the required format.', 'John Doe', 'CSE'),
    'File is named John_CSE_VideoEdit.mp4'
  );
  assert.equal(
    formatCheckboxLabel('outreach', 'fileName', 'File named in the required format.', 'Jane Smith', 'ECE'),
    'File is named JaneSmith_ECE_Outreach'
  );
  assert.equal(
    formatCheckboxLabel('graphic-design', 'posterFile', 'File named in the required format.', 'Alice Wonderland', 'IT'),
    'File is named Alice_IT_Poster.png'
  );
  assert.equal(
    formatCheckboxLabel('graphic-design', 'merchFile', 'File named in the required format.', 'Bob Builder', 'ME'),
    'File is named Bob_ME_Merch.png'
  );
  assert.equal(
    formatCheckboxLabel('web-dev', 'logMd', 'Fork contains fixes AND a LOG.md', 'Test', 'CSE'),
    'Fork contains fixes AND a LOG.md'
  );
});

test('Paper Craft: paperCommits required when paperRepo is provided', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['ml'];
  sub.deptSelected = { ml: ['ml-research-basic', 'agentic-task'] };
  sub.deptAnswers = {
    ml: {
      agenticRepo: 'https://github.com/test/agentic',
      agenticCommits: true, fiveTools: true, readmeTools: true, toolUse: true, generalDatasets: true, notWrapper: true,
      techStack: 'Python',
      paperChoice: 'vit',
      templateUrl: 'https://docs.google.com/document/d/1234567890abcdef',
      readPaper: true,
      paperRepo: 'https://github.com/test/paper-notes',
      // paperCommits NOT checked
    },
  };

  const errs = validateDeptSubmission(sub);
  assert.ok(errs.some(e => e.includes('chronological commits')));

  // Check the commits box -> passes
  sub.deptAnswers.ml.paperCommits = true;
  assert.deepEqual(validateDeptSubmission(sub), []);
});

test('url-list: rejects invalid URLs within list entries', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['graphic-design'];
  sub.deptAnswers = {
    'graphic-design': {
      driveUrl: 'https://drive.google.com/file/d/12345abcdef/view',
      software: 'Figma',
      concept: 'A good concept for test.',
      posterPublic: true, posterFile: true, qrReadable: true, resolution: true, contentPack: true, noTemplate: true,
      task2Attempted: true,
      driveUrl2: 'https://drive.google.com/file/d/67890abcdef/view',
      software2: 'Figma',
      concept2: 'Another good concept.',
      merchPublic: true, merchFile: true, original: true,
      references: ['https://behance.net/gallery/123', 'not-a-valid-url'],
    },
  };

  const errs = validateDeptSubmission(sub);
  assert.ok(errs.some(e => e.includes('not-a-valid-url') && e.includes('not a valid URL')));

  // Fixed with valid URL
  sub.deptAnswers['graphic-design'].references = ['https://behance.net/gallery/123', 'https://pinterest.com/pin/456'];
  assert.deepEqual(validateDeptSubmission(sub), []);
});

test('App Dev: enforces buildUrl OR noBuild mutual requirement', () => {
  const sub = emptySubmission();
  sub.student.name = 'Test'; sub.student.enrollment = '12345678901'; sub.student.year = '1';
  sub.selected = ['app-dev'];
  sub.deptAnswers = {
    'app-dev': {
      appName: 'SaveIt',
      stageReached: '1',
      repoUrl: 'https://github.com/test/saveit',
      commitHistory: true,
      readmeComplete: true,
      archDiagram: true,
      // neither buildUrl nor noBuild provided
    },
  };

  const errs1 = validateDeptSubmission(sub);
  assert.ok(errs1.some(e => e.includes('Provide a runnable build link or check "No hosted build is practical"')));

  // Both provided -> error
  sub.deptAnswers['app-dev'].buildUrl = 'https://drive.google.com/file/d/app.apk';
  sub.deptAnswers['app-dev'].noBuild = true;
  const errs2 = validateDeptSubmission(sub);
  assert.ok(errs2.some(e => e.includes('Uncheck "No hosted build is practical" if providing a build link')));

  // Only buildUrl -> clean
  sub.deptAnswers['app-dev'].noBuild = false;
  assert.deepEqual(validateDeptSubmission(sub), []);

  // Only noBuild -> clean
  delete sub.deptAnswers['app-dev'].buildUrl;
  sub.deptAnswers['app-dev'].noBuild = true;
  assert.deepEqual(validateDeptSubmission(sub), []);
});

test('ML tasks: distinct repository keys (agenticRepo, mangaRepo, paperRepo, falsificationRepo) persist independently', () => {
  const mlConfig = getDeptConfig('ml')!;
  assert.ok(mlConfig);

  // 1. Confirm that each of the four ML tasks has its own genuinely distinct repo key
  const repoKeys = mlConfig.tasks.map(task => {
    const repoField = task.fields.find(f => f.type === 'url' && f.urlType === 'github');
    return { taskId: task.id, repoKey: repoField?.key };
  });

  assert.deepEqual(repoKeys, [
    { taskId: 'agentic-task', repoKey: 'agenticRepo' },
    { taskId: 'manga-task', repoKey: 'mangaRepo' },
    { taskId: 'ml-research-basic', repoKey: 'paperRepo' },
    { taskId: 'ml-research-advanced', repoKey: 'falsificationRepo' },
  ]);

  // Set of all 4 keys has size 4 (genuinely distinct)
  const keySet = new Set(repoKeys.map(k => k.repoKey));
  assert.equal(keySet.size, 4);

  // 2. Test filling two ML tasks' repo fields and assert both persist independently
  const sub = emptySubmission();
  sub.student.name = 'ML Scholar';
  sub.student.enrollment = '12345678901';
  sub.student.year = '2'; // 2nd year: allows 1 Basic + 1 Advanced
  sub.student.semester = '3';
  sub.student.academicBranch = 'CSE';
  sub.selected = ['ml'];
  sub.deptSelected = {
    ml: ['agentic-task', 'manga-task'], // The Agentic Task (Basic) + The Manga Task (Advanced)
  };

  // Fill in answers for both tasks simultaneously under deptAnswers.ml
  sub.deptAnswers = {
    ml: {
      // Task 1: The Agentic Task
      agenticRepo: 'https://github.com/scholar/agentic-data-agent',
      agenticCommits: true,
      fiveTools: true,
      readmeTools: true,
      toolUse: true,
      generalDatasets: true,
      notWrapper: true,
      techStack: 'LangChain, Python, Pandas',
      memoryToggle: false,

      // Task 2: The Manga Task
      mangaRepo: 'https://github.com/scholar/manga-translator-ocr',
      predictions: Array.from({ length: 15 }, (_, i) => JSON.stringify({
        sequence_id: i,
        pages: [[{ speaker: 'A', text: '1' }], [{ speaker: 'B', text: '2' }], [{ speaker: 'C', text: '3' }]],
      })).join('\n'),
      weightsInRepo: true,
      readmeOwn: true,
      openWeight: true,
      noHostedApi: true,
      autoPredictions: true,
      citedExternal: true,
    },
  };

  // Assert both repo URLs persist independently in the same submission payload without collision
  assert.equal(sub.deptAnswers.ml.agenticRepo, 'https://github.com/scholar/agentic-data-agent');
  assert.equal(sub.deptAnswers.ml.mangaRepo, 'https://github.com/scholar/manga-translator-ocr');
  assert.notEqual(sub.deptAnswers.ml.agenticRepo, sub.deptAnswers.ml.mangaRepo);

  // Updating or mutating one repo URL does NOT touch the other
  sub.deptAnswers.ml.agenticRepo = 'https://github.com/scholar/updated-agentic-agent';
  assert.equal(sub.deptAnswers.ml.agenticRepo, 'https://github.com/scholar/updated-agentic-agent');
  assert.equal(sub.deptAnswers.ml.mangaRepo, 'https://github.com/scholar/manga-translator-ocr');

  // Verify that backend validation passes cleanly with both distinct repo fields populated
  const errors = validateDeptSubmission(sub);
  assert.deepEqual(errors, []);

  // Also verify second pair: Paper Craft (paperRepo) and Falsification Challenge (falsificationRepo)
  sub.deptSelected.ml = ['ml-research-basic', 'ml-research-advanced'];
  sub.deptAnswers.ml = {
    // Paper Craft
    paperChoice: 'vit',
    templateUrl: 'https://docs.google.com/document/d/paper-reading-template',
    paperRepo: 'https://github.com/scholar/vit-notes',
    paperCommits: true,
    readPaper: true,

    // Falsification Challenge
    proposalUrl: 'https://docs.google.com/document/d/falsification-proposal',
    experimentRan: true,
    falsificationRepo: 'https://github.com/scholar/falsification-experiments',
    falsificationCommits: true,
    researchQuestion: true,
    experimentSuite: true,
    controls: true,
    limitations: true,
    ownWork: true,
  };

  assert.equal(sub.deptAnswers.ml.paperRepo, 'https://github.com/scholar/vit-notes');
  assert.equal(sub.deptAnswers.ml.falsificationRepo, 'https://github.com/scholar/falsification-experiments');
  assert.notEqual(sub.deptAnswers.ml.paperRepo, sub.deptAnswers.ml.falsificationRepo);
  assert.deepEqual(validateDeptSubmission(sub), []);
});




