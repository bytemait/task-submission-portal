/**
 * Shared validation utilities for the applicant profile.
 * Used identically by client (inline validation) and server (PUT /profile, submit gate).
 */

// ── Name ────────────────────────────────────────────────────────────────────
const NAME_RE = /^[\p{L}\s.'\-]{2,100}$/u;
export function validateName(raw: string): string | null {
  const v = raw.trim().replace(/\s+/g, ' ');
  if (!v) return 'Full name is required.';
  if (v.length < 2 || v.length > 100) return 'Name must be 2–100 characters.';
  if (!NAME_RE.test(v)) return 'Name may only contain letters, spaces, periods, apostrophes, and hyphens.';
  return null;
}
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// ── Email ───────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validateEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return 'Email is required.';
  if (v.length > 254) return 'Email must be at most 254 characters.';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.';
  return null;
}
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ── Phone ───────────────────────────────────────────────────────────────────
/**
 * Accept 10-digit Indian mobile (starting 6-9), optional +91/91/0 prefix,
 * spaces and dashes allowed. Normalize to E.164 (+91XXXXXXXXXX).
 */
export function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-()]/g, '');
  // Try to extract the 10-digit core
  let digits = stripped;
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(digits)) return '+91' + digits;
  return null;
}
export function validatePhone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Phone number is required.';
  if (!normalizePhone(v)) return 'Enter a valid 10-digit Indian mobile number (starting 6-9).';
  return null;
}

// ── Enrollment ──────────────────────────────────────────────────────────────
// TODO: Replace with exact college format once confirmed.
export const ENROLLMENT_RE = /^[A-Z0-9\-/]{6,20}$/;
export function normalizeEnrollment(raw: string): string {
  return raw.trim().toUpperCase();
}
export function validateEnrollment(raw: string): string | null {
  const v = normalizeEnrollment(raw);
  if (!v) return 'Enrollment number is required.';
  if (!ENROLLMENT_RE.test(v)) return 'Enrollment number must be 6–20 alphanumeric characters.';
  return null;
}

// ── Academic Branch ─────────────────────────────────────────────────────────
export const ACADEMIC_BRANCHES = [
  'CSE', 'IT', 'ECE', 'EEE', 'ME', 'CE', 'AI & ML', 'AI & DS',
  'ICE', 'MAE', 'BT', 'Other',
] as const;
export type AcademicBranch = (typeof ACADEMIC_BRANCHES)[number];
export function validateAcademicBranch(raw: string): string | null {
  if (!raw) return 'Academic branch is required.';
  if (!(ACADEMIC_BRANCHES as readonly string[]).includes(raw)) return 'Select a valid academic branch.';
  return null;
}

// ── Year & Semester ─────────────────────────────────────────────────────────
export const VALID_YEARS = [1, 2, 3, 4] as const;
export function semestersForYear(year: number): [number, number] {
  return [year * 2 - 1, year * 2];
}
export function validateYear(raw: unknown): string | null {
  if (!raw) return 'Year is required.';
  const n = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (isNaN(n) || !VALID_YEARS.includes(n as 1 | 2 | 3 | 4)) return 'Select a valid year (1-4).';
  return null;
}
export function validateSemester(semester: unknown, year: unknown): string | null {
  if (!semester) return 'Semester is required.';
  const s = typeof semester === 'string' ? parseInt(semester, 10) : typeof semester === 'number' ? semester : NaN;
  const y = typeof year === 'string' ? parseInt(year, 10) : typeof year === 'number' ? year : NaN;
  if (isNaN(s) || s < 1 || s > 8) return 'Select a valid semester (1-8).';
  if (!isNaN(y) && VALID_YEARS.includes(y as 1 | 2 | 3 | 4)) {
    const [lo, hi] = semestersForYear(y);
    if (s < lo || s > hi) return `For year ${y}, select semester ${lo} or ${hi}.`;
  }
  return null;
}

// ── Societies ───────────────────────────────────────────────────────────────
export function validateSocieties(inOtherSocieties: boolean, list: string[]): string | null {
  if (!inOtherSocieties) return null;
  const trimmed = (list || []).map(s => s.trim()).filter(Boolean);
  if (!trimmed.length) return 'Add at least one society or select "No".';
  if (trimmed.length > 10) return 'Maximum 10 societies allowed.';
  for (const s of trimmed) {
    if (s.length < 2 || s.length > 60) return `Society name "${s}" must be 2–60 characters.`;
  }
  // case-insensitive dedupe check
  const lower = trimmed.map(s => s.toLowerCase());
  if (new Set(lower).size !== lower.length) return 'Remove duplicate society names.';
  return null;
}
export function normalizeSocieties(inOtherSocieties: boolean, list: string[]): string[] {
  if (!inOtherSocieties) return [];
  return (list || []).map(s => s.trim()).filter(Boolean);
}

// ── Social Handles ──────────────────────────────────────────────────────────
const IG_RE = /^[a-zA-Z0-9._]{1,30}$/;
const TW_RE = /^[a-zA-Z0-9_]{1,15}$/;
const DC_RE = /^[a-z0-9_.]{2,32}$/;
const DC_LEGACY_RE = /^.{2,32}#\d{4}$/;

function extractHandle(raw: string, urlPatterns: RegExp[]): string {
  let v = raw.trim();
  // Try URL extraction first
  for (const pattern of urlPatterns) {
    const m = v.match(pattern);
    if (m && m[1]) { v = m[1]; break; }
  }
  // Strip leading @
  if (v.startsWith('@')) v = v.slice(1);
  // Strip trailing slash
  v = v.replace(/\/+$/, '');
  // Strip query string
  v = v.replace(/\?.*$/, '');
  return v;
}

export function normalizeInstagram(raw: string): string {
  if (!raw.trim()) return '';
  return extractHandle(raw, [
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/i,
  ]);
}
export function validateInstagram(raw: string): string | null {
  if (!raw.trim()) return null; // optional
  const handle = normalizeInstagram(raw);
  if (!handle || !IG_RE.test(handle)) return 'Instagram handle: 1–30 characters, letters/numbers/./_ only.';
  return null;
}

export function normalizeTwitter(raw: string): string {
  if (!raw.trim()) return '';
  return extractHandle(raw, [
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i,
  ]);
}
export function validateTwitter(raw: string): string | null {
  if (!raw.trim()) return null; // optional
  const handle = normalizeTwitter(raw);
  if (!handle || !TW_RE.test(handle)) return 'Twitter/X handle: 1–15 characters, letters/numbers/_ only.';
  return null;
}

export function normalizeDiscord(raw: string): string {
  if (!raw.trim()) return '';
  // Legacy format: keep as-is
  if (DC_LEGACY_RE.test(raw.trim())) return raw.trim();
  const v = raw.trim().replace(/^@/, '').toLowerCase();
  return v;
}
export function validateDiscord(raw: string): string | null {
  if (!raw.trim()) return null; // optional
  const handle = normalizeDiscord(raw);
  if (!handle) return null;
  // Accept legacy name#1234
  if (DC_LEGACY_RE.test(handle)) return null;
  if (!DC_RE.test(handle)) return 'Discord handle: 2–32 characters, lowercase letters/numbers/_/. only.';
  return null;
}

// ── Full Profile Validation ─────────────────────────────────────────────────
export interface ProfileData {
  name: string;
  email: string;
  phone: string;
  enrollment: string;
  academicBranch: string;
  year: number | string;
  semester: number | string;
  inOtherSocieties: boolean;
  societies: string[];
  instagram: string;
  twitter: string;
  discord: string;
}

export interface ProfileErrors {
  [field: string]: string;
}

export function validateProfile(data: ProfileData): ProfileErrors {
  const errors: ProfileErrors = {};
  const nameErr = validateName(data.name);
  if (nameErr) errors.name = nameErr;
  const emailErr = validateEmail(data.email);
  if (emailErr) errors.email = emailErr;
  const phoneErr = validatePhone(data.phone);
  if (phoneErr) errors.phone = phoneErr;
  const enrollErr = validateEnrollment(data.enrollment);
  if (enrollErr) errors.enrollment = enrollErr;
  const branchErr = validateAcademicBranch(data.academicBranch);
  if (branchErr) errors.academicBranch = branchErr;
  const yearErr = validateYear(data.year);
  if (yearErr) errors.year = yearErr;
  const semErr = validateSemester(data.semester, data.year);
  if (semErr) errors.semester = semErr;
  const socErr = validateSocieties(data.inOtherSocieties, data.societies);
  if (socErr) errors.societies = socErr;
  const igErr = validateInstagram(data.instagram);
  if (igErr) errors.instagram = igErr;
  const twErr = validateTwitter(data.twitter);
  if (twErr) errors.twitter = twErr;
  const dcErr = validateDiscord(data.discord);
  if (dcErr) errors.discord = dcErr;
  return errors;
}

export function isProfileComplete(data: ProfileData): boolean {
  return Object.keys(validateProfile(data)).length === 0;
}
