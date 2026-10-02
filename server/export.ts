import { tracks, type Submission } from '../shared/tracks.ts';
import { deptConfigs } from '../shared/submissionConfig.ts';

/**
 * Escapes a cell according to RFC 4180 and protects against CSV formula injection.
 * If a value starts with formula characters (=, +, -, @, \t, \r), prepend a single quote (').
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  let value = String(raw);

  // CSV Formula Injection mitigation (Excel / Google Sheets macro execution prevention)
  if (/^[\s]*[=+\-@\t\r]/.test(value)) {
    value = "'" + value;
  }

  // If value contains quotes, commas, newlines, or leading/trailing spaces, quote it
  if (/[",\r\n]/.test(value) || value.startsWith(' ') || value.endsWith(' ')) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function getLegacyKeys(key: string): string[] {
  const legacy: string[] = [];
  if (key === 'githubUrl' || key === 'repoUrl' || key === 'forkUrl') legacy.push('repo');
  if (key === 'deployedUrl' || key === 'liveUrl') legacy.push('demo');
  if (key === 'note' || key === 'notes' || key === 'generalNote' || key === 'creativeNote') legacy.push('notes');
  if (key === 'portfolioUrl' || key === 'driveUrl' || key === 'docUrl') legacy.push('work', 'paper', 'writeup');
  return legacy;
}

/**
 * Generates an RFC 4180 compliant CSV string from an array of submissions,
 * dynamically mapping department task forms based on shared/submissionConfig.ts.
 */
export function buildSubmissionsCsv(submissions: Submission[]): string {
  // Clean, unified headers for applicant identification
  const headers = [
    'Enrollment',
    'Name',
    'Email',
    'Phone',
    'Branch',
    'Year',
    'Semester',
    'Societies',
    'Instagram',
    'Twitter/X',
    'Discord',
    'Status',
    'Submitted At',
    'Last Updated',
    'Selected Departments',
  ];

  // Dynamic department task columns from the active submission configuration
  const departmentColumns: { deptId: string; fieldKey: string; legacyKeys: string[]; header: string }[] = [];

  for (const dept of deptConfigs) {
    for (const field of dept.globalFields) {
      const header = `${dept.name} - ${field.label}`;
      departmentColumns.push({ deptId: dept.id, fieldKey: field.key, legacyKeys: getLegacyKeys(field.key), header });
      headers.push(header);
    }
    for (const task of dept.tasks) {
      for (const field of task.fields) {
        if (field.type === 'toggle') continue;
        const header = `${dept.name} [${task.name}] - ${field.label}`;
        departmentColumns.push({ deptId: dept.id, fieldKey: field.key, legacyKeys: getLegacyKeys(field.key), header });
        headers.push(header);
      }
    }
  }

  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const s of submissions) {
    const selectedDeptNames = s.selected
      .map(id => deptConfigs.find(d => d.id === id)?.name || tracks.find(t => t.id === id)?.name || id)
      .join('; ');

    // Normalize student profile fields with backward compatibility
    const branch = s.student.academicBranch || s.student.dept || '';
    const year = s.student.year || '';
    const semester = s.student.semester || (year.match(/Sem\s*(\d+)/i)?.[1] ? `Sem ${year.match(/Sem\s*(\d+)/i)![1]}` : '');
    const societies = (s.student.societies && s.student.societies.length > 0)
      ? s.student.societies.join('; ')
      : (s.student.otherSocieties || '');
    const instagram = s.student.instagram || s.student.socials?.instagram || '';
    const twitter = s.student.twitter || s.student.socials?.twitter || '';
    const discord = s.student.discord || s.student.socials?.discord || '';

    const row = [
      escapeCsvCell(s.student.enrollment),
      escapeCsvCell(s.student.name),
      escapeCsvCell(s.student.email),
      escapeCsvCell(s.student.phone),
      escapeCsvCell(branch),
      escapeCsvCell(year),
      escapeCsvCell(semester),
      escapeCsvCell(societies),
      escapeCsvCell(instagram),
      escapeCsvCell(twitter),
      escapeCsvCell(discord),
      escapeCsvCell(s.status),
      escapeCsvCell(s.submittedAt || ''),
      escapeCsvCell(s.updatedAt || ''),
      escapeCsvCell(selectedDeptNames),
    ];

    for (const col of departmentColumns) {
      let value = s.deptAnswers?.[col.deptId]?.[col.fieldKey] ?? s.answers?.[col.deptId]?.[col.fieldKey];

      // If value is not set under the primary key, check legacy keys
      if (value === undefined && col.legacyKeys) {
        for (const lk of col.legacyKeys) {
          const lv = s.deptAnswers?.[col.deptId]?.[lk] ?? s.answers?.[col.deptId]?.[lk];
          if (lv !== undefined) {
            value = lv;
            break;
          }
        }
      }

      const cellValue = value !== undefined && value !== null
        ? (Array.isArray(value) ? value.join('; ') : String(value))
        : '';

      row.push(escapeCsvCell(cellValue));
    }

    rows.push(row.join(','));
  }

  return rows.join('\r\n');
}

/**
 * Serializes submissions to formatted JSON.
 */
export function buildSubmissionsJson(submissions: Submission[]): string {
  return JSON.stringify(submissions, null, 2);
}
