import { tracks, type Submission } from '../shared/tracks.ts';
import {
  normalizeEnrollment, validateProfile, isProfileComplete,
  normalizePhone, normalizeEmail, normalizeName, normalizeSocieties,
  normalizeInstagram, normalizeTwitter, normalizeDiscord,
  type ProfileData,
} from '../shared/validation.ts';

export { normalizeEnrollment } from '../shared/validation.ts';

export function repoCoordinates(value: unknown): { owner: string; repo: string } | null {
  if (typeof value !== 'string' || value.length > 250) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) return null;
    const pieces = url.pathname.split('/').filter(Boolean);
    if (pieces.length !== 2 || !/^[\w-]{1,39}$/.test(pieces[0]) || !/^[\w.-]{1,100}$/.test(pieces[1]) || pieces[1] === '.' || pieces[1] === '..') return null;
    return { owner: pieces[0], repo: pieces[1] };
  } catch { return null; }
}

export async function checkRepository(value: unknown): Promise<{ ok: boolean; error?: string }> {
  const coords = repoCoordinates(value);
  if (!coords) return { ok: false, error: 'Enter a GitHub repository link like https://github.com/owner/repo.' };
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'byte-task-portal' }, signal: AbortSignal.timeout(6000) });
    if (response.status === 404 || response.status === 403 && response.headers.get('x-ratelimit-remaining') !== '0') return { ok: false, error: 'This repository is private or cannot be found. Make it public and check the link.' };
    if (!response.ok) return { ok: false, error: 'GitHub could not verify this repository right now. Try again shortly.' };
    const data = await response.json() as { private?: boolean; visibility?: string };
    return data.private === false && data.visibility !== 'private' ? { ok: true } : { ok: false, error: 'This repository is private. Make it public before submitting.' };
  } catch { return { ok: false, error: 'GitHub could not verify this repository right now. Try again shortly.' }; }
}

/**
 * Normalize and sanitize the student profile data server-side.
 * Always call this before storing.
 */
export function normalizeStudentProfile(student: Submission['student']): Submission['student'] {
  const legacySocials = student.socials || {};
  const normalized = {
    ...student,
    name: normalizeName(student.name),
    email: normalizeEmail(student.email),
    phone: normalizePhone(student.phone) || student.phone,
    enrollment: normalizeEnrollment(student.enrollment),
    academicBranch: student.academicBranch || student.dept || '',
    inOtherSocieties: student.inOtherSocieties ?? Boolean(student.otherSocieties?.trim()),
    societies: normalizeSocieties(!!student.inOtherSocieties, student.societies || (student.otherSocieties ? [student.otherSocieties] : [])),
    instagram: normalizeInstagram(student.instagram || legacySocials.instagram || ''),
    twitter: normalizeTwitter(student.twitter || legacySocials.twitter || ''),
    discord: normalizeDiscord(student.discord || legacySocials.discord || ''),
  };
  return {
    ...normalized,
    dept: normalized.dept || normalized.academicBranch,
    otherSocieties: normalized.otherSocieties || normalized.societies.join(', '),
    socials: { instagram: normalized.instagram, twitter: normalized.twitter, discord: normalized.discord },
  };
}

/**
 * Build ProfileData from a Student for validation.
 */
export function studentToProfileData(student: Submission['student']): ProfileData {
  return {
    name: student.name,
    email: student.email,
    phone: student.phone,
    enrollment: student.enrollment,
    academicBranch: student.academicBranch || '',
    year: student.year,
    semester: student.semester || '',
    inOtherSocieties: !!student.inOtherSocieties,
    societies: student.societies || [],
    instagram: student.instagram || '',
    twitter: student.twitter || '',
    discord: student.discord || '',
  };
}

/**
 * Check whether a submission's student profile is complete.
 */
export function isSubmissionProfileComplete(submission: Submission): boolean {
  return isProfileComplete(studentToProfileData(submission.student));
}

export function validateSubmission(data: Submission, final: boolean): string[] {
  const errors: string[] = [];
  if (!data || typeof data !== 'object' || !data.student || typeof data.student !== 'object' || !Array.isArray(data.selected) || !data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) return ['Invalid submission.'];
  const { name, enrollment, email, phone, dept, year, otherSocieties, socials } = data.student;
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100 || typeof enrollment !== 'string' || !/^[A-Z0-9/\-]{4,30}$/.test(enrollment)) errors.push('Enter a valid name and enrollment number.');
  if (typeof email !== 'string' || email.length > 254 || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
  if (typeof phone !== 'string' || phone.length > 20 || phone && !/^[\d+()\s-]{7,20}$/.test(phone)) errors.push('Enter a valid phone number.');
  if (dept !== undefined && (typeof dept !== 'string' || dept.length > 100)) errors.push('Invalid department.');
  if (typeof year !== 'string' || year.length > 60) errors.push('Invalid year / semester.');
  if (otherSocieties !== undefined && (typeof otherSocieties !== 'string' || otherSocieties.length > 500)) errors.push('Other societies field too long.');
  if (socials !== undefined && typeof socials === 'object' && socials !== null) {
    if (socials.instagram !== undefined && (typeof socials.instagram !== 'string' || socials.instagram.length > 100)) errors.push('Invalid Instagram handle.');
    if (socials.twitter !== undefined && (typeof socials.twitter !== 'string' || socials.twitter.length > 100)) errors.push('Invalid Twitter/X handle.');
    if (socials.discord !== undefined && (typeof socials.discord !== 'string' || socials.discord.length > 100)) errors.push('Invalid Discord handle.');
  }
  const validTrackIds = new Set([...tracks.map(t => t.id), ...deptConfigs.map(d => d.id)]);
  if (data.selected.length > validTrackIds.size || new Set(data.selected).size !== data.selected.length || data.selected.some(id => !validTrackIds.has(id))) errors.push('Invalid track selection.');
  if (final) {
    if (!email || !phone || !year || (!dept && !data.student.academicBranch)) errors.push('Complete all your personal details.');
    if (!data.selected.length) errors.push('Choose at least one track.');
    // Gate on profile completion for final submission
    const profileErrors = validateProfile(studentToProfileData(data.student));
    if (Object.keys(profileErrors).length > 0) {
      errors.push('Complete your applicant profile before submitting. Missing: ' + Object.values(profileErrors).join('; '));
    }
  }
  for (const track of tracks.filter(t => data.selected.includes(t.id))) {
    const answers = data.answers[track.id] || {};
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) { errors.push(`Invalid ${track.name} answers.`); continue; }
    for (const field of track.fields) {
      const value = answers[field.key];
      if (value !== undefined && (typeof value !== 'string' || value.length > 2000)) { errors.push(`Invalid ${field.label}.`); continue; }
      if (final && !getDeptConfig(track.id) && field.required && !value?.trim()) errors.push(`${track.name}: ${field.label} is required.`);
      if (value && field.repo && !repoCoordinates(value)) errors.push(`${track.name}: Enter a valid GitHub repository link.`);
      else if (value && field.type === 'url' && !field.repo) {
        try { const url = new URL(value); if (url.protocol !== 'https:' && url.protocol !== 'http:') errors.push(`${track.name}: ${field.label} must be an HTTP(S) link.`); } catch { errors.push(`${track.name}: ${field.label} must be a valid link.`); }
      }
    }
  }

  // Department-specific validation
  if (final) {
    errors.push(...validateDeptSubmission(data));
  }

  return errors;
}

// ── Department-specific validation ──────────────────────────────────────────
import {
  deptConfigs, getDeptConfig, isFieldActive, isTaskAttempted,
  validateFieldUrl, validateMangaJsonl, countWords, validateWordLimit,
  type DeptConfig, type TaskConfig, type DeptField,
} from '../shared/submissionConfig.ts';

export function validateDeptSubmission(data: Submission): string[] {
  const errors: string[] = [];
  const deptAnswers = data.deptAnswers || {};
  const deptSelected = data.deptSelected || {};
  const year = parseInt(data.student.year, 10) || 0;

  for (const deptId of data.selected) {
    const config = getDeptConfig(deptId);
    if (!config || config.comingSoon) continue;

    const answers = deptAnswers[deptId] || {};
    // For taskPicker depts (ML), use explicit selections from deptSelected.
    // For non-taskPicker depts (GD, CAD, Electronics), derive from attempted tasks.
    const selectedTasks = config.taskPicker
      ? (deptSelected[deptId] || [])
      : config.tasks.filter(t => isTaskAttempted(t, answers)).map(t => t.id);

    // Validate global fields
    for (const field of config.globalFields) {
      if (!isFieldActive(field, answers)) continue;
      const val = answers[field.key];
      // Required check (handles multi-select as array)
      if (field.required) {
        if (field.type === 'multi-select') {
          if (!Array.isArray(val) || val.length < (field.minSelect || 1))
            errors.push(`${config.name}: ${field.label} — select at least ${field.minSelect || 1}.`);
        } else if (field.type === 'url-list') {
          if (!Array.isArray(val) || val.filter((v: string) => v?.trim()).length < 1)
            errors.push(`${config.name}: ${field.label} — at least one entry is required.`);
        } else if (!val || (typeof val === 'string' && !val.trim())) {
          errors.push(`${config.name}: ${field.label} is required.`);
        }
      }
      if (val && field.type === 'url' && field.urlType) {
        const urlErr = validateFieldUrl(String(val), field.urlType);
        if (urlErr) errors.push(`${config.name}: ${urlErr}`);
      }
      if (val && field.type === 'textarea' && field.maxLength && String(val).length > field.maxLength) {
        errors.push(`${config.name}: ${field.label} must be under ${field.maxLength} characters.`);
      }
      // Word limit
      if (val && field.wordLimit && typeof val === 'string') {
        const wErr = validateWordLimit(val, field.wordLimit);
        if (wErr) errors.push(`${config.name}: ${field.label} — ${wErr}`);
      }
    }

    // Validate global checkboxes
    for (const cb of config.globalCheckboxes) {
      if (cb.required && !answers[cb.key]) {
        errors.push(`${config.name}: "${cb.label}" must be checked.`);
      }
    }

    // Task picker validation
    if (config.taskPicker && config.taskPickCount) {
      if (selectedTasks.length !== config.taskPickCount) {
        errors.push(`${config.name}: Select exactly ${config.taskPickCount} tasks.`);
      }
    }

    // Year rule validation
    if (config.yearRule && year > 0) {
      const yearErr = config.yearRule(year, selectedTasks);
      if (yearErr) errors.push(`${config.name}: ${yearErr}`);
    }

    // Task-level validation
    for (const task of config.tasks) {
      // Only validate selected tasks for task-picker depts
      if (config.taskPicker && !selectedTasks.includes(task.id)) continue;

      const attempted = isTaskAttempted(task, answers);
      if (!attempted) continue;

      // Validate task fields
      for (const field of task.fields) {
        if (!isFieldActive(field, answers)) continue;
        if (field.type === 'toggle') continue; // toggles are not validated as values

        const val = answers[field.key];

        if (field.required) {
          if (field.type === 'multi-select') {
            if (!Array.isArray(val) || val.length < (field.minSelect || 1))
              errors.push(`${config.name} / ${task.name}: ${field.label} — select at least ${field.minSelect || 1}.`);
          } else if (field.type === 'url-list') {
            if (!Array.isArray(val) || val.filter((v: string) => v?.trim()).length < 1)
              errors.push(`${config.name} / ${task.name}: ${field.label} — at least one entry is required.`);
          } else if (!val || (typeof val === 'string' && !val.trim())) {
            errors.push(`${config.name} / ${task.name}: ${field.label} is required.`);
          }
        }
        if (val && field.type === 'url' && field.urlType) {
          const urlErr = validateFieldUrl(String(val), field.urlType);
          if (urlErr) errors.push(`${config.name} / ${task.name}: ${urlErr}`);
        }
        // JSONL validation
        if (val && field.type === 'file' && field.accept === '.jsonl') {
          const jsonlErr = validateMangaJsonl(String(val));
          if (jsonlErr) errors.push(`${config.name} / ${task.name}: ${jsonlErr}`);
        }
        // Word limit
        if (val && field.wordLimit && typeof val === 'string') {
          const wErr = validateWordLimit(val, field.wordLimit);
          if (wErr) errors.push(`${config.name} / ${task.name}: ${field.label} — ${wErr}`);
        }
      }

      // Validate task checkboxes
      for (const cb of task.checkboxes) {
        if (cb.required && !answers[cb.key]) {
          errors.push(`${config.name} / ${task.name}: "${cb.label}" must be checked.`);
        }
      }
    }
  }

  return errors;
}

/**
 * Best-effort check if a Drive folder URL is publicly accessible.
 * Returns a warning string if it looks non-public, null otherwise.
 * NON-BLOCKING: never block submission on this alone.
 */
export async function checkDriveAccessibility(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'byte-task-portal' },
      redirect: 'manual',
    });
    // If we get a redirect to accounts.google.com, the link is likely not public
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      if (location.includes('accounts.google.com') || location.includes('ServiceLogin')) {
        return 'This link may require sign-in. Double-check sharing permissions.';
      }
    }
    if (response.status === 404) return 'This folder was not found. Check the link.';
    return null;
  } catch {
    return null; // network error — don't block
  }
}
