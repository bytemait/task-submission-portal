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

/**
 * Generates an RFC 4180 compliant CSV string from an array of submissions,
 * dynamically mapping tracks and fields based on shared/tracks.ts.
 */
export function buildSubmissionsCsv(submissions: Submission[]): string {
  // Base headers for applicant identification.
  const headers = [
    'Enrollment', 'Name', 'Email', 'Phone', 'Department', 'Year / Semester', 'Other Societies',
    'Instagram', 'Twitter/X', 'Discord', 'Status', 'Submitted At', 'Last Updated', 'Selected Tracks',
    'Academic Branch', 'Semester', 'Societies',
  ];
  const trackColumns: { trackId: string; fieldKey: string; header: string }[] = [];
  for (const track of tracks) {
    for (const field of track.fields) {
      const header = `${track.name} - ${field.label}`;
      trackColumns.push({ trackId: track.id, fieldKey: field.key, header });
      headers.push(header);
    }
  }
  const departmentColumns: { deptId: string; fieldKey: string; header: string }[] = [];

  for (const dept of deptConfigs) {
    for (const field of dept.globalFields) {
      const header = `${dept.name} - ${field.label}`;
      departmentColumns.push({ deptId: dept.id, fieldKey: field.key, header });
      headers.push(header);
    }
    for (const task of dept.tasks) {
      for (const field of task.fields) {
        if (field.type === 'toggle') continue;
        const header = `${dept.name} [${task.name}] - ${field.label}`;
        departmentColumns.push({ deptId: dept.id, fieldKey: field.key, header });
        headers.push(header);
      }
    }
  }


  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const s of submissions) {
    const selectedTrackNames = s.selected
      .map(id => tracks.find(t => t.id === id)?.name || id)
      .join('; ');

    const row = [
      escapeCsvCell(s.student.enrollment),
      escapeCsvCell(s.student.name),
      escapeCsvCell(s.student.email),
      escapeCsvCell(s.student.phone),
      escapeCsvCell(s.student.dept || ''),
      escapeCsvCell(s.student.year),
      escapeCsvCell(s.student.otherSocieties || ''),
      escapeCsvCell(s.student.instagram || s.student.socials?.instagram || ''),
      escapeCsvCell(s.student.twitter || s.student.socials?.twitter || ''),
      escapeCsvCell(s.student.discord || s.student.socials?.discord || ''),
      escapeCsvCell(s.status),
      escapeCsvCell(s.submittedAt || ''),
      escapeCsvCell(s.updatedAt || ''),
      escapeCsvCell(selectedTrackNames),
      escapeCsvCell(s.student.academicBranch || ''),
      escapeCsvCell(s.student.semester || ''),
      escapeCsvCell((s.student.societies || []).join('; ')),
    ];

    for (const col of trackColumns) {
      row.push(escapeCsvCell(s.answers?.[col.trackId]?.[col.fieldKey] || ''));
    }

    for (const col of departmentColumns) {
      const value = s.deptAnswers?.[col.deptId]?.[col.fieldKey] ?? s.answers?.[col.deptId]?.[col.fieldKey] ?? '';
      row.push(escapeCsvCell(Array.isArray(value) ? value.join('; ') : value));
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
