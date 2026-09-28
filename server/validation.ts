import { tracks, type Submission } from '../shared/tracks.ts';
export const normalizeEnrollment = (value: string) => value.trim().toUpperCase();
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
export function validateSubmission(data: Submission, final: boolean): string[] {
  const errors: string[] = [];
  if (!data || typeof data !== 'object' || !data.student || typeof data.student !== 'object' || !Array.isArray(data.selected) || !data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) return ['Invalid submission.'];
  const { name, enrollment, email, phone, dept, year, otherSocieties, socials } = data.student;
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100 || typeof enrollment !== 'string' || !/^[A-Z0-9/-]{4,30}$/.test(enrollment)) errors.push('Enter a valid name and enrollment number.');
  if (typeof email !== 'string' || email.length > 160 || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
  if (typeof phone !== 'string' || phone.length > 20 || phone && !/^[\d+()\s-]{7,20}$/.test(phone)) errors.push('Enter a valid phone number.');
  if (dept !== undefined && (typeof dept !== 'string' || dept.length > 100)) errors.push('Invalid department.');
  if (typeof year !== 'string' || year.length > 60) errors.push('Invalid year / semester.');
  if (otherSocieties !== undefined && (typeof otherSocieties !== 'string' || otherSocieties.length > 500)) errors.push('Other societies field too long.');
  if (socials !== undefined && typeof socials === 'object' && socials !== null) {
    if (socials.instagram !== undefined && (typeof socials.instagram !== 'string' || socials.instagram.length > 100)) errors.push('Invalid Instagram handle.');
    if (socials.twitter !== undefined && (typeof socials.twitter !== 'string' || socials.twitter.length > 100)) errors.push('Invalid Twitter/X handle.');
    if (socials.discord !== undefined && (typeof socials.discord !== 'string' || socials.discord.length > 100)) errors.push('Invalid Discord handle.');
  }
  if (data.selected.length > tracks.length || new Set(data.selected).size !== data.selected.length || data.selected.some(id => !tracks.some(t => t.id === id))) errors.push('Invalid track selection.');
  if (final) {
    if (!email || !phone || !year || !dept) errors.push('Complete all your personal details.');
    if (!data.selected.length) errors.push('Choose at least one track.');
  }
  for (const track of tracks.filter(t => data.selected.includes(t.id))) {
    const answers = data.answers[track.id] || {};
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) { errors.push(`Invalid ${track.name} answers.`); continue; }
    for (const field of track.fields) {
      const value = answers[field.key];
      if (value !== undefined && (typeof value !== 'string' || value.length > 2000)) { errors.push(`Invalid ${field.label}.`); continue; }
      if (final && field.required && !value?.trim()) errors.push(`${track.name}: ${field.label} is required.`);
      if (value && field.repo && !repoCoordinates(value)) errors.push(`${track.name}: Enter a valid GitHub repository link.`);
      else if (value && field.type === 'url' && !field.repo) {
        try { const url = new URL(value); if (url.protocol !== 'https:' && url.protocol !== 'http:') errors.push(`${track.name}: ${field.label} must be an HTTP(S) link.`); } catch { errors.push(`${track.name}: ${field.label} must be a valid link.`); }
      }
    }
  }
  return errors;
}
