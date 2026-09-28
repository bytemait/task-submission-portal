export type Field = { key: string; label: string; hint?: string; type: 'url' | 'text' | 'textarea'; required?: boolean; repo?: boolean };
export type Track = { id: string; name: string; category: string; color: string; fields: Field[] };
const repo: Field = { key: 'repo', label: 'Public GitHub repository', type: 'url', repo: true, required: true, hint: 'Your repository must be public so our team can review it.' };
const demo: Field = { key: 'demo', label: 'Live demo or project video', type: 'url', hint: 'Optional, but always great to see your work in action.' };
const note: Field = { key: 'notes', label: 'Tell us about your approach', type: 'textarea', hint: 'What did you build? What was the hardest part?' };
const asset: Field = { key: 'work', label: 'Link to your work', type: 'url', required: true, hint: 'A publicly accessible Drive, Figma, Behance or portfolio link.' };
export const tracks: Track[] = [
  { id: 'app-dev', name: 'App Development', category: 'BUILD', color: '#bbf06c', fields: [repo, demo, note] },
  { id: 'web-dev', name: 'Web Development', category: 'BUILD', color: '#bbf06c', fields: [repo, demo, note] },
  { id: 'ml-research', name: 'ML Research', category: 'INTELLIGENCE', color: '#d3c8ff', fields: [repo, { key: 'paper', label: 'Research write-up or report', type: 'url' }, note] },
  { id: 'applied-ml', name: 'Applied ML', category: 'INTELLIGENCE', color: '#d3c8ff', fields: [repo, demo, note] },
  { id: 'cad', name: 'CAD', category: 'HARDWARE', color: '#ffcb9c', fields: [asset, { key: 'source', label: 'Source files / CAD model', type: 'url' }, note] },
  { id: 'electronics', name: 'Electronics', category: 'HARDWARE', color: '#ffcb9c', fields: [repo, demo, note] },
  { id: 'ros', name: 'ROS', category: 'HARDWARE', color: '#ffcb9c', fields: [repo, demo, note] },
  { id: 'cybersecurity', name: 'Cybersecurity', category: 'SECURITY', color: '#ffb3ad', fields: [{ key: 'writeup', label: 'Public write-up or report', type: 'url', required: true }, { ...repo, required: false }, note] },
  { id: 'graphic-design', name: 'Graphic Design', category: 'CREATIVE', color: '#ffd9ec', fields: [asset, note] },
  { id: 'video-editing', name: 'Video Editing', category: 'CREATIVE', color: '#ffd9ec', fields: [asset, note] },
  { id: 'outreach', name: 'Outreach', category: 'COMMUNITY', color: '#b3e8ef', fields: [asset, note] }
];
export type Student = { name: string; enrollment: string; email: string; phone: string; year: string };
export type Submission = { student: Student; selected: string[]; answers: Record<string, Record<string, string>>; status: 'draft' | 'submitted'; updatedAt?: string; submittedAt?: string };
export const emptySubmission = (): Submission => ({ student: { name: '', enrollment: '', email: '', phone: '', year: '' }, selected: [], answers: {}, status: 'draft' });
