import type { Submission } from '../shared/tracks.ts';
import {
  deptConfigs, isFieldActive, isTaskAttempted,
  type DeptField, type TaskConfig,
} from '../shared/submissionConfig.ts';

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
 * dynamically mapping tracks, department fields, checkboxes, toggles, and task selections.
 */
export function buildSubmissionsCsv(submissions: Submission[]): string {
  // Base headers for applicant identification.
  const headers = [
    'Enrollment', 'Name', 'Email', 'Phone', 'Department', 'Year / Semester', 'Other Societies',
    'Instagram', 'Twitter/X', 'Discord', 'Status', 'Submitted At', 'Last Updated', 'Selected Tracks',
    'Academic Branch', 'Semester', 'Societies',
  ];



  // Department columns — covers ALL data: globalFields, globalCheckboxes,
  // task fields (including toggles), task checkboxes, and deptSelected.
  type DeptColumnDef = {
    deptId: string;
    fieldKey: string;
    header: string;
    task?: TaskConfig;
    field?: DeptField;
    isAttemptToggle?: boolean;
  };
  const departmentColumns: DeptColumnDef[] = [];

  for (const dept of deptConfigs) {
    // deptSelected — which tasks the student picked (for taskPicker depts like ML)
    if (dept.taskPicker) {
      const header = `${dept.name} - Selected Tasks`;
      departmentColumns.push({ deptId: dept.id, fieldKey: '__selectedTasks__', header });
      headers.push(header);
    }

    // Global fields (url, text, textarea, select, multi-select, file, url-list, checkbox, toggle)
    for (const field of dept.globalFields) {
      const header = `${dept.name} - ${field.label}`;
      departmentColumns.push({ deptId: dept.id, fieldKey: field.key, header, field });
      headers.push(header);
    }

    // Global checkboxes (sharing confirmations, attestations, etc.)
    for (const cb of dept.globalCheckboxes) {
      const label = cb.label || cb.key;
      const header = `${dept.name} - ✓ ${label.substring(0, 80)}`;
      departmentColumns.push({ deptId: dept.id, fieldKey: cb.key, header });
      headers.push(header);
    }

    // Task-level fields and checkboxes
    for (const task of dept.tasks) {
      // ALL task fields — including toggles (task2Attempted, hardware, etc.)
      for (const field of task.fields) {
        const header = `${dept.name} [${task.name}] - ${field.label}`;
        const isAttemptToggle = field.type === 'toggle' && field.key.includes('Attempted');
        departmentColumns.push({
          deptId: dept.id,
          fieldKey: field.key,
          header,
          task,
          field,
          isAttemptToggle,
        });
        headers.push(header);
      }

      // Task checkboxes (attestations within a task)
      for (const cb of task.checkboxes) {
        const label = cb.label || cb.key;
        const header = `${dept.name} [${task.name}] - ✓ ${label.substring(0, 80)}`;
        departmentColumns.push({ deptId: dept.id, fieldKey: cb.key, header, task });
        headers.push(header);
      }
    }
  }

  const rows: string[] = [headers.map(escapeCsvCell).join(',')];

  for (const s of submissions) {
    const selectedTrackNames = s.selected
      .map(id => deptConfigs.find(d => d.id === id)?.name || id)
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



    const deptAnswers = s.deptAnswers || {};

    for (const col of departmentColumns) {
      // 1. If the department was not selected by the applicant, output empty cell
      if (!s.selected.includes(col.deptId)) {
        row.push(escapeCsvCell(''));
        continue;
      }

      // 2. Special handling for deptSelected (task picker selections)
      if (col.fieldKey === '__selectedTasks__') {
        const selected = s.deptSelected?.[col.deptId] || [];
        row.push(escapeCsvCell(selected.join('; ')));
        continue;
      }

      const answers = deptAnswers[col.deptId] ?? s.answers?.[col.deptId] ?? {};
      const deptConfig = deptConfigs.find(d => d.id === col.deptId);

      // 3. Task-level gating:
      if (col.task) {
        // 3a. For task-picker departments (like ML), check if this task was chosen
        if (deptConfig?.taskPicker) {
          const chosenTasks = s.deptSelected?.[col.deptId] || [];
          if (!chosenTasks.includes(col.task.id)) {
            row.push(escapeCsvCell(''));
            continue;
          }
        }

        // 3b. For tasks with an attempted-toggle pattern (Electronics Task 2/3, CAD Task 2, Web Dev Task 2, Graphic Design Task 2):
        // If the task is NOT attempted:
        // - the attempt-toggle column itself exports its value (e.g. "No")
        // - all other fields and checkboxes in this task are blanked!
        const attempted = isTaskAttempted(col.task, answers);
        if (!attempted && !col.isAttemptToggle) {
          row.push(escapeCsvCell(''));
          continue;
        }
      }

      // 4. Conditional field gating (isFieldActive):
      // Covers Falsification's experiment toggle (falsificationRepo/commits),
      // App Dev's advanced missions / auth / privacy (stageReached:2+, stageReached:3),
      // Electronics hardware toggles, Agentic memory, Canva links, etc.
      if (col.field && !isFieldActive(col.field, answers)) {
        row.push(escapeCsvCell(''));
        continue;
      }

      // 5. App Dev buildUrl vs noBuild mutual exclusion:
      if (col.deptId === 'app-dev') {
        if (col.fieldKey === 'buildUrl' && answers.noBuild) {
          row.push(escapeCsvCell(''));
          continue;
        }
        if (col.fieldKey === 'noBuild' && typeof answers.buildUrl === 'string' && answers.buildUrl.trim()) {
          row.push(escapeCsvCell('No'));
          continue;
        }
      }

      const value = answers[col.fieldKey] ?? '';

      // Format booleans as Yes/No for readability (checkboxes, toggles)
      if (typeof value === 'boolean') {
        row.push(escapeCsvCell(value ? 'Yes' : 'No'));
      } else if (Array.isArray(value)) {
        row.push(escapeCsvCell(value.join('; ')));
      } else {
        row.push(escapeCsvCell(value));
      }
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
