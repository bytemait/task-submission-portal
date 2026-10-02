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

test('buildSubmissionsCsv: builds complete CSV with correct headers and track answers', () => {
  const sampleSubmission: Submission = {
    student: {
      name: 'John Doe',
      enrollment: '0241MAIT',
      email: 'john@example.com',
      phone: '9876543210',
      dept: 'CSE',
      year: '2nd year (Sem 4)',
      otherSocieties: 'None',
      socials: {
        instagram: '@johndoe',
        twitter: '@johndoe_dev',
        discord: 'johndoe#1234'
      }
    },
    selected: ['web-dev'],
    deptAnswers: {
      'web-dev': {
        forkUrl: 'https://github.com/johndoe/project',
        reviewerNote: 'Built with React and Vite,\nand lots of coffee.'
      }
    },
    answers: {
      'web-dev': {
        forkUrl: 'https://github.com/johndoe/project',
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
  assert.ok(headerLine.includes('Enrollment,Name,Email,Phone,Department,Year / Semester,Other Societies,Instagram,Twitter/X,Discord,Status,Submitted At,Last Updated,Selected Tracks'));
  assert.ok(headerLine.includes('Web Development [Task 1 — Debugging Stage: Canteen Chaos] - Public fork URL'));

  const dataLine = lines[1];
  assert.ok(dataLine.includes('0241MAIT,John Doe,john@example.com,9876543210,CSE,2nd year (Sem 4),None,\'@johndoe,\'@johndoe_dev,johndoe#1234,submitted'));
  assert.ok(dataLine.includes('https://github.com/johndoe/project'));
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

test('buildSubmissionsCsv: excludes answers from unselected departments and unchosen tasks', () => {
  const submissionWithDraftLeftovers: Submission = {
    student: {
      name: 'Bob Tester',
      enrollment: '12345678901',
      email: 'bob@example.com',
      phone: '9876543210',
      academicBranch: 'CSE',
      year: '1',
      semester: '1',
    },
    selected: ['ml'],
    deptSelected: {
      ml: ['agentic-task', 'manga-task'], // Selected tasks 1 & 2
    },
    deptAnswers: {
      ml: {
        agenticRepo: 'https://github.com/bob/agentic',
        falsificationRepo: 'https://github.com/bob/should-not-export', // Task 4 draft answer, not chosen
      },
      cad: {
        driveUrl: 'https://drive.google.com/drive/folders/should-not-export-cad', // CAD not in selected
      },
    },
    answers: {
      'app-dev': {
        repo: 'https://github.com/bob/legacy-app-dev', // app-dev not in selected
      },
    },
    status: 'submitted',
    submittedAt: '2026-03-01T12:00:00.000Z',
  };

  const csv = buildSubmissionsCsv([submissionWithDraftLeftovers]);
  assert.ok(csv.includes('https://github.com/bob/agentic'));
  assert.ok(!csv.includes('should-not-export'));
  assert.ok(!csv.includes('legacy-app-dev'));
});

test('buildSubmissionsCsv: blanks unattempted task columns when attempt toggle is false', () => {
  const submission: Submission = {
    student: {
      name: 'Electronics Tester',
      enrollment: '12345678901',
      email: 'elec@example.com',
      phone: '9876543210',
      academicBranch: 'ECE',
      year: '1',
      semester: '1',
    },
    selected: ['electronics', 'cad'],
    deptAnswers: {
      electronics: {
        driveUrl: 'https://drive.google.com/drive/folders/valid-drive',
        drivePublic: true,
        hardware: false,
        wokwiUrl: 'https://wokwi.com/projects/task1-sim',
        codeTxt: true,
        rationale: true,
        linkTxt: true,
        // Task 2 attempted toggle is explicitly false (No), with leftover draft answers
        task2Attempted: false,
        wokwiUrl2: 'https://wokwi.com/projects/stale-task2-wokwi-999',
        codeTxt2: true,
        rationale2: true,
        linkTxt2: true,
      },
      cad: {
        driveUrl: 'https://drive.google.com/drive/folders/cad-drive',
        drivePublic: true,
        task1Files: true,
        // CAD Task 2 attempted is false, with leftover draft answers
        task2Attempted: false,
        task2Step: true,
        task2Demo: true,
        task2Rationale: true,
      },
    },
    answers: {},
    status: 'submitted',
    submittedAt: '2026-03-01T12:00:00.000Z',
  };

  const csv = buildSubmissionsCsv([submission]);

  // Task 1 active answers must be present
  assert.ok(csv.includes('https://wokwi.com/projects/task1-sim'));

  // Task 2 attempted toggle exports as 'No'
  assert.ok(csv.includes(',No,'));

  // Task 2 stale draft answers must be blanked and NOT present in CSV
  assert.ok(!csv.includes('stale-task2-wokwi-999'));
});

test('buildSubmissionsCsv: App Dev noBuild path and inactive stage missions are blanked', () => {
  const submission: Submission = {
    student: {
      name: 'App Dev Tester',
      enrollment: '12345678902',
      email: 'app@example.com',
      phone: '9876543210',
      academicBranch: 'IT',
      year: '1',
      semester: '1',
    },
    selected: ['app-dev'],
    deptAnswers: {
      'app-dev': {
        appName: 'TestApp',
        stageReached: '1', // Stage 1 reached
        repoUrl: 'https://github.com/app/repo',
        commitHistory: true,
        readmeComplete: true,
        archDiagram: true,
        // noBuild path chosen, but with leftover draft buildUrl
        noBuild: true,
        buildUrl: 'https://example.com/stale-build.apk',
        // Inactive stage 2 & stage 3 draft answers left from exploration
        authExplained: true,
        privacyBackend: true,
        shareInto: true,
        advancedMissions: ['sync', 'vault'],
      },
    },
    answers: {},
    status: 'submitted',
    submittedAt: '2026-03-01T12:00:00.000Z',
  };

  const csv = buildSubmissionsCsv([submission]);

  // Active fields present
  assert.ok(csv.includes('https://github.com/app/repo'));

  // buildUrl is blanked because noBuild is true
  assert.ok(!csv.includes('stale-build.apk'));

  // Inactive stage 2/3 missions are blanked because stageReached is '1'
  assert.ok(!csv.includes('sync; vault'));
  assert.ok(!csv.includes('sync'));
});

test('buildSubmissionsCsv: Falsification Challenge experiment fields blanked when experimentRan is false', () => {
  const submission: Submission = {
    student: {
      name: 'ML Tester',
      enrollment: '12345678903',
      email: 'ml@example.com',
      phone: '9876543210',
      academicBranch: 'CSE',
      year: '2',
      semester: '3',
    },
    selected: ['ml'],
    deptSelected: {
      ml: ['ml-research-advanced', 'agentic-task'],
    },
    deptAnswers: {
      ml: {
        agenticRepo: 'https://github.com/ml/agentic',
        agenticCommits: true, fiveTools: true, readmeTools: true, toolUse: true, generalDatasets: true, notWrapper: true, techStack: 'PyTorch',
        proposalUrl: 'https://docs.google.com/document/d/12345proposal',
        researchQuestion: true, experimentSuite: true, controls: true, limitations: true, ownWork: true,
        // Experiment was NOT run (false), but stale repo left in draft
        experimentRan: false,
        falsificationRepo: 'https://github.com/ml/stale-experiment-repo',
        falsificationCommits: true,
      },
    },
    answers: {},
    status: 'submitted',
    submittedAt: '2026-03-01T12:00:00.000Z',
  };

  const csv = buildSubmissionsCsv([submission]);

  // Proposal URL is active and exported
  assert.ok(csv.includes('https://docs.google.com/document/d/12345proposal'));

  // Inactive experimentRepo and commits are blanked because experimentRan is false
  assert.ok(!csv.includes('stale-experiment-repo'));
});


