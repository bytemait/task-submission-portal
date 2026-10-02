import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvCell, buildSubmissionsCsv, buildSubmissionsJson } from './export.ts';
import { type Submission } from '../shared/tracks.ts';

test('escapeCsvCell: standard and edge cases', () => {
  assert.equal(escapeCsvCell('hello'), 'hello');
  assert.equal(escapeCsvCell(''), '');
  assert.equal(escapeCsvCell(null), '');
  assert.equal(escapeCsvCell(undefined), '');
  assert.equal(escapeCsvCell('hello, world'), '"hello, world"');
  assert.equal(escapeCsvCell('say "hello"'), '"say ""hello"""');
  assert.equal(escapeCsvCell('line 1\nline 2'), '"line 1\nline 2"');
  assert.equal(escapeCsvCell(' spaced '), '" spaced "');
});

test('escapeCsvCell: mitigates CSV formula injection', () => {
  assert.equal(escapeCsvCell('=1+1'), "'=1+1");
  assert.equal(escapeCsvCell('+123'), "'+123");
  assert.equal(escapeCsvCell('-123'), "'-123");
  assert.equal(escapeCsvCell('@cmd'), "'@cmd");
  assert.equal(escapeCsvCell('\t123'), "'\t123");
  // Formula injection with comma should also be properly quoted
  assert.equal(escapeCsvCell('=cmd|"/C calc"!A0'), '"\'=cmd|""/C calc""!A0"');
});

test('buildSubmissionsCsv: builds complete CSV with correct headers and department answers', () => {
  const sampleSubmission: Submission = {
    student: {
      name: 'John Doe',
      enrollment: '0241MAIT',
      email: 'john@example.com',
      phone: '9876543210',
      academicBranch: 'CSE',
      year: '2',
      semester: '4',
      inOtherSocieties: false,
      societies: [],
      instagram: '@johndoe',
      twitter: '@johndoe_dev',
      discord: 'johndoe#1234'
    },
    selected: ['web-dev'],
    answers: {},
    deptAnswers: {
      'web-dev': {
        forkUrl: 'https://github.com/johndoe/canteen-chaos',
        repoUrl: 'https://github.com/johndoe/gym-booking',
        liveUrl: 'https://gym.johndoe.dev',
        reviewerNote: 'Built with React and Vite,\nand lots of coffee.'
      }
    },
    status: 'submitted',
    submittedAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z'
  };

  const csv = buildSubmissionsCsv([sampleSubmission]);
  const lines = csv.split('\r\n');

  assert.ok(lines.length >= 2);
  const headerLine = lines[0];
  assert.ok(headerLine.includes('Enrollment,Name,Email,Phone,Branch,Year,Semester,Societies,Instagram,Twitter/X,Discord,Status,Submitted At,Last Updated,Selected Departments'));
  assert.ok(headerLine.includes('Web Development [Task 2 — Gym Slot Booking] - GitHub repository URL'));

  const dataLine = lines[1];
  assert.ok(dataLine.includes('0241MAIT,John Doe,john@example.com,9876543210,CSE,2,4,,\'@johndoe,\'@johndoe_dev,johndoe#1234,submitted'));
  assert.ok(dataLine.includes('https://github.com/johndoe/canteen-chaos'));
  assert.ok(dataLine.includes('"Built with React and Vite,\nand lots of coffee."'));
});

test('buildSubmissionsJson: produces valid JSON matching input', () => {
  const sampleSubmission: Submission = {
    student: {
      name: 'Jane Doe',
      enrollment: '0242MAIT',
      email: 'jane@example.com',
      phone: '9876543211',
      dept: 'IT',
      year: '1st year (Sem 1)'
    },
    selected: ['graphic-design'],
    answers: {
      'graphic-design': {
        work: 'https://behance.net/jane'
      }
    },
    status: 'draft'
  };

  const jsonStr = buildSubmissionsJson([sampleSubmission]);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].student.name, 'Jane Doe');
});
