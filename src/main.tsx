import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleHelp, Download, FolderTree as FolderTreeIcon, LockKeyhole, LogOut, Pencil, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { tracks, emptySubmission, type Submission, type Student, type Field } from '../shared/tracks.ts';
import {
  validateName, validateEmail, validatePhone, validateEnrollment,
  validateAcademicBranch, validateYear, validateSemester,
  validateSocieties, validateInstagram, validateTwitter, validateDiscord,
  normalizePhone, normalizeInstagram, normalizeTwitter, normalizeDiscord,
  ACADEMIC_BRANCHES, semestersForYear,
  type ProfileErrors,
} from '../shared/validation.ts';
import {
  deptConfigs, getDeptConfig, isFieldActive, isTaskAttempted,
  validateFieldUrl, validateMangaJsonl, countWords, validateWordLimit,
  type DeptConfig, type TaskConfig, type DeptField,
} from '../shared/submissionConfig.ts';
import './style.css';

// ── Submission window ───────────────────────────────────────────────────────
const WINDOW_OPEN = new Date('2025-09-29T00:01:00+05:30');
const WINDOW_CLOSE_STR = (import.meta as any).env?.VITE_SUBMISSION_CLOSE || '';
const WINDOW_CLOSE = WINDOW_CLOSE_STR ? new Date(WINDOW_CLOSE_STR) : null;

function isWindowOpen(): boolean {
  const now = Date.now();
  if (now < WINDOW_OPEN.getTime()) return false;
  if (WINDOW_CLOSE && now > WINDOW_CLOSE.getTime()) return false;
  return true;
}

// ── API helpers ─────────────────────────────────────────────────────────────
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    (err as any).status = response.status;
    throw err;
  }
  return data as T;
}
const post = <T,>(url: string, body?: unknown) => api<T>(url, { method: 'POST', body: JSON.stringify(body || {}) });
const put = <T,>(url: string, body?: unknown) => api<T>(url, { method: 'PUT', body: JSON.stringify(body || {}) });

// ── SessionStorage draft helper ─────────────────────────────────────────────
const DRAFT_KEY = 'byte_draft_';
function saveDraftLocal(enrollment: string, data: Submission) {
  try { sessionStorage.setItem(DRAFT_KEY + enrollment, JSON.stringify(data)); } catch {}
}
function loadDraftLocal(enrollment: string): Submission | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY + enrollment);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearDraftLocal(enrollment: string) {
  try { sessionStorage.removeItem(DRAFT_KEY + enrollment); } catch {}
}

// ── Wizard steps ────────────────────────────────────────────────────────────
const step2Labels = ['Choose departments', 'Your work', 'Review'];
const allStepLabels = ['Applicant details', ...step2Labels];

// ── Folder tree display ─────────────────────────────────────────────────────
function FolderTree({ tree, name }: { tree: string; name?: string }) {
  return <div className="folder-tree">
    {name && <p className="folder-tree-name"><FolderTreeIcon size={14}/> Required folder structure: <strong>{name}</strong></p>}
    <pre>{tree}</pre>
  </div>;
}

// ── JSONL file upload ───────────────────────────────────────────────────────
function FileUploadField({ field, value, onChange, error }: {
  field: DeptField; value: string; onChange: (v: string) => void; error?: string;
}) {
  const [fileName, setFileName] = useState('');
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      onChange(content);
    };
    reader.readAsText(file);
  };
  const validationError = value ? (field.accept === '.jsonl' ? validateMangaJsonl(value) : null) : null;
  return <div className={'form-field' + (error || validationError ? ' has-error' : '')}>
    <label>{field.label}{field.required && <span className="required"> *</span>}</label>
    <div className="file-upload">
      <label className="file-upload-btn">
        <Upload size={15}/> {fileName || 'Choose file'}
        <input type="file" accept={field.accept} onChange={handleFile} style={{display:'none'}}/>
      </label>
      {fileName && <span className="file-name">{fileName}</span>}
    </div>
    {field.hint && <p className="hint">{field.hint}</p>}
    {validationError && <p className="field-error" role="alert">{validationError}</p>}
    {error && !validationError && <p className="field-error" role="alert">{error}</p>}
    {value && !validationError && <p className="verify verify-ok">File loaded — {value.trim().split('\n').length} lines.</p>}
  </div>;
}

// ── Checkbox field ──────────────────────────────────────────────────────────
function CheckboxField({ id, label, checked, onChange, required, error }: {
  id: string; label: string; checked: boolean; onChange: (v: boolean) => void; required?: boolean; error?: string;
}) {
  return <div className={'checkbox-field' + (error ? ' has-error' : '')}>
    <label className="checkbox-label">
      <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)}/>
      <span className="checkbox-mark"><Check size={13}/></span>
      <span>{label}{required && <span className="required"> *</span>}</span>
    </label>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

// ── Word-count textarea ─────────────────────────────────────────────────────
function WordCountTextarea({ id, label, value, onChange, wordLimit, hint, required, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; wordLimit: number; hint?: string; required?: boolean; error?: string;
}) {
  const wc = countWords(value || '');
  const over = wc > wordLimit;
  return <div className={'form-field' + (over || error ? ' has-error' : '')}>
    <label htmlFor={id}>{label}{required && <span className="required"> *</span>}{!required && <span className="optional"> (optional)</span>}</label>
    <textarea id={id} value={value} onChange={e => onChange(e.target.value)} rows={3}
      placeholder="Write here…" aria-invalid={over || !!error}/>
    <p className={'word-counter' + (over ? ' over' : '')}>{wc} / {wordLimit} words</p>
    {hint && <p className="hint">{hint}</p>}
    {over && <p className="field-error" role="alert">Exceeds word limit ({wc}/{wordLimit}).</p>}
    {error && !over && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

// ── Multi-select checkbox group ─────────────────────────────────────────────
function MultiSelectField({ id, field, value, onChange }: {
  id: string; field: DeptField; value: string[]; onChange: (v: string[]) => void;
}) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  };
  return <div className="form-field">
    <label>{field.label}{field.required && <span className="required"> *</span>}</label>
    <div className="multi-select-grid">
      {field.options?.map(opt => <label key={opt.value} className={'multi-select-option' + (selected.includes(opt.value) ? ' selected' : '')}>
        <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)}/>
        <span className="checkbox-mark"><Check size={13}/></span>
        <span>{opt.label}</span>
      </label>)}
    </div>
    {field.hint && <p className="hint">{field.hint}</p>}
    {field.required && field.minSelect && selected.length < field.minSelect && selected.length > 0 && <p className="field-error" role="alert">Select at least {field.minSelect}.</p>}
  </div>;
}

// ── Repeatable URL list ─────────────────────────────────────────────────────
function UrlListField({ id, field, value, onChange }: {
  id: string; field: DeptField; value: string[]; onChange: (v: string[]) => void;
}) {
  const items = Array.isArray(value) ? value : [''];
  const addRow = () => onChange([...items, '']);
  const removeRow = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateRow = (i: number, v: string) => { const next = [...items]; next[i] = v; onChange(next); };
  return <div className="form-field">
    <label>{field.label}{field.required && <span className="required"> *</span>}</label>
    {items.map((item, i) => <div key={i} className="url-list-row">
      <input type="url" value={item} onChange={e => updateRow(i, e.target.value)} placeholder="https://..." aria-label={`${field.label} ${i + 1}`}/>
      {items.length > 1 && <button type="button" className="society-remove" onClick={() => removeRow(i)} aria-label="Remove"><Trash2 size={15}/></button>}
    </div>)}
    {items.length < 10 && <button type="button" className="society-add" onClick={addRow}><Plus size={15}/> Add link</button>}
    {field.hint && <p className="hint">{field.hint}</p>}
  </div>;
}

// ── Collapsible helper text ─────────────────────────────────────────────────
function CollapsibleHelper({ title, content }: { title: string; content: string }) {
  const [open, setOpen] = useState(false);
  return <div className={'collapsible-helper' + (open ? ' open' : '')}>
    <button type="button" className="collapsible-toggle" onClick={() => setOpen(!open)}>
      <span>{title}</span>
      <ChevronDown size={16} className={'collapsible-icon' + (open ? ' rotated' : '')}/>
    </button>
    {open && <pre className="collapsible-content">{content}</pre>}
  </div>;
}

// ── Filename hint ───────────────────────────────────────────────────────────
function buildFilenameHint(studentName: string, branch: string, suffix: string): string {
  const firstName = studentName.split(' ')[0] || 'Name';
  const branchShort = branch || 'Branch';
  return `${firstName}_${branchShort}_${suffix}`;
}
function TaskPicker({ config, selected, onChange, year, error }: {
  config: DeptConfig; selected: string[]; onChange: (ids: string[]) => void; year: number; error?: string;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else if (!config.taskPickCount || selected.length < config.taskPickCount) onChange([...selected, id]);
    else onChange([...selected.slice(1), id]); // replace oldest
  };
  const yearErr = config.yearRule?.(year, selected);
  return <div className="task-picker">
    <p className="task-picker-hint">Select exactly <strong>{config.taskPickCount}</strong> tasks. {year >= 2 && 'Year-based rules apply.'}</p>
    <div className="task-picker-grid">
      {config.tasks.map(task => <label key={task.id} className={'task-card ' + (selected.includes(task.id) ? 'selected' : '')}>
        <input type="checkbox" checked={selected.includes(task.id)} onChange={() => toggle(task.id)}/>
        <span className={'task-tag tag-' + task.tag.toLowerCase()}>{task.tag}</span>
        <span className="task-card-name">{task.name}</span>
        <span className="task-card-check"><Check size={15}/></span>
      </label>)}
    </div>
    {yearErr && <p className="field-error" role="alert">{yearErr}</p>}
    {error && !yearErr && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

// ── Department form (renders from config) ───────────────────────────────────
function DeptForm({ config, answers, selectedTasks, onAnswer, onSelectTasks, year, studentName, studentBranch }: {
  config: DeptConfig;
  answers: Record<string, any>;
  selectedTasks: string[];
  onAnswer: (key: string, value: any) => void;
  onSelectTasks: (ids: string[]) => void;
  year: number;
  studentName: string;
  studentBranch: string;
}) {
  if (config.comingSoon) {
    return <div className="coming-soon">
      <p className="coming-soon-text">Submission details coming soon.</p>
      <p className="hint">The submission format for {config.name} will be shared shortly. Check back later.</p>
    </div>;
  }

  const renderField = (field: DeptField, prefix: string) => {
    if (!isFieldActive(field, answers)) return null;
    const id = `${prefix}-${field.key}`;
    const val = answers[field.key];

    if (field.type === 'toggle') {
      return <div key={id} className="form-field full">
        <label>{field.label}</label>
        <div className="toggle-group">
          <button type="button" className={'toggle-btn' + (val ? ' active' : '')} onClick={() => onAnswer(field.key, true)}>Yes</button>
          <button type="button" className={'toggle-btn' + (!val ? ' active' : '')} onClick={() => onAnswer(field.key, false)}>No</button>
        </div>
      </div>;
    }

    if (field.type === 'checkbox') {
      return <CheckboxField key={id} id={id} label={field.checkboxLabel || field.label} checked={!!val} onChange={v => onAnswer(field.key, v)} required={field.required}/>;
    }

    if (field.type === 'select') {
      return <div key={id} className="form-field">
        <label htmlFor={id}>{field.label}{field.required && <span className="required"> *</span>}{!field.required && <span className="optional"> (optional)</span>}</label>
        <select id={id} value={val || ''} onChange={e => onAnswer(field.key, e.target.value)}>
          {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {field.hint && <p className="hint">{field.hint}</p>}
      </div>;
    }

    if (field.type === 'file') {
      return <FileUploadField key={id} field={field} value={val || ''} onChange={v => onAnswer(field.key, v)}/>;
    }

    if (field.type === 'multi-select') {
      return <MultiSelectField key={id} id={id} field={field} value={val || []} onChange={v => onAnswer(field.key, v)}/>;
    }

    if (field.type === 'url-list') {
      return <UrlListField key={id} id={id} field={field} value={val || ['']} onChange={v => onAnswer(field.key, v)}/>;
    }

    // Textarea with word limit
    if (field.type === 'textarea' && field.wordLimit) {
      return <WordCountTextarea key={id} id={id} label={field.label} value={val || ''} onChange={v => onAnswer(field.key, v)}
        wordLimit={field.wordLimit} hint={field.hint} required={field.required}/>;
    }

    // URL field with inline validation
    const urlError = val && field.urlType ? validateFieldUrl(String(val), field.urlType) : null;
    return <FieldInput key={id} id={id}
      label={field.label}
      type={field.type === 'url' ? 'url' : field.type === 'textarea' ? 'textarea' : 'text'}
      value={val || ''}
      onChange={v => onAnswer(field.key, v)}
      required={field.required}
      hint={field.hint}
      error={urlError || undefined}
    />;
  };

  const folderName = config.folderNameHint?.replace('<YourName>', studentName.split(' ')[0] || 'YourName');

  // Dynamic filename labels for checkboxes with empty labels
  const filenameMap: Record<string, string> = {
    // Video Editing
    'fileName': config.id === 'video-editing'
      ? `File is named ${buildFilenameHint(studentName, studentBranch, 'VideoEdit')}.mp4`
      : config.id === 'outreach'
      ? `File is named ${studentName.replace(/\s+/g, '')}_${studentBranch || 'Branch'}_Outreach`
      : '',
    // Graphic Design
    'posterFile': `File is named ${buildFilenameHint(studentName, studentBranch, 'Poster')}.png`,
    'merchFile': `File is named ${buildFilenameHint(studentName, studentBranch, 'Merch')}.png`,
  };

  const getCheckboxLabel = (cb: { key: string; label: string }) =>
    cb.label || filenameMap[cb.key] || cb.key;

  return <>
    {/* Helper hint */}
    {config.helperHint && <p className="dept-helper-hint">{config.helperHint}</p>}

    {/* Collapsible helper text */}
    {config.helperText && <CollapsibleHelper title={config.helperText.title} content={config.helperText.content}/>}

    {/* Folder structure hint */}
    {config.folderTree && <FolderTree tree={config.folderTree.replace(/<YourName>/g, studentName.split(' ')[0] || 'YourName')} name={folderName}/>}

    {/* Global fields */}
    <div className="form-grid dept-global-fields">
      {config.globalFields.map(f => renderField(f, config.id))}
    </div>

    {/* Global checkboxes */}
    {config.globalCheckboxes.length > 0 && <div className="dept-checkboxes">
      {config.globalCheckboxes.map(cb => <CheckboxField key={cb.key} id={`${config.id}-${cb.key}`}
        label={getCheckboxLabel(cb)} checked={!!answers[cb.key]} onChange={v => onAnswer(cb.key, v)} required={cb.required}
      />)}
    </div>}

    {/* Task picker (for ML) */}
    {config.taskPicker && <TaskPicker config={config} selected={selectedTasks} onChange={onSelectTasks} year={year}/>}

    {/* Task sections */}
    {config.tasks.map(task => {
      // For task-picker depts, only show selected tasks' fields
      if (config.taskPicker && !selectedTasks.includes(task.id)) return null;

      const attempted = isTaskAttempted(task, answers);
      const showContent = config.taskPicker || attempted;

      return <div key={task.id} className={'dept-task ' + (task.tag === 'Bonus' || task.tag === 'Optional' ? 'dept-task-bonus' : '')}>
        <div className="dept-task-heading">
          <span className={'task-tag tag-' + task.tag.toLowerCase()}>{task.tag}</span>
          <h3>{task.name}</h3>
        </div>

        {/* Toggle fields (like "Task 2 attempted?") always shown */}
        {task.fields.filter(f => f.type === 'toggle').map(f => renderField(f, `${config.id}-${task.id}`))}

        {showContent && <>
          {/* Task helper text */}
          {task.helperText && <CollapsibleHelper title={task.helperText.title} content={task.helperText.content}/>}

          {/* Non-toggle fields */}
          <div className="form-grid">
            {task.fields.filter(f => f.type !== 'toggle').map(f => renderField(f, `${config.id}-${task.id}`))}
          </div>

          {/* Task checkboxes */}
          {task.checkboxes.length > 0 && <div className="dept-checkboxes">
            {task.checkboxes.map(cb => <CheckboxField key={cb.key} id={`${config.id}-${task.id}-${cb.key}`}
              label={getCheckboxLabel(cb)} checked={!!answers[cb.key]} onChange={v => onAnswer(cb.key, v)} required={cb.required}
            />)}
          </div>}
        </>}

        {!showContent && task.tag !== 'Required' && <p className="hint" style={{marginTop:8}}>Toggle "Yes" above to fill in this task. {task.tag === 'Bonus' ? 'This is a bonus task.' : ''}</p>}
      </div>;
    })}
  </>;
}

// ── Shared components ───────────────────────────────────────────────────────
function Brand() { return <a className="brand" href="/" aria-label="BYTE home"><span className="brand-mark">B<span>.</span></span><span className="brand-type">BYTE<span className="brand-sub">MAIT TECH SOCIETY</span></span></a>; }
function Shell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) { return <div className="app"><header className="topbar"><Brand/><div className="topbar-right"><span className="top-label">RECRUITMENT / 2026</span><a className="top-link" href={admin ? '/' : '/login'}>{admin ? 'Submit a task' : 'Admin access'} <ArrowUpRight size={15}/></a></div></header>{children}<footer className="footer"><span>© 2026 BYTE MAIT</span><span>Made for the next generation of builders.</span><a href="https://bytesoc.dev/tasks/" target="_blank" rel="noreferrer">Explore tasks <ArrowUpRight size={13}/></a></footer></div>; }
function FieldInput({ id, label, value, onChange, type = 'text', hint, required, onBlur, disabled, error, autoComplete, inputMode, ariaDescribedBy }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; required?: boolean; onBlur?: () => void; disabled?: boolean; error?: string; autoComplete?: string; inputMode?: string; ariaDescribedBy?: string;
}) {
  const errorId = id + '-error';
  const hintId = id + '-hint';
  const describedBy = [error ? errorId : '', hint ? hintId : '', ariaDescribedBy || ''].filter(Boolean).join(' ') || undefined;
  return <div className={'form-field' + (error ? ' has-error' : '')}>
    <label htmlFor={id}>{label}{required && <span className="required"> *</span>}{!required && <span className="optional"> (optional)</span>}</label>
    {type === 'textarea' ? <textarea id={id} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder="A little context goes a long way..." rows={3} aria-describedby={describedBy} aria-invalid={!!error}/> :
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} disabled={disabled}
      autoComplete={autoComplete} inputMode={inputMode as any}
      aria-describedby={describedBy} aria-invalid={!!error}
      placeholder={type === 'url' ? 'https://...' : label === 'Full name' ? 'Your name, as on college records' : label === 'Enrollment number' ? 'e.g. 1234567890' : ''}/>}
    {hint && <p className="hint" id={hintId}>{hint}</p>}
    {error && <p className="field-error" id={errorId} role="alert">{error}</p>}
  </div>;
}
function RepoField({ field, id, value, onChange }: { field: Field; id: string; value: string; onChange: (v: string) => void }) {
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCheck(null); if (!value) return; const controller = new AbortController(); const timer = setTimeout(async () => { setBusy(true); try { const response = await fetch('/api/repositories/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: value }), signal: controller.signal }); const result = await response.json(); setCheck(result); } catch { if (!controller.signal.aborted) setCheck({ ok: false, error: 'Could not verify right now. Please retry.' }); } finally { if (!controller.signal.aborted) setBusy(false); } }, 600); return () => { clearTimeout(timer); controller.abort(); }; }, [value]);
  return <div><FieldInput id={id} label={field.label} type="url" value={value} onChange={onChange} hint={field.hint} required={field.required}/>{value && <p className={'verify ' + (check?.ok ? 'verify-ok' : check ? 'verify-error' : '')} role="status">{busy || !check ? 'Checking repository visibility…' : check.ok ? 'Public repository verified.' : check.error}</p>}</div>;
}

// ── Society repeater ────────────────────────────────────────────────────────
function SocietyList({ items, onChange, error }: { items: string[]; onChange: (v: string[]) => void; error?: string }) {
  const addRow = () => { if (items.length < 10) onChange([...items, '']); };
  const removeRow = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const updateRow = (i: number, v: string) => { const next = [...items]; next[i] = v; onChange(next); };
  return <div className="society-list">
    {items.map((item, i) => (
      <div key={i} className="society-row">
        <input
          value={item} onChange={e => updateRow(i, e.target.value)}
          placeholder={`Society ${i + 1}`} maxLength={60}
          aria-label={`Society name ${i + 1}`}
        />
        <button type="button" className="society-remove" onClick={() => removeRow(i)} aria-label="Remove"><Trash2 size={15}/></button>
      </div>
    ))}
    {items.length < 10 && <button type="button" className="society-add" onClick={addRow}><Plus size={15}/> Add society</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

// ── Step 1: Applicant Details ───────────────────────────────────────────────
function ApplicantDetails({ data, onChange, onBatchChange, errors, onBlur, disabled }: {
  data: Student; onChange: (key: keyof Student, value: any) => void;
  onBatchChange: (updates: Partial<Student>) => void;
  errors: ProfileErrors; onBlur: (key: string) => void; disabled?: boolean;
}) {
  const yearNum = data.year ? parseInt(data.year, 10) : 0;
  const validSemesters = yearNum >= 1 && yearNum <= 4 ? semestersForYear(yearNum) : null;

  const handleYearChange = (v: string) => {
    // Atomic update: set year and conditionally clear invalid semester in one call
    const updates: Partial<Student> = { year: v };
    if (v && data.semester) {
      const y = parseInt(v, 10);
      const s = parseInt(data.semester, 10);
      if (y >= 1 && y <= 4) {
        const [lo, hi] = semestersForYear(y);
        if (s < lo || s > hi) updates.semester = '';
      }
    }
    onBatchChange(updates);
  };

  return <>
    <div className="section-icon">01 — YOUR DETAILS</div>
    <h1>Let's start with <em>you.</em></h1>
    <p className="lead">Your applicant profile. This is shared across all department submissions and only needs to be filled once.</p>

    <div className="form-grid">
      <FieldInput id="name" label="Full name" required value={data.name} disabled={disabled}
        onChange={v => onChange('name', v)} onBlur={() => onBlur('name')}
        error={errors.name} autoComplete="name"/>

      <FieldInput id="enrollment" label="Enrollment number" required value={data.enrollment} disabled={disabled}
        onChange={v => onChange('enrollment', v)} onBlur={() => onBlur('enrollment')}
        error={errors.enrollment} hint="Your college enrollment/class roll no"/>

      <FieldInput id="email" label="Email address" type="email" required value={data.email}
        onChange={v => onChange('email', v)} onBlur={() => onBlur('email')}
        error={errors.email} autoComplete="email"/>

      <FieldInput id="phone" label="Phone number" type="tel" required value={data.phone}
        onChange={v => onChange('phone', v)} onBlur={() => onBlur('phone')}
        error={errors.phone} autoComplete="tel" inputMode="tel"
        hint="10-digit Indian mobile. +91 prefix optional."/>

      <div className="form-field">
        <label htmlFor="academicBranch">Department (college branch) <span className="required">*</span></label>
        <select id="academicBranch" value={data.academicBranch || ''} onChange={e => { onChange('academicBranch', e.target.value); }}
          onBlur={() => onBlur('academicBranch')} aria-invalid={!!errors.academicBranch}>
          <option value="">Select your branch</option>
          {ACADEMIC_BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <p className="hint">Your college academic branch, not the BYTE department you're applying to.</p>
        {errors.academicBranch && <p className="field-error" role="alert">{errors.academicBranch}</p>}
      </div>

      <div className="form-field">
        <label htmlFor="year">Year of study <span className="required">*</span></label>
        <select id="year" value={data.year} onChange={e => handleYearChange(e.target.value)}
          onBlur={() => onBlur('year')} aria-invalid={!!errors.year}>
          <option value="">Select year</option>
          {[1, 2, 3, 4].map(y => <option key={y} value={String(y)}>{y === 1 ? '1st' : y === 2 ? '2nd' : y === 3 ? '3rd' : '4th'} year</option>)}
        </select>
        {/* TODO: For 4th year, apply the most permissive task rule. */}
        {errors.year && <p className="field-error" role="alert">{errors.year}</p>}
      </div>

      <div className="form-field">
        <label htmlFor="semester">Semester <span className="required">*</span></label>
        <select id="semester" value={data.semester || ''} onChange={e => onChange('semester', e.target.value)}
          onBlur={() => onBlur('semester')} aria-invalid={!!errors.semester}
          disabled={!data.year}>
          <option value="">Select semester</option>
          {validSemesters ? [validSemesters[0], validSemesters[1]].map(s =>
            <option key={s} value={String(s)}>Semester {s}</option>
          ) : [1,2,3,4,5,6,7,8].map(s =>
            <option key={s} value={String(s)}>Semester {s}</option>
          )}
        </select>
        {errors.semester && <p className="field-error" role="alert">{errors.semester}</p>}
      </div>

      <div className="form-field full">
        <label>Are you in any other societies? <span className="optional">(optional)</span></label>
        <div className="toggle-group">
          <button type="button" className={'toggle-btn' + (data.inOtherSocieties === true ? ' active' : '')}
            onClick={() => onBatchChange({ inOtherSocieties: true, ...((data.societies || []).length === 0 ? { societies: [''] } : {}) })}>Yes</button>
          <button type="button" className={'toggle-btn' + (data.inOtherSocieties === false || data.inOtherSocieties === undefined ? ' active' : '')}
            onClick={() => onBatchChange({ inOtherSocieties: false, societies: [] })}>No</button>
        </div>
        {data.inOtherSocieties && <SocietyList items={(data.societies || []).length > 0 ? data.societies! : ['']} onChange={v => onChange('societies', v)} error={errors.societies}/>}
      </div>
    </div>

    <div className="social-section">
      <p className="section-subtitle">Social handles <span className="optional">(all optional)</span></p>
      <div className="form-grid">
        <FieldInput id="instagram" label="Instagram" value={data.instagram || ''} onChange={v => onChange('instagram', v)}
          onBlur={() => onBlur('instagram')} error={errors.instagram}
          hint="Handle or profile URL" />
        <FieldInput id="twitter" label="Twitter / X" value={data.twitter || ''} onChange={v => onChange('twitter', v)}
          onBlur={() => onBlur('twitter')} error={errors.twitter}
          hint="Handle or profile URL" />
        <FieldInput id="discord" label="Discord" value={data.discord || ''} onChange={v => onChange('discord', v)}
          onBlur={() => onBlur('discord')} error={errors.discord}
          hint="Username (legacy name#1234 OK)" />
      </div>
    </div>
  </>;
}

// ── Wizard ──────────────────────────────────────────────────────────────────
function Wizard() {
  const [data, setData] = useState<Submission>(emptySubmission);
  const [step, setStep] = useState(0); // 0 = applicant details, 1 = tracks, 2 = work, 3 = review
  const [active, setActive] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [found, setFound] = useState(false);
  const [saveState, setSaveState] = useState('Your progress is saved as you go');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [profileComplete, setProfileComplete] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [dirty, setDirty] = useState(false);
  const version = useRef(0);
  const saved = useRef(0);
  const latest = useRef(data);
  const inFlight = useRef(Promise.resolve());
  latest.current = data;

  const normalizeLoadedSubmission = (sub: Submission): Submission => ({
    ...emptySubmission(),
    ...sub,
    student: {
      ...emptySubmission().student,
      ...sub.student,
      academicBranch: sub.student.academicBranch || sub.student.dept || '',
      inOtherSocieties: sub.student.inOtherSocieties ?? Boolean(sub.student.otherSocieties?.trim()),
      societies: sub.student.societies || (sub.student.otherSocieties ? [sub.student.otherSocieties] : []),
      instagram: sub.student.instagram || sub.student.socials?.instagram || '',
      twitter: sub.student.twitter || sub.student.socials?.twitter || '',
      discord: sub.student.discord || sub.student.socials?.discord || '',
    },
    deptAnswers: sub.deptAnswers || {},
    deptSelected: sub.deptSelected || {},
  });
  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!dirty || done) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, done]);

  // Restore from session/server on mount
  useEffect(() => {
    api<Submission>('/draft').then(d => {
      const normalized = normalizeLoadedSubmission(d);
      setData(normalized);
      latest.current = normalized;
      setActive(true);
      setFound(true);
      // Check profile completion
      checkProfileCompletion(d.student);
    }).catch(() => {
      // No active server session — check sessionStorage for local draft
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k?.startsWith(DRAFT_KEY)) {
            const raw = sessionStorage.getItem(k);
            if (raw) {
              const local = JSON.parse(raw) as Submission;
              if (local?.student?.name && local?.student?.enrollment) {
                const normalized = normalizeLoadedSubmission(local);
                setData(normalized);
                latest.current = normalized;
                checkProfileCompletion(normalized.student);
                setSaveState('Local draft loaded');
                break;
              }
            }
          }
        }
      } catch {}
    });
  }, []);

  const checkProfileCompletion = (student: Student) => {
    const errs: ProfileErrors = {};
    const nameErr = validateName(student.name);
    if (nameErr) errs.name = nameErr;
    const emailErr = validateEmail(student.email);
    if (emailErr) errs.email = emailErr;
    const phoneErr = validatePhone(student.phone);
    if (phoneErr) errs.phone = phoneErr;
    const enrollErr = validateEnrollment(student.enrollment);
    if (enrollErr) errs.enrollment = enrollErr;
    const branchErr = validateAcademicBranch(student.academicBranch || '');
    if (branchErr) errs.academicBranch = branchErr;
    const yearErr = validateYear(student.year);
    if (yearErr) errs.year = yearErr;
    const semErr = validateSemester(student.semester || '', student.year);
    if (semErr) errs.semester = semErr;
    const socErr = validateSocieties(!!student.inOtherSocieties, student.societies || []);
    if (socErr) errs.societies = socErr;
    const igErr = validateInstagram(student.instagram || '');
    if (igErr) errs.instagram = igErr;
    const twErr = validateTwitter(student.twitter || '');
    if (twErr) errs.twitter = twErr;
    const dcErr = validateDiscord(student.discord || '');
    if (dcErr) errs.discord = dcErr;
    setProfileComplete(Object.keys(errs).length === 0);
    return errs;
  };
  const save = async (snapshot = latest.current, seq = version.current) => {
    inFlight.current = inFlight.current.catch(() => {}).then(async () => {
      if (seq < saved.current) return;
      try {
        await api<{ updatedAt: string }>('/draft', { method: 'PUT', body: JSON.stringify(snapshot) });
        saved.current = seq;
        if (seq === version.current) { setSaveState('All changes saved'); setDirty(false); }
      } catch (e: any) {
        if (e.status === 401) {
          setSessionExpired(true);
          throw e;
        }
        throw e;
      }
    });
    return inFlight.current;
  };

  useEffect(() => {
    if (!active || done || version.current === saved.current) return;
    setSaveState('Saving changes…');
    const timer = setTimeout(() => {
      save().catch(e => {
        if ((e as any).status !== 401) {
          setSaveState('Could not save · retry by editing a field');
          setError(e.message);
        }
      });
    }, 750);
    return () => clearTimeout(timer);
  }, [data, active, done]);

  // Autosave to sessionStorage
  useEffect(() => {
    if (!active || done) return;
    saveDraftLocal(data.student.enrollment, data);
  }, [data, active, done]);

  function update(next: Submission) { version.current++; setData(next); setError(''); setDirty(true); }
  function student(key: keyof Student, value: any) {
    setData(prev => {
      const next = { ...prev, student: { ...prev.student, [key]: value } };
      latest.current = next;
      return next;
    });
    version.current++; setError(''); setDirty(true);
  }
  function studentBatch(updates: Partial<Student>) {
    setData(prev => {
      const next = { ...prev, student: { ...prev.student, ...updates } };
      latest.current = next;
      return next;
    });
    version.current++; setError(''); setDirty(true);
  }

  const handleProfileBlur = useCallback((field: string) => {
    const s = latest.current.student;
    let err: string | null = null;
    switch (field) {
      case 'name': err = validateName(s.name); break;
      case 'email': err = validateEmail(s.email); break;
      case 'phone': err = validatePhone(s.phone); break;
      case 'enrollment': err = validateEnrollment(s.enrollment); break;
      case 'academicBranch': err = validateAcademicBranch(s.academicBranch || ''); break;
      case 'year': err = validateYear(s.year); break;
      case 'semester': err = validateSemester(s.semester || '', s.year); break;
      case 'instagram': err = validateInstagram(s.instagram || ''); break;
      case 'twitter': err = validateTwitter(s.twitter || ''); break;
      case 'discord': err = validateDiscord(s.discord || ''); break;
    }
    setProfileErrors(prev => {
      const next = { ...prev };
      if (err) next[field] = err; else delete next[field];
      return next;
    });
  }, []);
  async function recover() {
    if (active || recovering || data.student.name.trim().length < 2 || data.student.enrollment.trim().length < 4) return false;
    setRecovering(true); setError('');
    try {
      const result = await post<{ found: boolean; submission: Submission }>('/draft/recover', { name: data.student.name, enrollment: data.student.enrollment });
      const restored = result.found ? result.submission : { ...result.submission, student: { ...data.student, name: result.submission.student.name, enrollment: result.submission.student.enrollment } };
      setData(restored); latest.current = restored; version.current = result.found ? 0 : 1; saved.current = 0;
      setFound(result.found); setActive(true);
      setSaveState(result.found ? 'Existing draft recovered' : 'Draft started · autosave is on');
      checkProfileCompletion(restored.student);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setRecovering(false); }
  }

  async function saveProfile(): Promise<boolean> {
    // Validate all fields
    const errs = checkProfileCompletion(data.student);
    setProfileErrors(errs);
    if (Object.keys(errs).length > 0) {
      // Focus first error field
      const firstField = Object.keys(errs)[0];
      document.getElementById(firstField)?.focus();
      setError('Please fix the highlighted fields.');
      return false;
    }

    // Save profile to server
    try {
      setSaveState('Saving profile…');
      // Send only recognized profile fields (exclude legacy fields like dept, otherSocieties, socials)
      const { name, enrollment, email, phone, academicBranch, year, semester, inOtherSocieties, societies, instagram, twitter, discord } = data.student;
      const result = await put<{ updatedAt: string; profileComplete: boolean; errors?: ProfileErrors }>('/profile', {
        profile: { name, enrollment, email, phone, academicBranch, year, semester, inOtherSocieties, societies, instagram, twitter, discord },
      });
      setProfileComplete(result.profileComplete);
      if (result.errors) {
        setProfileErrors(result.errors);
        setError('Please fix the highlighted fields.');
        return false;
      }
      setSaveState('Profile saved ✓');
      setDirty(false);
      return true;
    } catch (e: any) {
      if (e.status === 401) { setSessionExpired(true); return false; }
      setError(e.message);
      return false;
    }
  }

  async function next() {
    setError('');
    if (step === 0) {
      // Validate Step 1
      if (!data.student.name.trim() || !data.student.enrollment.trim()) {
        setError('Enter your name and enrollment number first.');
        return;
      }
      if (!active && !(await recover())) return;

      // Now validate all profile fields
      const ok = await saveProfile();
      if (!ok) return;
    }
    if (step === 1 && !data.selected.length) { setError('Choose at least one department to continue.'); return; }
    if (step === 2) {
      // Validate dept-specific required fields
      for (const deptId of data.selected) {
        const config = getDeptConfig(deptId);
        if (!config || config.comingSoon) continue;
        const answers = (data.deptAnswers || {})[deptId] || {};
        // For taskPicker depts use explicit selections; for others derive from attempted tasks
        const selectedTasks = config.taskPicker
          ? ((data.deptSelected || {})[deptId] || [])
          : config.tasks.filter(t => isTaskAttempted(t, answers)).map(t => t.id);
        const yearNum = parseInt(data.student.year, 10) || 0;

        // Global required fields
        for (const field of config.globalFields) {
          if (!isFieldActive(field, answers)) continue;
          const val = answers[field.key];
          if (field.required) {
            if (field.type === 'multi-select') {
              if (!Array.isArray(val) || val.length < (field.minSelect || 1)) {
                setError(`${config.name}: ${field.label} — select at least ${field.minSelect || 1}.`); return;
              }
            } else if (field.type === 'url-list') {
              if (!Array.isArray(val) || val.filter((v: string) => v?.trim()).length < 1) {
                setError(`${config.name}: ${field.label} — at least one entry is required.`); return;
              }
            } else if (!val || (typeof val === 'string' && !val.trim())) {
              setError(`${config.name}: ${field.label} is required.`); return;
            }
          }
          if (val && field.urlType) {
            const urlErr = validateFieldUrl(String(val), field.urlType);
            if (urlErr) { setError(`${config.name}: ${urlErr}`); return; }
          }
        }
        // Global checkboxes
        for (const cb of config.globalCheckboxes) {
          if (cb.required && !answers[cb.key]) { setError(`${config.name}: Please check “${cb.label}”`); return; }
        }
        // Task picker count
        if (config.taskPicker && config.taskPickCount && selectedTasks.length !== config.taskPickCount) {
          setError(`${config.name}: Select exactly ${config.taskPickCount} tasks.`); return;
        }
        // Year rule
        if (config.yearRule && yearNum > 0) {
          const yearErr = config.yearRule(yearNum, selectedTasks);
          if (yearErr) { setError(`${config.name}: ${yearErr}`); return; }
        }
        // Task-level required fields + checkboxes
        for (const task of config.tasks) {
          if (config.taskPicker && !selectedTasks.includes(task.id)) continue;
          const attempted = isTaskAttempted(task, answers);
          if (!attempted) continue;
          for (const field of task.fields) {
            if (field.type === 'toggle') continue;
            if (!isFieldActive(field, answers)) continue;
            const val = answers[field.key];
            if (field.required) {
              if (field.type === 'multi-select') {
                if (!Array.isArray(val) || val.length < (field.minSelect || 1)) {
                  setError(`${config.name} / ${task.name}: ${field.label} — select at least ${field.minSelect || 1}.`); return;
                }
              } else if (field.type === 'url-list') {
                if (!Array.isArray(val) || val.filter((v: string) => v?.trim()).length < 1) {
                  setError(`${config.name} / ${task.name}: ${field.label} — at least one entry is required.`); return;
                }
              } else if (!val || (typeof val === 'string' && !val.trim())) {
                setError(`${config.name} / ${task.name}: ${field.label} is required.`); return;
              }
            }
          }
          for (const cb of task.checkboxes) {
            if (cb.required && !answers[cb.key]) { setError(`${config.name} / ${task.name}: Please check “${cb.label}”`); return; }
          }
        }
      }
      // Also validate legacy track answers
      for (const track of tracks.filter(t => !getDeptConfig(t.id) && data.selected.includes(t.id))) for (const field of track.fields.filter(f => f.required)) if (!data.answers[track.id]?.[field.key]?.trim()) { setError(`${track.name}: ${field.label} is required.`); return; }
    }
    if (active && version.current !== saved.current) { try { setSaveState('Saving changes…'); await save(); } catch (e) { if ((e as any).status !== 401) setError('Could not save your changes. ' + (e as Error).message); return; } }
    setStep(s => Math.min(s + 1, 3)); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    setSending(true); setError('');
    try {
      if (version.current !== saved.current) await save();
      await post('/draft/submit');
      setDone(true);
      clearDraftLocal(data.student.enrollment);
      window.scrollTo(0, 0);
    } catch (e: any) {
      if (e.status === 401) { setSessionExpired(true); } else if (e.status === 403) { setError(e.message + ' Go back to Step 1 to complete your profile.'); } else setError(e.message);
    } finally { setSending(false); }
  }

  // Session expired overlay
  if (sessionExpired) {
    return <Shell><main className="wizard-layout"><section className="workspace" style={{ gridColumn: '1/-1' }}>
      <div className="workspace-body" style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
        <div className="section-icon">SESSION EXPIRED</div>
        <h1>Your session <em>expired.</em></h1>
        <p className="lead">Don't worry — your data is safe. Sign in again with the same name and enrollment to continue.</p>
        <button className="button primary" onClick={() => { setSessionExpired(false); setActive(false); setSaveState('Re-enter your details to resume'); }}>
          Sign in again <ArrowRight size={17}/>
        </button>
      </div>
    </section></main></Shell>;
  }

  if (done) return <Shell><main className="success"><div className="success-icon"><Check size={40}/></div><p className="eyebrow">SUBMISSION RECEIVED</p><h1>That's a wrap.<br/><em>Nice work.</em></h1><p>Your work is with the BYTE team now. We'll reach out at <strong>{data.student.email}</strong> if we need anything else.</p><a href="https://bytesoc.dev/" className="button primary">Back to BYTE <ArrowUpRight size={17}/></a></main></Shell>;

  const windowOpen = isWindowOpen();

  return <Shell><main className="wizard-layout"><aside className="sidebar"><div className="sidebar-inner"><p className="eyebrow">YOUR APPLICATION <span className="eyebrow-rule"/></p><h2>Show us what<br/><em>you can do.</em></h2><p className="sidebar-copy">A few details, the tracks you love, and the work you're proud of. That's all it takes.</p><nav className="step-list" aria-label="Form steps">{allStepLabels.map((s, i) => <div key={s} className={'step-item ' + (step === i ? 'current' : '') + (step > i ? ' completed' : '') + (i > 0 && !profileComplete ? ' locked' : '')}><span className="step-index">{step > i ? <Check size={15}/> : String(i + 1).padStart(2, '0')}</span><span>{s}</span>{step === i && <span className="step-dot"/>}</div>)}</nav><div className="sidebar-bottom"><Sparkles size={18}/><p>"The best way to learn is to build something real."</p></div></div></aside><section className="workspace"><div className="workspace-top"><span className="eyebrow">STEP {String(step + 1).padStart(2, '0')} / 04</span><span className="save-indicator"><span className="save-pulse"/> {saveState}</span></div><div className="workspace-body">
  {!windowOpen && <div className="notice window-notice"><LockKeyhole size={19}/><span>Submissions open on <strong>29 September 2025, 12:01 AM IST</strong>.{WINDOW_CLOSE ? ` Closing: ${new Date(WINDOW_CLOSE).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''} You can preview the form but cannot submit yet.</span></div>}

  {step === 0 && <>
    {found && <div className="notice recovered" role="status"><CheckCircle2 size={19}/> We found your draft and picked up where you left off.</div>}
    <ApplicantDetails data={data.student} onChange={student} onBatchChange={studentBatch} errors={profileErrors} onBlur={handleProfileBlur} disabled={active && step === 0 && false /* Name/enrollment lock handled server-side */}/>
    <div className="notice"><ShieldCheck size={19}/><span>Already started? Enter the same name and enrollment number and we'll recover your draft. Anyone with these details may access it; avoid entering sensitive information.</span></div>
  </>}

  {step === 1 && <><div className="section-icon">02 — FIND YOUR THING</div><h1>Choose your <em>departments.</em></h1><p className="lead">Pick one or go for a few. There's no limit to where curiosity can take you.</p>
    {!profileComplete && <div className="notice" style={{marginBottom:24}}><Pencil size={19}/><span>Complete your applicant profile first. <button className="link-btn" onClick={() => setStep(0)}>Go to Step 1</button></span></div>}
    <div className="track-count">{data.selected.length} SELECTED <span>·</span> {deptConfigs.length} DEPARTMENTS AVAILABLE</div>
    <div className="track-list">{deptConfigs.map((dept, i) => <label key={dept.id} className={'track-row ' + (data.selected.includes(dept.id) ? 'selected' : '')}>
      <input type="checkbox" checked={data.selected.includes(dept.id)} onChange={() => update({ ...data, selected: data.selected.includes(dept.id) ? data.selected.filter(id => id !== dept.id) : [...data.selected, dept.id] })}/>
      <span className="track-number">{String(i + 1).padStart(2, '0')}</span>
      <span className="track-color" style={{ backgroundColor: dept.color }}/>
      <span className="track-name">{dept.name}{dept.comingSoon && <span className="coming-soon-badge">COMING SOON</span>}<small>{dept.category}</small></span>
      <span className="track-check"><Check size={17}/></span>
    </label>)}</div>
    <a className="external-note" href="https://bytesoc.dev/tasks/" target="_blank" rel="noreferrer">Not sure? Explore the full tasks on bytesoc.dev <ArrowUpRight size={15}/></a>
  </>}

  {step === 2 && <><div className="section-icon">03 — THE GOOD STUFF</div><h1>Show your <em>work.</em></h1><p className="lead">Fill in your submission for each department. Your answers save automatically, so take your time.</p>
    {(() => {
      const yearNum = parseInt(data.student.year, 10) || 0;
      return deptConfigs.filter(d => data.selected.includes(d.id)).map((dept, index) => {
        const deptAnswers = data.deptAnswers?.[dept.id] || {};
        const deptSelectedTasks = data.deptSelected?.[dept.id] || [];
        return <div className="answer-group" key={dept.id}>
          <div className="answer-heading">
            <span className="answer-number">{String(index + 1).padStart(2, '0')}</span>
            <div><small>{dept.category}</small><h2>{dept.name}</h2></div>
            <span className="track-color" style={{ backgroundColor: dept.color }}/>
          </div>
          <div className="answer-fields">
            <DeptForm
              config={dept}
              answers={deptAnswers}
              selectedTasks={deptSelectedTasks}
              year={yearNum}
              studentName={data.student.name}
              studentBranch={data.student.academicBranch || ''}
              onAnswer={(key, value) => update({
                ...data,
                deptAnswers: { ...data.deptAnswers, [dept.id]: { ...(data.deptAnswers || {})[dept.id], [key]: value } }
              })}
              onSelectTasks={(ids) => update({
                ...data,
                deptSelected: { ...data.deptSelected, [dept.id]: ids }
              })}
            />
          </div>
        </div>;
      });
    })()}
    {data.selected.length > 0 && <div className="notice" style={{marginTop:24}}><Pencil size={19}/><span>You can edit your submission until the window closes. Re-submitting updates the same record.</span></div>}
  </>}

  {step === 3 && <><div className="section-icon">04 — ONE LAST LOOK</div><h1>Ready to <em>send it?</em></h1><p className="lead">Take a moment to review everything. Once submitted, your application can't be edited.</p>
    <div className="review-block"><div className="review-head"><span>APPLICANT PROFILE</span><button onClick={() => setStep(0)}>Edit <ArrowUpRight size={14}/></button></div>
      <h2>{data.student.name}</h2>
      <p>{data.student.enrollment} · {data.student.academicBranch || '—'} · Year {data.student.year}, Sem {data.student.semester || '—'}</p>
      <p>{data.student.email} · {data.student.phone}</p>
      {data.student.inOtherSocieties && (data.student.societies || []).length > 0 && <p>Societies: {(data.student.societies || []).join(', ')}</p>}
      {(data.student.instagram || data.student.twitter || data.student.discord) && <p className="review-handles">
        {data.student.instagram && <span>IG: @{normalizeInstagram(data.student.instagram)}</span>}
        {data.student.twitter && <span>X: @{normalizeTwitter(data.student.twitter)}</span>}
        {data.student.discord && <span>Discord: {normalizeDiscord(data.student.discord)}</span>}
      </p>}
    </div>
    <div className="review-block"><div className="review-head"><span>YOUR DEPARTMENTS & WORK</span><button onClick={() => setStep(2)}>Edit <ArrowUpRight size={14}/></button></div>
      {deptConfigs.filter(d => data.selected.includes(d.id)).map(dept => {
        const answers = (data.deptAnswers || {})[dept.id] || {};
        const selectedTasks = (data.deptSelected || {})[dept.id] || [];
        if (dept.comingSoon) return <div className="review-track" key={dept.id}><strong>{dept.name}</strong><p className="hint">Submission details coming soon.</p></div>;
        return <div className="review-track" key={dept.id}>
          <strong>{dept.name}</strong>
          {/* Global fields */}
          {dept.globalFields.map(f => {
            const val = answers[f.key];
            if (!val) return null;
            return <p key={f.key}><span>{f.label}</span>{f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)}</a> : String(val)}</p>;
          })}
          {/* Global checkboxes */}
          {dept.globalCheckboxes.filter(cb => answers[cb.key]).map(cb => <p key={cb.key} className="review-checkbox">✅ {cb.label}</p>)}
          {/* Tasks */}
          {dept.tasks.filter(t => !dept.taskPicker || selectedTasks.includes(t.id)).filter(t => isTaskAttempted(t, answers)).map(task => <div key={task.id} className="review-task-section">
            <p className="review-task-name">{task.name} <span className={'task-tag tag-' + task.tag.toLowerCase()}>{task.tag}</span></p>
            {task.fields.filter(f => f.type !== 'toggle' && answers[f.key]).map(f => {
              const val = answers[f.key];
              return <p key={f.key}><span>{f.label}</span>{f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)}</a> : f.type === 'file' ? `${String(val).trim().split('\n').length} lines` : String(val)}</p>;
            })}
            {task.checkboxes.filter(cb => answers[cb.key]).map(cb => <p key={cb.key} className="review-checkbox">✅ {cb.label}</p>)}
          </div>)}
        </div>;
      })}
    </div>
    <div className="notice"><CircleHelp size={19}/> Your GitHub repositories and Drive links will be checked when you submit. Private or inaccessible links can't be accepted.</div>
  </>}
  {error && <p role="alert" className="error-banner">{error}</p>}
  <div className="form-actions">
    {step > 0 ? <button className="button back" onClick={() => { setStep(step - 1); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><ArrowLeft size={17}/> Back</button> : <span className="action-note"><LockKeyhole size={15}/> Your details stay with BYTE</span>}
    {step === 3 ? <button className="button primary" disabled={sending || !windowOpen} onClick={submit}>{sending ? 'Submitting…' : 'Submit application'} <ArrowRight size={17}/></button> : <button className="button primary" disabled={recovering || (!windowOpen && step > 0)} onClick={next}>{recovering ? 'Finding your draft…' : 'Continue'} <ArrowRight size={17}/></button>}
  </div>
  </div></section></main></Shell>;
}

// ── Login ───────────────────────────────────────────────────────────────────
function Login() {
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { api<{ authenticated: boolean }>('/admin/session').then(r => { if (r.authenticated) location.assign('/admin'); }); }, []);
  async function login(e: React.FormEvent) { e.preventDefault(); setLoading(true); setError(''); try { await post('/admin/login', { password }); location.assign('/admin'); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } }
  return <Shell admin><main className="login-layout"><div className="login-art"><span className="eyebrow">THE OTHER SIDE OF THE TABLE</span><div className="art-orbit"><span>B<span>.</span></span></div><h1>Great work starts<br/>with <em>great people.</em></h1><p>The BYTE recruitment desk. See what this year's builders are bringing to the table.</p></div><div className="login-form-wrap"><div className="login-card"><span className="login-lock"><LockKeyhole size={23}/></span><p className="section-icon">ADMIN / SIGN IN</p><h2>Welcome back.</h2><p className="muted">Enter your admin password to access submissions.</p><form onSubmit={login}><FieldInput id="password" label="Password" type="password" value={password} onChange={setPassword} required/>{error && <p className="error-banner" role="alert">{error}</p>}<button className="button primary wide" disabled={loading || !password}>{loading ? 'Signing in…' : 'Sign in'} <ArrowRight size={17}/></button></form><p className="login-hint">Only authorized BYTE members can access this area.</p></div></div></main></Shell>;
}

// ── Admin ───────────────────────────────────────────────────────────────────
function Admin() {
  const [items, setItems] = useState<Submission[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [track, setTrack] = useState('all'); const [selected, setSelected] = useState<Submission | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { api<Submission[]>('/admin/submissions').then(setItems).catch(e => { if (e.message.includes('Sign in')) location.assign('/login'); else setError(e.message); }).finally(() => setLoading(false)); }, []);
  const visible = items.filter(s => (status === 'all' || s.status === status) && (track === 'all' || s.selected.includes(track)) && [s.student.name, s.student.enrollment, s.student.email].some(v => v.toLowerCase().includes(query.toLowerCase())));

  async function exportCSV() {
    setExporting(true);
    try {
      const response = await fetch('/api/admin/export.csv', { credentials: 'same-origin' });
      if (!response.ok) { const d = await response.json(); throw new Error(d.error); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `byte-submissions-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  }

  async function exportJSON() {
    setExporting(true);
    try {
      const response = await fetch('/api/admin/export.json', { credentials: 'same-origin' });
      if (!response.ok) { const d = await response.json(); throw new Error(d.error); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `byte-submissions-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setExporting(false); }
  }

  return <Shell admin><main className="admin-layout"><div className="admin-head"><div><p className="eyebrow">BYTE / RECRUITMENT DESK</p><h1>Submissions<span className="accent-period">.</span></h1><p>All the ideas and effort coming your way, in one place.</p></div><div className="admin-actions"><button className="export-btn" onClick={exportCSV} disabled={exporting}><Download size={16}/> {exporting ? 'Exporting…' : 'Export CSV'}</button><button className="export-btn secondary" onClick={exportJSON} disabled={exporting}><Download size={16}/> Export JSON</button><button className="logout" onClick={async () => { await post('/admin/logout'); location.assign('/login'); }}><LogOut size={16}/> Sign out</button></div></div><div className="stats"><div><small>TOTAL APPLICATIONS</small><strong>{items.length}</strong></div><div><small>SUBMITTED</small><strong>{items.filter(i => i.status === 'submitted').length}</strong></div><div><small>IN PROGRESS</small><strong>{items.filter(i => i.status === 'draft').length}</strong></div><div><small>TRACKS</small><strong>{tracks.length}</strong></div></div><div className="admin-content"><div className="admin-section-heading"><h2>All entries</h2><span>{visible.length} results</span></div><div className="filters"><label className="search-field"><Search size={18}/><span className="sr-only">Search entries</span><input placeholder="Search name, enrollment, email..." value={query} onChange={e => setQuery(e.target.value)}/></label><label><span className="sr-only">Filter by status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="draft">Drafts</option></select></label><label><span className="sr-only">Filter by track</span><select value={track} onChange={e => setTrack(e.target.value)}><option value="all">All tracks</option>{tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>{loading ? <p className="empty">Loading entries…</p> : error ? <p className="error-banner" role="alert">{error}</p> : !visible.length ? <p className="empty">No entries match your filters yet.</p> : <div className="entries"><div className="table-head"><span>STUDENT</span><span>TRACKS</span><span>STATUS</span><span>LAST UPDATED</span><span/></div>{visible.map(s => <button className="entry" key={s.student.enrollment} onClick={() => setSelected(s)}><span className="entry-person"><strong>{s.student.name}</strong><small>{s.student.enrollment}{s.student.academicBranch ? ` · ${s.student.academicBranch}` : ''}</small></span><span className="entry-tracks">{s.selected.length ? s.selected.map(id => deptConfigs.find(d => d.id === id)?.name || tracks.find(t => t.id === id)?.name || id).join(', ') : 'Not selected yet'}</span><span><span className={'badge ' + s.status}>{s.status}</span></span><span className="date">{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span><ArrowUpRight size={17}/></button>)}</div>}</div></main>
  {selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="detail" role="dialog" aria-modal="true" aria-label="Submission details"><div className="detail-top"><span className="eyebrow">SUBMISSION DETAILS</span><button onClick={() => setSelected(null)} aria-label="Close details">✕</button></div><h2>{selected.student.name}</h2><span className={'badge ' + selected.status}>{selected.status}</span><div className="detail-facts"><p><span>Enrollment</span>{selected.student.enrollment}</p><p><span>Email</span>{selected.student.email || '—'}</p><p><span>Phone</span>{selected.student.phone || '—'}</p><p><span>Branch</span>{selected.student.academicBranch || '—'}</p><p><span>Year / Sem</span>{selected.student.year ? `Year ${selected.student.year}, Sem ${selected.student.semester || '—'}` : '—'}</p><p><span>Societies</span>{selected.student.inOtherSocieties && (selected.student.societies || []).length > 0 ? (selected.student.societies || []).join(', ') : 'None'}</p><p><span>Instagram</span>{selected.student.instagram || '—'}</p><p><span>Twitter/X</span>{selected.student.twitter || '—'}</p><p><span>Discord</span>{selected.student.discord || '—'}</p><p><span>Updated</span>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '—'}</p></div><h3>Department submissions</h3>{!selected.selected.length && <p className="muted">No departments selected yet.</p>}{selected.selected.map(deptId => {
    const config = getDeptConfig(deptId);
    const deptAns = (selected.deptAnswers || {})[deptId] || {};
    const legacyAns = selected.answers?.[deptId] || {};
    const selectedTasks = (selected.deptSelected || {})[deptId] || [];
    if (config) {
      return <div className="detail-track" key={config.id}>
        <h4>{config.name}</h4>
        {config.globalFields.map(f => {
          const val = deptAns[f.key] !== undefined ? deptAns[f.key] : legacyAns[f.key];
          if (!val) return null;
          return <div key={f.key}><small>{f.label}</small><p>{f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)} <ArrowUpRight size={13}/></a> : String(val)}</p></div>;
        })}
        {config.globalCheckboxes.filter(cb => deptAns[cb.key]).map(cb => <p key={cb.key} style={{fontSize:12,color:'#baf263',margin:'4px 0'}}>✓ {cb.label}</p>)}
        {config.tasks.filter(t => !config.taskPicker || selectedTasks.includes(t.id)).filter(t => isTaskAttempted(t, deptAns)).map(task => <div key={task.id} style={{marginTop:14,paddingLeft:12,borderLeft:'2px solid #3b543f'}}>
          <p style={{fontWeight:600,fontSize:13,margin:'6px 0',color:'#dce8dc'}}>{task.name} <span className={'task-tag tag-' + task.tag.toLowerCase()}>{task.tag}</span></p>
          {task.fields.filter(f => f.type !== 'toggle' && deptAns[f.key]).map(f => {
            const val = deptAns[f.key];
            return <div key={f.key}><small>{f.label}</small><p>{f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)} <ArrowUpRight size={13}/></a> : f.type === 'file' ? `${String(val).trim().split('\n').length} lines` : String(val)}</p></div>;
          })}
          {task.checkboxes.filter(cb => deptAns[cb.key]).map(cb => <p key={cb.key} style={{fontSize:12,color:'#baf263',margin:'4px 0'}}>✓ {cb.label}</p>)}
        </div>)}
      </div>;
    }
    const track = tracks.find(t => t.id === deptId);
    if (!track) return null;
    return <div className="detail-track" key={track.id}>
      <h4>{track.name}</h4>
      {track.fields.map(f => <div key={f.key}><small>{f.label}</small><p>{legacyAns[f.key] ? (f.type === 'url' ? <a href={legacyAns[f.key]} target="_blank" rel="noreferrer">{legacyAns[f.key]} <ArrowUpRight size={13}/></a> : legacyAns[f.key]) : '—'}</p></div>)}
    </div>;
  })}</section></div>}</Shell>;
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login/> : location.pathname === '/admin' ? <Admin/> : <Wizard/>);
