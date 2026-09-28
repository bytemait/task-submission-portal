/**
 * Data-driven submission configuration.
 * Each department is a config entry — the form UI and server validation
 * render from this, so adding a department is a config change, not new code.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type FieldType = 'url' | 'text' | 'textarea' | 'checkbox' | 'toggle' | 'select' | 'file' | 'multi-select' | 'url-list';

export interface DeptField {
  key: string;
  label: string;
  hint?: string;
  type: FieldType;
  required?: boolean;               // true = must be filled for valid submission
  /** If true, field is only required when a parent toggle is active */
  conditionalOn?: string;           // key of the toggle field that activates this
  /** Validation type for URL fields */
  urlType?: 'drive-folder' | 'drive-file' | 'google-doc' | 'github' | 'wokwi' | 'any-https';
  /** For select fields and multi-select */
  options?: { value: string; label: string }[];
  /** For file fields */
  accept?: string;                  // e.g. '.jsonl'
  /** Max length for text/textarea (characters) */
  maxLength?: number;
  /** Word limit for textarea — enforced client + server, shows live counter */
  wordLimit?: number;
  /** For checkbox fields — the text beside the checkbox */
  checkboxLabel?: string;
  /** For multi-select — minimum selections required */
  minSelect?: number;
}

export interface TaskConfig {
  id: string;
  name: string;
  tag: 'Basic' | 'Advanced' | 'Required' | 'Optional' | 'Bonus';
  fields: DeptField[];
  checkboxes: { key: string; label: string; required?: boolean }[];
  /** Collapsible helper text shown in the task section */
  helperText?: { title: string; content: string };
}

export type YearRule = (year: number, selectedTaskIds: string[]) => string | null;

export interface DeptConfig {
  id: string;                       // matches track id in tracks.ts
  name: string;
  category: string;
  color: string;
  type: 'drive' | 'github' | 'mixed';
  /** Drive folder naming hint, e.g. "<YourName>_CAD" */
  folderNameHint?: string;
  /** Folder structure shown as read-only tree in help text */
  folderTree?: string;
  /** Top-level fields (drive link, sharing checkbox, etc.) */
  globalFields: DeptField[];
  /** Global checkboxes that apply to the whole department */
  globalCheckboxes: { key: string; label: string; required?: boolean }[];
  /** Task definitions within this department */
  tasks: TaskConfig[];
  /** How many tasks must be picked (for ML: exactly 2) */
  taskPickCount?: number;
  /** Year-based rules for task selection */
  yearRule?: YearRule;
  /** If true, the student selects which tasks to attempt (ML). Otherwise tasks are shown inline. */
  taskPicker?: boolean;
  /** If true, show "Submission details coming soon" */
  comingSoon?: boolean;
  /** Collapsible helper text shown at the top of the department form */
  helperText?: { title: string; content: string };
  /** Helper text shown above global fields */
  helperHint?: string;
}

// ── URL Validators (used both client and server) ────────────────────────────

const DRIVE_FOLDER_RE = /^https:\/\/drive\.google\.com\/drive\/folders\/[a-zA-Z0-9_-]+(\?[a-zA-Z0-9_=&]*)?$/;
const DRIVE_FILE_RE = /^https:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+(\/(view|edit|preview))?(\?[a-zA-Z0-9_=&]*)?$/;
const GOOGLE_DOC_RE = /^https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9_-]+(\/[a-zA-Z]+)?(\?[a-zA-Z0-9_=&]*)?$/;
const GITHUB_REPO_RE = /^https:\/\/github\.com\/[a-zA-Z0-9_-]{1,39}\/[a-zA-Z0-9._-]{1,100}\/?$/;
const WOKWI_RE = /^https:\/\/wokwi\.com\/projects\/\d+\/?$/;

export function validateDriveFolderUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Google Drive folder link is required.';
  if (!DRIVE_FOLDER_RE.test(trimmed)) return 'Enter a valid Google Drive folder link (https://drive.google.com/drive/folders/...).';
  return null;
}

export function validateDriveFileUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Google Drive file link is required.';
  if (!DRIVE_FILE_RE.test(trimmed)) return 'Enter a valid Google Drive file link (https://drive.google.com/file/d/...).';
  return null;
}

export function validateGoogleDocUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Google Doc link is required.';
  if (!GOOGLE_DOC_RE.test(trimmed)) return 'Enter a valid Google Doc link (https://docs.google.com/document/d/...).';
  return null;
}

export function validateGitHubUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (!trimmed) return 'GitHub repository link is required.';
  if (!GITHUB_REPO_RE.test(trimmed + '/')) return 'Enter a valid GitHub repository link (https://github.com/user/repo).';
  return null;
}

export function validateWokwiUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return 'Wokwi project link is required.';
  if (!WOKWI_RE.test(trimmed)) return 'Enter a valid Wokwi project link (https://wokwi.com/projects/<id>).';
  return null;
}

export function normalizeGitHubUrl(url: string): string {
  return url.trim().replace(/\.git$/, '').replace(/\/+$/, '');
}

/** Count words by splitting on whitespace. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Validate word limit. Returns error string or null. */
export function validateWordLimit(text: string, limit: number): string | null {
  const count = countWords(text);
  if (count > limit) return `Exceeds word limit (${count}/${limit}).`;
  return null;
}

/**
 * Validate a JSONL string: exactly 15 lines, each with sequence_id and pages (list of 3 lists of {speaker, text}).
 */
export function validateMangaJsonl(content: string): string | null {
  const lines = content.trim().split('\n');
  if (lines.length !== 15) return `JSONL must have exactly 15 lines (found ${lines.length}).`;
  for (let i = 0; i < lines.length; i++) {
    let obj: any;
    try { obj = JSON.parse(lines[i]); } catch { return `Line ${i + 1} is not valid JSON.`; }
    if (typeof obj.sequence_id === 'undefined') return `Line ${i + 1}: missing "sequence_id".`;
    if (!Array.isArray(obj.pages) || obj.pages.length !== 3) return `Line ${i + 1}: "pages" must be an array of 3 lists.`;
    for (let p = 0; p < 3; p++) {
      if (!Array.isArray(obj.pages[p])) return `Line ${i + 1}: pages[${p}] must be an array.`;
      for (let e = 0; e < obj.pages[p].length; e++) {
        const entry = obj.pages[p][e];
        if (typeof entry !== 'object' || typeof entry.speaker !== 'string' || typeof entry.text !== 'string')
          return `Line ${i + 1}: pages[${p}][${e}] must have "speaker" (string) and "text" (string).`;
      }
    }
  }
  return null;
}

export function validateFieldUrl(url: string, urlType: DeptField['urlType']): string | null {
  if (!url.trim()) return null; // empty handled by required check
  switch (urlType) {
    case 'drive-folder': return validateDriveFolderUrl(url);
    case 'drive-file': return validateDriveFileUrl(url);
    case 'google-doc': return validateGoogleDocUrl(url);
    case 'github': return validateGitHubUrl(url);
    case 'wokwi': return validateWokwiUrl(url);
    case 'any-https': {
      try {
        const u = new URL(url.trim());
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Must be an HTTP(S) link.';
      } catch { return 'Enter a valid URL.'; }
      return null;
    }
    default: return null;
  }
}

// ── ML Year Rules ───────────────────────────────────────────────────────────

function mlYearRule(year: number, selectedTaskIds: string[]): string | null {
  if (selectedTaskIds.length !== 2) return 'Select exactly 2 tasks.';

  const hasAdvanced = (id: string) =>
    id === 'manga-task' || id === 'ml-research-advanced';
  const advancedCount = selectedTaskIds.filter(hasAdvanced).length;

  if (year === 1) return null; // any two
  if (year === 2 && advancedCount < 1)
    return '2nd year: at least one task must be Advanced.';
  if (year >= 3 && advancedCount < 2)
    return '3rd year+: both tasks must be Advanced.';
  return null;
}

// ── Department Configs ──────────────────────────────────────────────────────

const DRIVE_SHARING_CHECKBOX = {
  key: 'drivePublic',
  label: "I set this folder to 'Anyone with the link: Viewer' and tested it in an incognito window.",
  required: true,
};
const DRIVE_WARNING = 'Restricted or login-required links count as not submitted.';

/** Config constant: is CAD Task 2 required for 2nd year? Set to true to enforce. */
export const CAD_TASK2_REQUIRED_FOR_2ND_YEAR = true;

/** Config constant: is Electronics Task 2 required for 2nd year? */
export const ELEC_TASK2_REQUIRED_FOR_2ND_YEAR = true;

// ─── ML Research / Applied ML ───────────────────────────────────────────────
const mlDept: DeptConfig = {
  id: 'ml',
  name: 'ML Research / Applied ML',
  category: 'INTELLIGENCE',
  color: '#d3c8ff',
  type: 'github',
  taskPicker: true,
  taskPickCount: 2,
  yearRule: mlYearRule,
  globalFields: [],
  globalCheckboxes: [],
  tasks: [
    // ── Applied ML: Basic — The Agentic Task ──
    {
      id: 'agentic-task',
      name: 'The Agentic Task',
      tag: 'Basic',
      fields: [
        { key: 'repo', label: 'GitHub repo URL', type: 'url', urlType: 'github', required: true, hint: 'Repository with your data analysis agent code.' },
        { key: 'readme', label: 'README / approach note', type: 'select', required: true,
          options: [{ value: '', label: 'Select…' }, { value: 'in-repo', label: 'In the repo README' }, { value: 'external', label: 'External link' }] },
        { key: 'readmeUrl', label: 'Approach note URL', type: 'url', urlType: 'any-https', conditionalOn: 'readme:external',
          hint: 'Link to your README or approach document if not in the repo.' },
        { key: 'demo', label: 'Demo / run instructions link', type: 'url', urlType: 'any-https', hint: 'Optional: link to a demo or deployment.' },
        // TODO: Full submission format from Google Doc not provided — add remaining fields when available.
      ],
      checkboxes: [],
    },
    // ── Applied ML: Advanced — The Manga Task ──
    {
      id: 'manga-task',
      name: 'The Manga Task',
      tag: 'Advanced',
      fields: [
        { key: 'repo', label: 'GitHub repo URL (training/experimentation, logs, inference code)', type: 'url', urlType: 'github', required: true },
        { key: 'predictions', label: 'Test predictions (.jsonl)', type: 'file', accept: '.jsonl', required: true,
          hint: 'JSONL file with exactly 15 lines. Each line: { sequence_id, pages: [[{speaker, text}, …], …] }.' },
        { key: 'weightsInRepo', label: 'Trained weights / adapters are committed in the repo', type: 'checkbox' },
        { key: 'weightsUrl', label: 'Trained weights / adapters download link', type: 'url', urlType: 'any-https',
          conditionalOn: 'weightsInRepo:unchecked', hint: 'A working download link for your trained weights or adapters.' },
      ],
      checkboxes: [
        { key: 'readmeOwn', label: 'README is written by me, not AI-generated.', required: true },
        { key: 'openWeight', label: 'I used only open-weight models and open-source tools.', required: true },
        { key: 'noHostedApi', label: 'No hosted AI inference APIs were used for training targets or test predictions.', required: true },
        { key: 'autoPredictions', label: 'Predictions were generated automatically from the images with no manual edits.', required: true },
        { key: 'citedExternal', label: 'External code/models are cited in the README.', required: true },
      ],
    },
    // ── ML Research: Basic — TODO ──
    {
      id: 'ml-research-basic',
      name: 'ML Research Task (Basic)',
      tag: 'Basic',
      fields: [
        // TODO: Title, fields, and details not yet provided. Add when available.
        { key: 'placeholder', label: 'Submission details coming soon', type: 'text', hint: 'This task\'s submission format will be shared shortly.' },
      ],
      checkboxes: [],
    },
    // ── ML Research: Advanced — TODO ──
    {
      id: 'ml-research-advanced',
      name: 'ML Research Task (Advanced)',
      tag: 'Advanced',
      fields: [
        // TODO: Title, fields, and details not yet provided. Add when available.
        { key: 'placeholder', label: 'Submission details coming soon', type: 'text', hint: 'This task\'s submission format will be shared shortly.' },
      ],
      checkboxes: [],
    },
  ],
};

// ─── CAD ────────────────────────────────────────────────────────────────────
const cadDept: DeptConfig = {
  id: 'cad',
  name: 'CAD',
  category: 'HARDWARE',
  color: '#ffcb9c',
  type: 'drive',
  folderNameHint: '<YourName>_CAD',
  folderTree: `<YourName>_CAD/
├── Task1/
│   ├── Task1.stl  or  Task1.step
│   └── Design_rationale.docx
└── Task2/  (if attempted)
    ├── Task2.step
    ├── Demo.mp4 / Demo.gif  or  Demo_0deg.png … Demo_270deg.png
    └── Design_rationale.docx`,
  globalFields: [
    { key: 'driveUrl', label: 'Google Drive folder link', type: 'url', urlType: 'drive-folder', required: true,
      hint: `Name your folder exactly: <YourName>_CAD. ${DRIVE_WARNING}` },
  ],
  globalCheckboxes: [DRIVE_SHARING_CHECKBOX],
  tasks: [
    {
      id: 'cad-task1',
      name: 'Task 1',
      tag: 'Required',
      fields: [],
      checkboxes: [
        { key: 'task1Files', label: 'Task1 folder contains Task1.stl or Task1.step and Design_rationale.docx (150–250 words).', required: true },
      ],
    },
    {
      id: 'cad-task2',
      name: 'Task 2',
      tag: 'Optional',   // tag shown; actual requirement controlled by CAD_TASK2_REQUIRED_FOR_2ND_YEAR
      fields: [
        { key: 'task2Attempted', label: 'Task 2 attempted?', type: 'toggle' },
      ],
      checkboxes: [
        { key: 'task2Step', label: 'Task2.step with joints/mates preserved.', required: true },
        { key: 'task2Demo', label: 'Demo at 0°/90°/180°/270° (video/GIF or Demo_0deg.png … Demo_270deg.png).', required: true },
        { key: 'task2Rationale', label: 'Design_rationale.docx (150–250 words).', required: true },
      ],
    },
  ],
  yearRule: (year, selectedTaskIds) => {
    if (CAD_TASK2_REQUIRED_FOR_2ND_YEAR && year === 2 && !selectedTaskIds.includes('cad-task2'))
      return 'Task 2 is required for 2nd year students.';
    return null;
  },
};

// ─── Electronics ────────────────────────────────────────────────────────────
const elecDept: DeptConfig = {
  id: 'electronics',
  name: 'Electronics',
  category: 'HARDWARE',
  color: '#ffcb9c',
  type: 'drive',
  folderNameHint: '<YourName>_Electronics',
  folderTree: `<YourName>_Electronics/
├── Task1/
│   ├── Link.txt  (or Demo.mp4 for hardware)
│   ├── Code.txt
│   └── Design_rationale.docx
├── Task2/
│   ├── Link.txt  (or Demo.mp4)
│   ├── Code.txt
│   └── Design_rationale.docx
└── Task3/  (bonus, omit if not attempted)
    ├── MPU6050.zip
    └── Design_rationale.docx`,
  globalFields: [
    { key: 'driveUrl', label: 'Google Drive folder link', type: 'url', urlType: 'drive-folder', required: true,
      hint: `Name your folder exactly: <YourName>_Electronics. ${DRIVE_WARNING}` },
  ],
  globalCheckboxes: [DRIVE_SHARING_CHECKBOX],
  tasks: [
    {
      id: 'elec-task1',
      name: 'Task 1 — Redundant Sensor Voting',
      tag: 'Required',
      fields: [
        { key: 'hardware', label: 'Physical hardware instead of Wokwi?', type: 'toggle' },
        { key: 'wokwiUrl', label: 'Wokwi project URL', type: 'url', urlType: 'wokwi', conditionalOn: 'hardware:unchecked',
          hint: 'Link to your Wokwi simulation.' },
      ],
      checkboxes: [
        { key: 'linkTxt', label: 'Link.txt contains only the raw URL.', required: true },
        { key: 'codeTxt', label: 'Code.txt is plain text (not .ino).', required: true },
        { key: 'rationale', label: 'Design_rationale.docx (150–250 words) covers threshold, hold-last-position, and flicker prevention.', required: true },
        { key: 'hardwareDemo', label: 'Demo.mp4 included in the folder (hardware demo).', required: false }, // only if hardware toggle is on
      ],
    },
    {
      id: 'elec-task2',
      name: 'Task 2 — Simon Says with Heartbeat',
      tag: 'Optional', // required for 2nd year, controlled by ELEC_TASK2_REQUIRED_FOR_2ND_YEAR
      fields: [
        { key: 'task2Attempted', label: 'Task 2 attempted?', type: 'toggle' },
        { key: 'hardware2', label: 'Physical hardware instead of Wokwi?', type: 'toggle', conditionalOn: 'task2Attempted:checked' },
        { key: 'wokwiUrl2', label: 'Wokwi project URL', type: 'url', urlType: 'wokwi', conditionalOn: 'hardware2:unchecked',
          hint: 'Link to your Wokwi simulation for Task 2.' },
      ],
      checkboxes: [
        { key: 'linkTxt2', label: 'Link.txt contains only the raw URL.', required: true },
        { key: 'codeTxt2', label: 'Code.txt is plain text (not .ino).', required: true },
        { key: 'rationale2', label: 'Design_rationale.docx (150–250 words) covers speed-ramp formula and heartbeat independence.', required: true },
      ],
    },
    {
      id: 'elec-task3',
      name: 'Task 3 — MPU6050 KiCad Schematic',
      tag: 'Bonus',
      fields: [
        { key: 'task3Attempted', label: 'Task 3 attempted?', type: 'toggle' },
      ],
      checkboxes: [
        { key: 'kicadZip', label: 'MPU6050.zip generated with KiCad\'s native Archive Project (not manually zipped).', required: true },
        { key: 'rationale3', label: 'Design_rationale.docx (200–350 words) covers decoupling, pull-ups, and AD0.', required: true },
      ],
    },
  ],
  yearRule: (year, selectedTaskIds) => {
    if (ELEC_TASK2_REQUIRED_FOR_2ND_YEAR && year === 2 && !selectedTaskIds.includes('elec-task2'))
      return 'Task 2 (Simon Says with Heartbeat) is required for 2nd year students.';
    return null;
  },
};

// ─── Web Development ────────────────────────────────────────────────────────
const webDept: DeptConfig = {
  id: 'web-dev',
  name: 'Web Development',
  category: 'BUILD',
  color: '#bbf06c',
  type: 'github',
  globalFields: [
    { key: 'reviewerNote', label: 'Anything else reviewers should know?', type: 'textarea', maxLength: 500,
      hint: 'Optional note (max ~500 chars) for anything you want reviewers to know.' },
  ],
  globalCheckboxes: [
    { key: 'repoPublic', label: 'All repositories are public.', required: true },
    { key: 'noSecrets', label: 'No secrets committed; .env.example included.', required: true },
  ],
  tasks: [
    {
      id: 'web-task1',
      name: 'Task 1 — Debugging Stage: Canteen Chaos',
      tag: 'Required',
      fields: [
        { key: 'forkUrl', label: 'Public fork URL of the "Canteen Chaos" repo', type: 'url', urlType: 'github', required: true,
          hint: 'Fork the Canteen Chaos repository and submit the fork URL.' },
      ],
      checkboxes: [
        { key: 'logMd', label: 'Fork contains fixes AND a LOG.md with reproduction steps, root-cause analysis, and why changes belong where they were made.', required: true },
      ],
    },
    {
      id: 'web-task2',
      name: 'Task 2 — Gym Slot Booking',
      tag: 'Optional',
      fields: [
        { key: 'task2Attempted', label: 'Task 2 attempted?', type: 'toggle' },
        { key: 'repoUrl', label: 'GitHub repository URL', type: 'url', urlType: 'github',
          conditionalOn: 'task2Attempted:checked', hint: 'Your Gym Slot Booking project repo.' },
        { key: 'liveUrl', label: 'Live / deployed URL', type: 'url', urlType: 'any-https',
          conditionalOn: 'task2Attempted:checked', hint: 'Optional: link to your deployed app.' },
      ],
      checkboxes: [
        { key: 'commitHistory', label: 'Meaningful commit history.', required: true },
        { key: 'readmeComplete', label: 'README includes stack/data-model note (10 lines max), assumptions, setup instructions, and admin/member test credentials.', required: true },
        { key: 'liveLinks', label: 'Live links included if deployed.', required: false },
      ],
    },
  ],
};

// ─── ROS ────────────────────────────────────────────────────────────────────
const rosDept: DeptConfig = {
  id: 'ros',
  name: 'ROS',
  category: 'HARDWARE',
  color: '#ffcb9c',
  type: 'mixed',
  folderNameHint: '<YourName>_ROS',
  folderTree: `<YourName>_ROS/
├── Link.txt   (only the raw GitHub URL)
├── Demo.mp4   (one-minute screen recording)
└── README.md  (copy of repo README)`,
  globalFields: [
    { key: 'driveUrl', label: 'Google Drive folder link', type: 'url', urlType: 'drive-folder', required: true,
      hint: `Name your folder exactly: <YourName>_ROS. Keep separate from Electronics. ${DRIVE_WARNING}` },
    { key: 'repoUrl', label: 'GitHub repository URL', type: 'url', urlType: 'github', required: true,
      hint: 'Your public repo with the complete turtlebot_patrol package.' },
    { key: 'rosDistro', label: 'ROS distribution used', type: 'select',
      options: [{ value: '', label: 'Select (optional)…' }, { value: 'humble', label: 'Humble' }, { value: 'jazzy', label: 'Jazzy' }, { value: 'other', label: 'Other' }] },
  ],
  globalCheckboxes: [
    DRIVE_SHARING_CHECKBOX,
  ],
  tasks: [
    {
      id: 'ros-patrol',
      name: 'Autonomous TurtleBot Patrol & Obstacle Avoidance',
      tag: 'Required',
      fields: [],
      checkboxes: [
        { key: 'repoComplete', label: 'Repo is public and contains the complete turtlebot_patrol package (source, config, launch files, README).', required: true },
        { key: 'demoVideo', label: 'Demo.mp4 (~1 min) shows patrol, obstacle avoidance, and the /trigger_estop service being triggered and reset.', required: true },
        { key: 'readmeCopied', label: 'README.md copied into the Drive folder with setup, build, launch, usage/testing instructions and at least 3 images.', required: true },
      ],
    },
  ],
};

// ─── App Development ────────────────────────────────────────────────────────
const appDevDept: DeptConfig = {
  id: 'app-dev',
  name: 'App Development',
  category: 'BUILD',
  color: '#bbf06c',
  type: 'github',
  helperHint: 'Stage 1 is for everyone including first years; Stage 2 is designed for second-years; Stage 3 is the optional X-factor. Choose the stage you reached.',
  globalFields: [
    { key: 'appName', label: 'App / product name', type: 'text', required: true, hint: 'The name you chose for your save-for-later app.' },
    { key: 'stageReached', label: 'Stage reached', type: 'select', required: true,
      options: [
        { value: '', label: 'Select stage…' },
        { value: '1', label: 'Stage 1 — Local app (data on-device only)' },
        { value: '2', label: 'Stage 2 — Cross-device private cloud (auth + sync)' },
        { value: '3', label: 'Stage 3 — Product features (sharing, attachments, advanced)' },
      ] },
    { key: 'repoUrl', label: 'GitHub repository URL', type: 'url', urlType: 'github', required: true },
    { key: 'buildUrl', label: 'Runnable build link (APK, Expo, TestFlight, or other)', type: 'url', urlType: 'any-https',
      hint: 'Link to your APK (Drive file or direct), Expo link, TestFlight link, or another URL. Leave blank if no hosted build is practical.' },
    { key: 'noBuild', label: 'No hosted build is practical; clear setup instructions are in the README', type: 'checkbox',
      hint: 'Only allowed when the build link above is left empty.' },
    { key: 'techStack', label: 'Tech stack', type: 'select',
      options: [
        { value: '', label: 'Select (optional)…' },
        { value: 'flutter', label: 'Flutter' },
        { value: 'react-native', label: 'React Native / Expo' },
        { value: 'native-android', label: 'Native Android (Kotlin / Java)' },
        { value: 'other', label: 'Other' },
      ] },
    // Stage 2+ conditional fields
    { key: 'authExplained', label: 'README explains how authentication works, where data is stored, and how one user\'s data is protected from another user', type: 'checkbox',
      conditionalOn: 'stageReached:2+', required: true },
    { key: 'privacyBackend', label: 'Privacy is enforced on the backend (Firestore Security Rules / Supabase RLS / server-side ownership checks), not only in the UI', type: 'checkbox',
      conditionalOn: 'stageReached:2+', required: true },
    // Stage 3 conditional fields
    { key: 'shareInto', label: 'Share-into-app (receive shared text/URLs from phone Share menu) is implemented and handles malformed content without crashing', type: 'checkbox',
      conditionalOn: 'stageReached:3', required: true },
    { key: 'advancedMissions', label: 'Advanced missions completed', type: 'multi-select', required: true, minSelect: 1,
      conditionalOn: 'stageReached:3',
      options: [
        { value: 'sync', label: 'A — Better sync behaviour' },
        { value: 'sharing', label: 'B — Public read-only sharing' },
        { value: 'vault', label: 'C — Attachment vault' },
        { value: 'resurface', label: 'D — Resurface an item later' },
        { value: 'ownership', label: 'E — Data ownership' },
      ] },
    { key: 'reviewerNote', label: 'Note for reviewers', type: 'textarea', wordLimit: 100,
      hint: 'Optional (max 100 words). Test accounts, build quirks, etc.' },
  ],
  globalCheckboxes: [
    { key: 'commitHistory', label: 'Commit history shows work over time.', required: true },
    { key: 'readmeComplete', label: 'README covers what was built, stage reached, tech stack, how to run, known issues, and important technical decisions.', required: true },
    { key: 'archDiagram', label: 'A simple architecture diagram is included in the README or repo.', required: true },
  ],
  tasks: [],
};

// ─── Video Editing ──────────────────────────────────────────────────────────
const LINK_SHARING_CHECKBOX = (key: string) => ({
  key,
  label: "I set this to 'Anyone with the link: Viewer' and opened it in an incognito window.",
  required: true,
});

const videoEditDept: DeptConfig = {
  id: 'video-editing',
  name: 'Video Editing',
  category: 'CREATIVE',
  color: '#ffd9ec',
  type: 'drive',
  helperHint: 'Private or inaccessible links will not be evaluated.',
  globalFields: [
    { key: 'driveUrl', label: 'Google Drive link to final MP4', type: 'url', urlType: 'drive-file', required: true,
      hint: 'Public Google Drive file link to your final video.' },
    { key: 'software', label: 'Software / video-editing apps used', type: 'text', required: true },
    { key: 'creativeNote', label: 'Creative note', type: 'textarea', required: true, wordLimit: 50,
      hint: 'Explain your concept or approach (max 50 words).' },
  ],
  globalCheckboxes: [
    LINK_SHARING_CHECKBOX('drivePublic'),
    { key: 'fileName', label: '', required: true }, // label set dynamically via filenameHint
    { key: 'originalQuality', label: 'Exported at original quality, not a compressed WhatsApp/Instagram version.', required: true },
    { key: 'duration', label: 'Duration is 45–60 seconds, vertical 9:16, MP4 (recommended 1080×1920 or higher).', required: true },
    { key: 'byteFootage', label: 'The supplied BYTE event footage is the primary visual source; any external assets are royalty-free or official BYTE/Algo Trading Sprint assets.', required: true },
    { key: 'noTemplate', label: 'No pre-made video template is used as the main structure.', required: true },
  ],
  tasks: [],
};

// ─── Outreach ───────────────────────────────────────────────────────────────
const outreachDept: DeptConfig = {
  id: 'outreach',
  name: 'Outreach',
  category: 'COMMUNITY',
  color: '#b3e8ef',
  type: 'drive',
  helperText: {
    title: 'Limits reference',
    content: `Q2a: max 150 words
Q2b: max 120 words
Q2c: max 280 characters; banned words: "excited", "amazing", "don't miss out", 🔥 fire emoji; at most one emoji
Q3: max 70 words
Q4: max 60 words
Q5: max 70 words
Q6: table format — Name & what it does; Why it fits (max 2 lines); Concrete offer beyond generic visibility; Exact contact point (person, role, or form)`,
  },
  helperHint: 'Upload a single PDF or Google Doc with all your answers. Private or inaccessible links will not be evaluated.',
  globalFields: [
    { key: 'docUrl', label: 'Google Drive or Google Doc link to your submission', type: 'url', urlType: 'any-https', required: true,
      hint: 'Accepted: Google Drive file link (drive.google.com/file/d/...) or Google Doc link (docs.google.com/document/d/...).' },
  ],
  globalCheckboxes: [
    LINK_SHARING_CHECKBOX('docPublic'),
    { key: 'fileName', label: '', required: true }, // dynamically: FullName_Branch_Outreach
    { key: 'taskOrder', label: 'Answers are in task order.', required: true },
    { key: 'noRealContact', label: 'I did not contact any real business or person using BYTE\'s name; this is a simulation and I submitted one response per question.', required: true },
    { key: 'limitsRespected', label: 'Word and character limits are respected.', required: true },
    { key: 'llmDisclosure', label: 'The document ends with a one-line LLM disclosure (where I used an LLM, or that I did not).', required: true },
    { key: 'q6Real', label: 'Question 6 lists three real entities and nothing is fabricated or copied, presented as a table.', required: true },
  ],
  tasks: [],
};

// ─── Graphic Design ─────────────────────────────────────────────────────────
/** TODO: Graphic Design year rule not specified in brief. Leave null. */
export const GD_MIN_REQUIRED_TASKS = 1; // student must complete at least 1 of 2 tasks

const gdDept: DeptConfig = {
  id: 'graphic-design',
  name: 'Graphic Design',
  category: 'CREATIVE',
  color: '#ffd9ec',
  type: 'drive',
  helperHint: 'Complete at least one task. Both may be submitted. Private or inaccessible links will not be evaluated.',
  globalFields: [],
  globalCheckboxes: [],
  tasks: [
    {
      id: 'gd-poster',
      name: 'Task 1 — BYTE Freshers Poster',
      tag: 'Required',
      fields: [
        { key: 'driveUrl', label: 'Google Drive link to final PNG/JPG', type: 'url', urlType: 'drive-file', required: true,
          hint: 'Public Google Drive file link to your poster.' },
        { key: 'software', label: 'Design software used', type: 'text', required: true },
        { key: 'canvaUrl', label: 'Editable Canva link', type: 'url', urlType: 'any-https',
          conditionalOn: 'software:Canva', required: true,
          hint: 'Required when using Canva — share the editable link.' },
        { key: 'concept', label: 'Concept explanation', type: 'textarea', required: true, wordLimit: 50,
          hint: 'Explain your design concept (max 50 words).' },
      ],
      checkboxes: [
        LINK_SHARING_CHECKBOX('posterPublic'),
        { key: 'posterFile', label: '', required: true }, // dynamic: Name_Branch_Poster.png
        { key: 'qrReadable', label: 'QR code scans and text is readable on mobile.', required: true },
        { key: 'resolution', label: '1080×1350 px (4:5) high-resolution export.', required: true },
        { key: 'contentPack', label: 'Used the supplied content pack and did not fabricate events, stats, or claims; event photos are the supplied photos, not AI-generated.', required: true },
        { key: 'noTemplate', label: 'No pre-made template used as the primary design.', required: true },
      ],
    },
    {
      id: 'gd-merch',
      name: 'Task 2 — BYTE T-shirt Merchandise',
      tag: 'Optional',
      fields: [
        { key: 'task2Attempted', label: 'Task 2 attempted?', type: 'toggle' },
        { key: 'driveUrl2', label: 'Google Drive link to final PNG/JPG', type: 'url', urlType: 'drive-file',
          conditionalOn: 'task2Attempted:checked', required: true,
          hint: 'Public Google Drive file link to your merch design.' },
        { key: 'software2', label: 'Design software used', type: 'text',
          conditionalOn: 'task2Attempted:checked', required: true },
        { key: 'canvaUrl2', label: 'Editable Canva link', type: 'url', urlType: 'any-https',
          conditionalOn: 'software2:Canva',
          hint: 'Required when using Canva.' },
        { key: 'references', label: 'Resources, references, or inspirations used', type: 'url-list',
          conditionalOn: 'task2Attempted:checked', required: true,
          hint: 'At least one link. Add references and inspirations.' },
        { key: 'concept2', label: 'Concept explanation', type: 'textarea', wordLimit: 50,
          conditionalOn: 'task2Attempted:checked', required: true,
          hint: 'Explain your design concept (max 50 words).' },
      ],
      checkboxes: [
        LINK_SHARING_CHECKBOX('merchPublic'),
        { key: 'merchFile', label: '', required: true }, // dynamic: Name_Branch_Merch.png
        { key: 'original', label: 'Design is original and does not copy last year\'s merchandise.', required: true },
      ],
    },
  ],
  yearRule: (_year, selectedTaskIds) => {
    if (selectedTaskIds.length < GD_MIN_REQUIRED_TASKS)
      return `Complete at least ${GD_MIN_REQUIRED_TASKS} task.`;
    return null;
  },
};

// ─── Cybersecurity ──────────────────────────────────────────────────────────
const cyberDept: DeptConfig = {
  id: 'cybersecurity',
  name: 'Cybersecurity',
  category: 'SECURITY',
  color: '#ffb3ad',
  type: 'mixed',
  helperHint: 'Private or inaccessible repositories and documents will not be evaluated. Your approach and effort count.',
  globalFields: [
    { key: 'repoUrl', label: 'GitHub repository URL', type: 'url', urlType: 'github', required: true,
      hint: 'Public repo containing your work for all challenges and proof files.' },
    { key: 'docUrl', label: 'Google Doc URL', type: 'url', urlType: 'google-doc', required: true,
      hint: 'Public Google Doc explaining your thought process and tools in your own words.' },
    { key: 'challengesAttempted', label: 'Challenges attempted', type: 'multi-select',
      hint: 'Informational only — check what you attempted.',
      options: [
        { value: 'crypto', label: 'Cryptography' },
        { value: 'stego', label: 'Steganography' },
        { value: 'pwn', label: 'Binary Exploitation (Pwn)' },
      ] },
  ],
  globalCheckboxes: [
    { key: 'repoPublic', label: 'Repository is public.', required: true },
    { key: 'docPublic', label: "Google Doc is set to 'Anyone with the link' and opens in incognito.", required: true },
    { key: 'docExplains', label: 'The doc explains exactly what I did, the tools used, and my reasoning for each challenge I attempted.', required: true },
  ],
  tasks: [],
};

// ── Export ───────────────────────────────────────────────────────────────────

export const deptConfigs: DeptConfig[] = [
  mlDept,
  cadDept,
  elecDept,
  webDept,
  rosDept,
  appDevDept,
  cyberDept,
  gdDept,
  videoEditDept,
  outreachDept,
];

export function getDeptConfig(id: string): DeptConfig | undefined {
  return deptConfigs.find(d => d.id === id);
}

/**
 * Check whether a field is effectively required given the current form state.
 * Handles conditional fields gated on toggles/checkboxes.
 * Supports: 'key:checked', 'key:unchecked', 'key:external', 'key:2+' (numeric >=), 'key:value' (exact or contains).
 */
export function isFieldActive(field: DeptField, formData: Record<string, any>): boolean {
  if (!field.conditionalOn) return true;
  const [parentKey, parentVal] = field.conditionalOn.split(':');
  const parentValue = formData[parentKey];
  if (parentVal === 'checked') return !!parentValue;
  if (parentVal === 'unchecked') return !parentValue;
  if (parentVal === 'external') return parentValue === 'external';
  // Numeric range: '2+' means >= 2
  if (parentVal.endsWith('+')) {
    const threshold = parseInt(parentVal.slice(0, -1), 10);
    const val = parseInt(parentValue, 10);
    return !isNaN(val) && val >= threshold;
  }
  // String contains match (case-insensitive) for things like software:Canva
  if (typeof parentValue === 'string' && parentValue.toLowerCase().includes(parentVal.toLowerCase())) return true;
  return parentValue === parentVal;
}

/**
 * Check whether a task's toggle-gated checkboxes should be visible (the task is "attempted").
 * If the task has a field with key matching `<taskId-prefix>Attempted` and type toggle, return its value.
 * For required tasks (tag=Required), always return true.
 */
export function isTaskAttempted(task: TaskConfig, formData: Record<string, any>): boolean {
  if (task.tag === 'Required') return true;
  const toggleField = task.fields.find(f => f.type === 'toggle' && f.key.includes('Attempted'));
  if (!toggleField) return true; // no toggle = always attempted
  return !!formData[toggleField.key];
}
