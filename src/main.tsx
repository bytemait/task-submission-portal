import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight, ArrowLeft, ArrowUpRight, BarChart3, Calendar, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Download,
  FolderTree as FolderTreeIcon, GraduationCap, Layers, LockKeyhole, LogOut,
  Pencil, Plus, Search, Sparkles, Trash2, TrendingUp, Upload, Users, X,
} from 'lucide-react';
import { tracks, emptySubmission, type Submission, type Student, type Field } from '../shared/tracks.ts';
import {
  validateName, validateEmail, validatePhone, validateEnrollment,
  validateAcademicBranch, validateSemester,
  validateSocieties, validateInstagram, validateTwitter, validateDiscord,
  normalizePhone, normalizeInstagram, normalizeTwitter, normalizeDiscord,
  ACADEMIC_BRANCHES, APPLICANT_SEMESTERS, yearForSemester, ENROLLMENT_MAX_LENGTH,
  type ProfileErrors,
} from '../shared/validation.ts';
import {
  deptConfigs, getDeptConfig, isFieldActive, isTaskAttempted, getEffectiveTaskTag,
  validateFieldUrl, validateMangaJsonl, countWords, validateWordLimit,
  formatCheckboxLabel, buildFilenameHint,
  DEFAULT_SUBMISSION_OPENS, DEFAULT_NEW_FORMS_CLOSE, DEFAULT_SUBMISSION_CLOSE,
  type DeptConfig, type TaskConfig, type DeptField,
} from '../shared/submissionConfig.ts';
import './style.css';

// ── Submission window & deadlines ───────────────────────────────────────────
const WINDOW_OPEN_STR = (import.meta as any).env?.VITE_SUBMISSION_OPEN || DEFAULT_SUBMISSION_OPENS;
const WINDOW_OPEN = new Date(WINDOW_OPEN_STR);

const NEW_FORMS_CLOSE_STR = (import.meta as any).env?.VITE_NEW_FORMS_CLOSE !== undefined
  ? (import.meta as any).env.VITE_NEW_FORMS_CLOSE
  : DEFAULT_NEW_FORMS_CLOSE;
const NEW_FORMS_CLOSE = NEW_FORMS_CLOSE_STR ? new Date(NEW_FORMS_CLOSE_STR) : null;

const WINDOW_CLOSE_STR = (import.meta as any).env?.VITE_SUBMISSION_CLOSE !== undefined
  ? (import.meta as any).env.VITE_SUBMISSION_CLOSE
  : DEFAULT_SUBMISSION_CLOSE;
const WINDOW_CLOSE = WINDOW_CLOSE_STR ? new Date(WINDOW_CLOSE_STR) : null;

function isWindowOpen(): boolean {
  const now = Date.now();
  if (now < WINDOW_OPEN.getTime()) return false;
  if (WINDOW_CLOSE && now > WINDOW_CLOSE.getTime()) return false;
  return true;
}

function canCreateNewForm(): boolean {
  const now = Date.now();
  if (now < WINDOW_OPEN.getTime()) return false;
  if (NEW_FORMS_CLOSE && now > NEW_FORMS_CLOSE.getTime()) return false;
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
    <p className="task-picker-hint">
      {config.taskMinCount
        ? <>Select at least <strong>{config.taskMinCount}</strong> tasks. {year >= 2 && 'Year-based rules apply.'}</>
        : <>Select exactly <strong>{config.taskPickCount}</strong> tasks. {year >= 2 && 'Year-based rules apply.'}</>}
    </p>
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

  const getCheckboxLabel = (cb: { key: string; label: string }) =>
    formatCheckboxLabel(config.id, cb.key, cb.label, studentName, studentBranch);

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

      const effectiveTag = getEffectiveTaskTag(task, config.id, year);
      const attempted = isTaskAttempted(task, answers);
      const showContent = config.taskPicker || attempted;

      // If this task is effectively Required (year-driven), auto-set any "Attempted" toggle to true
      const attemptedToggle = task.fields.find(f => f.type === 'toggle' && f.key.includes('Attempted'));
      const isYearRequired = effectiveTag === 'Required' && task.tag !== 'Required'; // year-driven override
      if (isYearRequired && attemptedToggle && !answers[attemptedToggle.key]) {
        // Force the toggle on — fires once when the user reaches this form with year >= 2
        setTimeout(() => onAnswer(attemptedToggle.key, true), 0);
      }

      return <div key={task.id} className={'dept-task ' + (effectiveTag === 'Bonus' || effectiveTag === 'Optional' ? 'dept-task-bonus' : '')}>
        <div className="dept-task-heading">
          <span className={'task-tag tag-' + effectiveTag.toLowerCase()}>{effectiveTag}</span>
          <h3>{task.name}</h3>
        </div>

        {/* Toggle fields (like "Task 2 attempted?") always shown — unless year-required, then lock it */}
        {task.fields.filter(f => f.type === 'toggle').map(f => {
          const isAttemptedToggle = f.key.includes('Attempted');
          if (isYearRequired && isAttemptedToggle) {
            // Locked: year-required tasks can't be toggled off
            return <div key={`${config.id}-${task.id}-${f.key}`} className="form-field full">
              <label>{f.label}</label>
              <div className="toggle-group">
                <button type="button" className="toggle-btn active" disabled>Yes</button>
                <button type="button" className="toggle-btn" disabled onClick={() => {}}>No</button>
              </div>
              <p className="hint" style={{marginTop:4, color: '#b8d67a'}}>
                ⓘ This task is required for year {year} students and cannot be skipped.
              </p>
            </div>;
          }
          return renderField(f, `${config.id}-${task.id}`);
        })}

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

        {!showContent && effectiveTag !== 'Required' && <p className="hint" style={{marginTop:8}}>Toggle "Yes" above to fill in this task. {effectiveTag === 'Bonus' ? 'This is a bonus task.' : ''}</p>}
      </div>;
    })}
  </>;
}

// ── Shared components ───────────────────────────────────────────────────────
function Brand() { return <a className="brand" href="/" aria-label="BYTE home"><span className="brand-mark">B<span>.</span></span><span className="brand-type">BYTE<span className="brand-sub">MAIT TECH SOCIETY</span></span></a>; }
function Shell({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) { return <div className="app"><header className="topbar"><Brand/><div className="topbar-right"><span className="top-label">RECRUITMENT / 2026</span><a className="top-link" href={admin ? '/' : '/login'}>{admin ? 'Submit a task' : 'Admin access'} <ArrowUpRight size={15}/></a></div></header>{children}<footer className="footer"><span>© 2026 BYTE MAIT</span><span>Made for the next generation of builders.</span><a href="https://bytesoc.dev/tasks/" target="_blank" rel="noreferrer">Explore tasks <ArrowUpRight size={13}/></a></footer></div>; }
function FieldInput({ id, label, value, onChange, type = 'text', hint, required, onBlur, disabled, error, autoComplete, inputMode, ariaDescribedBy, maxLength, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; required?: boolean; onBlur?: () => void; disabled?: boolean; error?: string; autoComplete?: string; inputMode?: string; ariaDescribedBy?: string; maxLength?: number; placeholder?: string;
}) {
  const errorId = id + '-error';
  const hintId = id + '-hint';
  const describedBy = [error ? errorId : '', hint ? hintId : '', ariaDescribedBy || ''].filter(Boolean).join(' ') || undefined;
  const defaultPlaceholder = type === 'url' ? 'https://...' : label === 'Full name' ? 'Your name, as on college records' : label === 'Enrollment number' ? 'e.g. 12345678901' : '';
  return <div className={'form-field' + (error ? ' has-error' : '')}>
    <label htmlFor={id}>{label}{required && <span className="required"> *</span>}{!required && <span className="optional"> (optional)</span>}</label>
    {type === 'textarea' ? <textarea id={id} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder || "A little context goes a long way..."} rows={3} aria-describedby={describedBy} aria-invalid={!!error}/> :
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} onBlur={onBlur} disabled={disabled}
      autoComplete={autoComplete} inputMode={inputMode as any} maxLength={maxLength}
      aria-describedby={describedBy} aria-invalid={!!error}
      placeholder={placeholder ?? defaultPlaceholder}/>}
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
function ApplicantDetails({ data, onChange, onBatchChange, errors, onBlur, disabled, onSwitchUser, canStartFresh = true }: {
  data: Student; onChange: (key: keyof Student, value: any) => void;
  onBatchChange: (updates: Partial<Student>) => void;
  errors: ProfileErrors; onBlur: (key: string) => void; disabled?: boolean;
  onSwitchUser?: () => void; canStartFresh?: boolean;
}) {
  const handleSemesterChange = (semester: string) => {
    onBatchChange({ semester, year: yearForSemester(semester) });
  };

  return <>
    <div className="section-icon">01 — YOUR DETAILS</div>
    <h1>Let's start with <em>you.</em></h1>
    <p className="lead">Your applicant profile. This is shared across all department submissions and only needs to be filled once.</p>

    <div className="form-grid">
      <FieldInput id="name" label="Full name" required value={data.name} disabled={disabled}
        onChange={v => onChange('name', v)} onBlur={() => onBlur('name')}
        error={errors.name} autoComplete="name" hint={disabled ? 'Locked to your active draft session.' : undefined}/>

      <FieldInput id="enrollment" label="Enrollment number" required value={data.enrollment} disabled={disabled} maxLength={ENROLLMENT_MAX_LENGTH}
        onChange={v => onChange('enrollment', v)} onBlur={() => onBlur('enrollment')}
        error={errors.enrollment} hint={disabled ? 'Locked to your active draft session.' : 'Your college enrollment/class roll no'}/>

      {disabled && onSwitchUser && <div className="switch-user-row">
        <button type="button" className="link-btn" onClick={onSwitchUser}>{canStartFresh ? 'Not you? Start fresh' : 'Switch applicant'}</button>
      </div>}

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
        <label htmlFor="semester">Semester <span className="required">*</span></label>
        <select id="semester" value={data.semester || ''} onChange={e => handleSemesterChange(e.target.value)}
          onBlur={() => onBlur('semester')} aria-invalid={!!errors.semester}>
          <option value="">Select semester</option>
          {APPLICANT_SEMESTERS.map(s => <option key={s} value={String(s)}>Semester {s}</option>)}
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
  const [previouslySubmitted, setPreviouslySubmitted] = useState(false);
  const [saveState, setSaveState] = useState('Your progress is saved as you go');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [profileComplete, setProfileComplete] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [windowConfig, setWindowConfig] = useState<{
    opens: string;
    newFormsClose: string | null;
    closes: string | null;
    canCreateNewForm: boolean;
    isOpen: boolean;
  } | null>(null);
  const [resumeName, setResumeName] = useState('');
  const [resumeEnrollment, setResumeEnrollment] = useState('');
  const [resumeError, setResumeError] = useState('');
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
      semester: yearForSemester(sub.student.semester) ? sub.student.semester : '',
      year: yearForSemester(sub.student.semester),
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
    api<{
      opens: string;
      newFormsClose: string | null;
      closes: string | null;
      canCreateNewForm: boolean;
      isOpen: boolean;
    }>('/config/window')
      .then(setWindowConfig)
      .catch(() => {});

    api<Submission>('/draft').then(d => {
      const normalized = normalizeLoadedSubmission(d);
      setData(normalized);
      latest.current = normalized;
      setActive(true);
      setFound(true);
      // Check profile completion
      checkProfileCompletion(normalized.student);
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
                setResumeName(local.student.name);
                setResumeEnrollment(local.student.enrollment);
                post<{ found: boolean; previouslySubmitted?: boolean; submission: Submission }>('/draft/recover', {
                  name: local.student.name,
                  enrollment: local.student.enrollment,
                }).then(result => {
                  const restored = normalizeLoadedSubmission(result.found ? result.submission : local);
                  setData(restored);
                  latest.current = restored;
                  setActive(true);
                  setFound(result.found);
                  setPreviouslySubmitted(!!result.previouslySubmitted);
                  setSaveState(result.previouslySubmitted ? 'Previous submission recovered · you can make changes' : 'Existing draft recovered');
                  checkProfileCompletion(restored.student);
                }).catch(() => {
                  const normalized = normalizeLoadedSubmission(local);
                  setData(normalized);
                  latest.current = normalized;
                  setSaveState('Local draft loaded');
                });
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
    const semErr = validateSemester(student.semester || '', yearForSemester(student.semester));
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

  async function recover() {
    const s = latest.current.student;
    if (active || recovering || s.name.trim().length < 2) return false;
    const enrollmentError = validateEnrollment(s.enrollment);
    if (enrollmentError) {
      setProfileErrors(prev => ({ ...prev, enrollment: enrollmentError }));
      setError(enrollmentError);
      return false;
    }
    setRecovering(true); setError('');
    try {
      const result = await post<{ found: boolean; previouslySubmitted?: boolean; submission: Submission }>('/draft/recover', { name: s.name, enrollment: s.enrollment });
      const restored = normalizeLoadedSubmission(result.found ? result.submission : { ...result.submission, student: { ...s, name: result.submission.student.name, enrollment: result.submission.student.enrollment } });
      setData(restored); latest.current = restored; version.current = result.found ? 0 : 1; saved.current = 0;
      setFound(result.found);
      setPreviouslySubmitted(!!result.previouslySubmitted);
      setActive(true);
      setSaveState(result.previouslySubmitted ? 'Previous submission recovered · you can make changes' : (result.found ? 'Existing draft recovered' : 'Draft started · autosave is on'));
      checkProfileCompletion(restored.student);
      return true;
    } catch (e) { setError((e as Error).message); return false; }
    finally { setRecovering(false); }
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
      case 'semester': err = validateSemester(s.semester || '', yearForSemester(s.semester)); break;
      case 'instagram': err = validateInstagram(s.instagram || ''); break;
      case 'twitter': err = validateTwitter(s.twitter || ''); break;
      case 'discord': err = validateDiscord(s.discord || ''); break;
    }
    setProfileErrors(prev => {
      const next = { ...prev };
      if (err) next[field] = err; else delete next[field];
      return next;
    });

    if ((field === 'enrollment' || field === 'name') && !active && !recovering) {
      if (s.name.trim().length >= 2 && !validateEnrollment(s.enrollment)) {
        recover();
      }
    }
  }, [active, recovering]);
  async function switchUser() {
    try { await post('/draft/logout'); } catch {}
    if (data.student.enrollment) clearDraftLocal(data.student.enrollment);
    const fresh = emptySubmission();
    setData(fresh); latest.current = fresh;
    setActive(false); setFound(false); setPreviouslySubmitted(false); setStep(0);
    setProfileComplete(false); setProfileErrors({});
    setSaveState('Enter your details to begin');
    setResumeName(''); setResumeEnrollment(''); setResumeError('');
    version.current = 0; saved.current = 0;
  }

  async function handleResumeFromClosed(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (recovering) return;
    const name = resumeName.trim();
    const enrollment = resumeEnrollment.trim();
    if (!name || name.length < 2) {
      setResumeError('Enter your full name.');
      return;
    }
    const enrollErr = validateEnrollment(enrollment);
    if (enrollErr) {
      setResumeError(enrollErr);
      return;
    }
    setRecovering(true);
    setResumeError('');
    try {
      const result = await post<{ found: boolean; previouslySubmitted?: boolean; submission: Submission }>('/draft/recover', {
        name,
        enrollment,
      });
      if (!result.found) {
        setResumeError('You missed it. Better luck next year. No existing draft found for this enrollment number.');
        return;
      }
      const restored = normalizeLoadedSubmission(result.submission);
      setData(restored);
      latest.current = restored;
      version.current = 0;
      saved.current = 0;
      setFound(true);
      setPreviouslySubmitted(!!result.previouslySubmitted);
      setActive(true);
      setSaveState(result.previouslySubmitted ? 'Previous submission recovered · you can make changes' : 'Existing draft recovered');
      checkProfileCompletion(restored.student);
    } catch (e: any) {
      setResumeError(e.message || 'You missed it. Better luck next year.');
    } finally {
      setRecovering(false);
    }
  }

  async function saveProfile(targetStudent?: Student): Promise<boolean> {
    const s = targetStudent || latest.current.student;
    // Validate all fields
    const errs = checkProfileCompletion(s);
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
      const { name, enrollment, email, phone, academicBranch, year, semester, inOtherSocieties, societies, instagram, twitter, discord } = s;
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
      const s = latest.current.student;
      if (!s.name.trim() || !s.enrollment.trim()) {
        setError('Enter your name and enrollment number first.');
        return;
      }
      if (!active) {
        const ok = await recover();
        if (!ok) return;
      }

      // Now validate all profile fields
      const ok = await saveProfile(latest.current.student);
      if (!ok) return;
    }
    if (step === 1 && !data.selected.length) { setError('Choose at least one department to continue.'); return; }
    if (step === 2) {
      // Validate dept-specific required fields
      for (const deptId of data.selected) {
        const config = getDeptConfig(deptId);
        if (!config || config.comingSoon) continue;
        const answers = (data.deptAnswers || {})[deptId] || {};
        const yearNum = parseInt(data.student.year, 10) || 0;
        // For taskPicker depts use explicit selections; for others derive from attempted tasks
        const selectedTasks = config.taskPicker
          ? ((data.deptSelected || {})[deptId] || [])
          : config.tasks.filter(t => isTaskAttempted(t, answers)).map(t => t.id);

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
          if (val && field.type === 'url-list' && Array.isArray(val)) {
            for (const item of val) {
              if (typeof item === 'string' && item.trim()) {
                const urlErr = validateFieldUrl(item.trim(), 'any-https');
                if (urlErr) { setError(`${config.name}: ${field.label} — "${item.trim()}" is not a valid URL.`); return; }
              }
            }
          }
          if (val && field.wordLimit && typeof val === 'string') {
            const wErr = validateWordLimit(val, field.wordLimit);
            if (wErr) { setError(`${config.name}: ${field.label} — ${wErr}`); return; }
          }
        }
        // Global checkboxes
        for (const cb of config.globalCheckboxes) {
          if (cb.required && !answers[cb.key]) {
            const label = formatCheckboxLabel(config.id, cb.key, cb.label, data.student.name, data.student.academicBranch);
            setError(`${config.name}: Please check “${label}”`); return;
          }
        }
        // Task picker count
        if (config.taskPicker) {
          if (config.taskMinCount && selectedTasks.length < config.taskMinCount) {
            setError(`${config.name}: Select at least ${config.taskMinCount} tasks.`); return;
          }
          if (config.taskPickCount && selectedTasks.length !== config.taskPickCount) {
            setError(`${config.name}: Select exactly ${config.taskPickCount} tasks.`); return;
          }
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
            if (val && field.urlType) {
              const urlErr = validateFieldUrl(String(val), field.urlType);
              if (urlErr) { setError(`${config.name} / ${task.name}: ${urlErr}`); return; }
            }
            if (val && field.type === 'url-list' && Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === 'string' && item.trim()) {
                  const urlErr = validateFieldUrl(item.trim(), 'any-https');
                  if (urlErr) { setError(`${config.name} / ${task.name}: ${field.label} — "${item.trim()}" is not a valid URL.`); return; }
                }
              }
            }
            if (val && field.type === 'file' && field.accept === '.jsonl') {
              const jsonlErr = validateMangaJsonl(String(val));
              if (jsonlErr) { setError(`${config.name} / ${task.name}: ${jsonlErr}`); return; }
            }
            if (val && field.wordLimit && typeof val === 'string') {
              const wErr = validateWordLimit(val, field.wordLimit);
              if (wErr) { setError(`${config.name} / ${task.name}: ${field.label} — ${wErr}`); return; }
            }
          }
          for (const cb of task.checkboxes) {
            if (cb.required && !answers[cb.key]) {
              const label = formatCheckboxLabel(config.id, cb.key, cb.label, data.student.name, data.student.academicBranch);
              setError(`${config.name} / ${task.name}: Please check “${label}”`); return;
            }
          }
        }
        // App Development: buildUrl vs noBuild validation
        if (config.id === 'app-dev') {
          const hasBuild = typeof answers.buildUrl === 'string' && answers.buildUrl.trim().length > 0;
          const noBuild = !!answers.noBuild;
          if (!hasBuild && !noBuild) {
            setError('App Development: Provide a runnable build link or check "No hosted build is practical".'); return;
          }
          if (hasBuild && noBuild) {
            setError('App Development: Uncheck "No hosted build is practical" if providing a build link.'); return;
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

  const newFormsAllowed = windowConfig !== null ? windowConfig.canCreateNewForm : canCreateNewForm();
  const windowOpen = windowConfig !== null ? windowConfig.isOpen : isWindowOpen();

  if (done) return <Shell><main className="success"><div className="success-icon"><Check size={40}/></div><p className="eyebrow">SUBMISSION RECEIVED</p><h1>That's a wrap.<br/><em>Nice work.</em></h1><p>Your work is with the BYTE team now. We'll reach out at <strong>{data.student.email}</strong> if we need anything else.</p><div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' }}><a href="https://bytesoc.dev/" className="button primary">Back to BYTE <ArrowUpRight size={17}/></a>{windowOpen && <button type="button" className="button secondary" onClick={() => { setDone(false); setActive(false); setFound(false); setPreviouslySubmitted(false); setStep(0); setData(emptySubmission()); latest.current = emptySubmission(); setSaveState('Enter your details to make changes'); }}>Make changes <Pencil size={16}/></button>}</div></main></Shell>;

  // Closed screen for visitors without an active draft session when new forms are closed
  if (!active && !newFormsAllowed) {
    return (
      <Shell>
        <main className="wizard-layout">
          <section className="workspace" style={{ gridColumn: '1/-1' }}>
            <div className="workspace-body" style={{ maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
              <div className="section-icon">RECRUITMENT 2026</div>
              <h1>You missed it.<br/><em>Better luck next year.</em></h1>
              <p className="lead">
                Filling of new forms closed on <strong>17 October at 1:00 AM IST</strong>. We are no longer accepting new registrations for recruitment 2026.
              </p>

              <div style={{
                marginTop: '40px',
                padding: '32px',
                background: '#12261a',
                border: '1px solid #2a4b31',
                borderRadius: '6px',
                textAlign: 'left'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#baf263', fontSize: '11px', fontWeight: 700, letterSpacing: '1.8px' }}>
                  <LockKeyhole size={14}/> ALREADY HAVE A DRAFT?
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: '19px', fontFamily: "'Space Grotesk', sans-serif", color: '#e8eee7' }}>
                  Resume your saved application
                </h3>
                <p className="hint" style={{ marginBottom: '22px' }}>
                  If you started an application before 1:00 AM on 17th October, your draft is preserved. Enter your details below to continue where you left off.
                  {windowOpen
                    ? ' Submissions close on 17 October at 1:00 AM IST.'
                    : ' Note: Submissions closed on 17 October at 1:00 AM IST. Drafts remain viewable.'}
                </p>

                <form onSubmit={handleResumeFromClosed} style={{ display: 'grid', gap: '18px' }}>
                  <FieldInput
                    id="resumeName"
                    label="Full name"
                    required
                    value={resumeName}
                    onChange={v => { setResumeName(v); setResumeError(''); }}
                    placeholder="Enter your full name"
                    autoComplete="name"
                  />
                  <FieldInput
                    id="resumeEnrollment"
                    label="Enrollment number"
                    required
                    value={resumeEnrollment}
                    onChange={v => { setResumeEnrollment(v); setResumeError(''); }}
                    placeholder="Enter your college enrollment / roll no"
                    maxLength={ENROLLMENT_MAX_LENGTH}
                  />
                  {resumeError && <p className="error-banner" role="alert" style={{ margin: 0 }}>{resumeError}</p>}
                  <button
                    type="submit"
                    className="button primary"
                    disabled={recovering || !resumeName.trim() || !resumeEnrollment.trim()}
                    style={{ justifySelf: 'start', marginTop: '6px' }}
                  >
                    {recovering ? 'Finding your draft…' : 'Resume draft'} <ArrowRight size={17}/>
                  </button>
                </form>
              </div>
            </div>
          </section>
        </main>
      </Shell>
    );
  }

  return <Shell><main className="wizard-layout"><aside className="sidebar"><div className="sidebar-inner"><p className="eyebrow">YOUR APPLICATION <span className="eyebrow-rule"/></p><h2>Show us what<br/><em>you can do.</em></h2><p className="sidebar-copy">A few details, the tracks you love, and the work you're proud of. That's all it takes.</p><nav className="step-list" aria-label="Form steps">{allStepLabels.map((s, i) => <div key={s} className={'step-item ' + (step === i ? 'current' : '') + (step > i ? ' completed' : '') + (i > 0 && !profileComplete ? ' locked' : '')}><span className="step-index">{step > i ? <Check size={15}/> : String(i + 1).padStart(2, '0')}</span><span>{s}</span>{step === i && <span className="step-dot"/>}</div>)}</nav><div className="sidebar-bottom"><Sparkles size={18}/><p>"The best way to learn is to build something real."</p></div></div></aside><section className="workspace"><div className="workspace-top"><span className="eyebrow">STEP {String(step + 1).padStart(2, '0')} / 04</span><span className="save-indicator"><span className="save-pulse"/> {saveState}</span></div><div className="workspace-body">
  {(() => {
    const now = Date.now();
    const openTime = WINDOW_OPEN.getTime();
    const closeTime = (WINDOW_CLOSE || new Date(DEFAULT_SUBMISSION_CLOSE)).getTime();
    if (now < openTime) {
      return (
        <div className="notice window-notice">
          <LockKeyhole size={19}/>
          <span>Submissions open on <strong>29 September 2025, 12:01 AM IST</strong>. You can preview the form but cannot submit yet.</span>
        </div>
      );
    }
    if (!windowOpen || now > closeTime) {
      return (
        <div className="notice window-notice">
          <LockKeyhole size={19}/>
          <span>Submissions closed on <strong>17 October 2026, 1:00 AM IST</strong>. Your draft is preserved, but applications can no longer be submitted.</span>
        </div>
      );
    }
    if (!newFormsAllowed) {
      return (
        <div className="notice" style={{ marginBottom: 30 }}>
          <Pencil size={19}/>
          <span>New applications closed on 17 October at 1:00 AM IST. You are editing your existing saved draft. Submissions close on <strong>17 October at 1:00 AM IST</strong>.</span>
        </div>
      );
    }
    return null;
  })()}

  {step === 0 && <>
    {found && <div className="notice recovered" role="status"><CheckCircle2 size={19}/> {previouslySubmitted ? 'We found your previous submission and picked up where you left off. You can update your answers and submit again.' : 'We found your draft and picked up where you left off.'}</div>}
    <ApplicantDetails data={data.student} onChange={student} onBatchChange={studentBatch} errors={profileErrors} onBlur={handleProfileBlur} disabled={active} onSwitchUser={switchUser} canStartFresh={newFormsAllowed}/>
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
    {data.selected.length > 0 && <div className="notice" style={{marginTop:24}}><Pencil size={19}/><span>Your answers save automatically as you make changes.</span></div>}
  </>}

  {step === 3 && <><div className="section-icon">04 — ONE LAST LOOK</div><h1>Ready to <em>send it?</em></h1><p className="lead">{windowOpen ? 'Take a moment to review everything. You can make changes anytime before the submission window closes by re-entering your name and enrollment number.' : 'Submissions closed on 17 October at 1:00 AM IST. Your draft answers are preserved, but applications can no longer be submitted.'}</p>
    <div className="review-block"><div className="review-head"><span>APPLICANT PROFILE</span><button onClick={() => setStep(0)}>Edit <ArrowUpRight size={14}/></button></div>
      <h2>{data.student.name}</h2>
      <p>{data.student.enrollment} · {data.student.academicBranch || '—'} · Semester {data.student.semester || '—'}</p>
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
            return <p key={f.key}><span>{f.label}</span>{
              f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)}</a> :
              f.type === 'url-list' && Array.isArray(val) ? (
                <span>{val.filter(v => typeof v === 'string' && v.trim()).map((u, i) => (
                  <span key={i}>{i > 0 && '; '}<a href={u} target="_blank" rel="noreferrer">{u}</a></span>
                ))}</span>
              ) :
              String(val)
            }</p>;
          })}
          {/* Global checkboxes */}
          {dept.globalCheckboxes.filter(cb => answers[cb.key]).map(cb => <p key={cb.key} className="review-checkbox">✅ {formatCheckboxLabel(dept.id, cb.key, cb.label, data.student.name, data.student.academicBranch)}</p>)}
          {/* Tasks */}
          {dept.tasks.filter(t => !dept.taskPicker || selectedTasks.includes(t.id)).filter(t => isTaskAttempted(t, answers)).map(task => {
            const effTag = getEffectiveTaskTag(task, dept.id, parseInt(data.student.year, 10) || 0);
            return <div key={task.id} className="review-task-section">
              <p className="review-task-name">{task.name} <span className={'task-tag tag-' + effTag.toLowerCase()}>{effTag}</span></p>
              {task.fields.filter(f => f.type !== 'toggle' && answers[f.key]).map(f => {
                const val = answers[f.key];
                return <p key={f.key}><span>{f.label}</span>{
                  f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)}</a> :
                  f.type === 'url-list' && Array.isArray(val) ? (
                    <span>{val.filter(v => typeof v === 'string' && v.trim()).map((u, i) => (
                      <span key={i}>{i > 0 && '; '}<a href={u} target="_blank" rel="noreferrer">{u}</a></span>
                    ))}</span>
                  ) :
                  f.type === 'file' ? `${String(val).trim().split('\n').length} lines` :
                  String(val)
                }</p>;
              })}
              {task.checkboxes.filter(cb => answers[cb.key]).map(cb => <p key={cb.key} className="review-checkbox">✅ {formatCheckboxLabel(dept.id, cb.key, cb.label, data.student.name, data.student.academicBranch)}</p>)}
            </div>;
          })}
        </div>;
      })}
    </div>
    <div className="notice"><CircleHelp size={19}/> Your GitHub repositories and Drive links will be checked when you submit. Private or inaccessible links can't be accepted.</div>
  </>}
  {error && <p role="alert" className="error-banner">{error}</p>}
  <div className="form-actions">
    {step > 0 ? <button className="button back" onClick={() => { setStep(step - 1); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><ArrowLeft size={17}/> Back</button> : <span className="action-note"><LockKeyhole size={15}/> Your details stay with BYTE</span>}
    {step === 3 ? (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
        <button className="button primary" disabled={sending || !windowOpen} onClick={submit}>
          {!windowOpen ? 'Submissions closed' : sending ? 'Submitting…' : (previouslySubmitted ? 'Update submission' : 'Submit application')}{' '}
          {!windowOpen ? <LockKeyhole size={17}/> : <ArrowRight size={17}/>}
        </button>
        {!windowOpen && <span style={{ fontSize: '12px', color: '#ffaaa0' }}>Submissions closed on 17 October at 1:00 AM IST. Drafts stay drafts.</span>}
      </div>
    ) : (
      <button className="button primary" disabled={recovering} onClick={next}>
        {recovering ? 'Finding your draft…' : 'Continue'} <ArrowRight size={17}/>
      </button>
    )}
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

// ── Admin Metrics & Analytics ───────────────────────────────────────────────
function getISTDateKey(isoDateString?: string | null): string {
  if (!isoDateString) return '';
  try {
    const d = new Date(isoDateString);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
}

function formatISTDayLabel(dateKey: string): string {
  try {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12));
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return dateKey;
  }
}

function AdminMetrics({
  items,
  selectedTrack,
  onSelectTrack,
  selectedYear,
  onFilterYear,
  onSearchBranch,
  onFilterStatus,
}: {
  items: Submission[];
  selectedTrack: string;
  onSelectTrack: (track: string) => void;
  selectedYear: string;
  onFilterYear: (year: string) => void;
  onSearchBranch: (branch: string) => void;
  onFilterStatus: (status: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'all' | 'departments' | 'timeline' | 'demographics'>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredDay, setHoveredDay] = useState<{ dateKey: string; label: string; piApproved: number; submitted: number; drafts: number; total: number } | null>(null);

  const total = items.length;
  const submitted = items.filter(i => i.status === 'submitted').length;
  const drafts = items.filter(i => i.status === 'draft').length;
  const conversionRate = total > 0 ? ((submitted / total) * 100).toFixed(1) : '0';
  const totalTrackPicks = items.reduce((acc, s) => acc + (s.selected ? s.selected.length : 0), 0);
  const avgTracks = total > 0 ? (totalTrackPicks / total).toFixed(1) : '0';
  const piApprovedTotal = items.filter(s => Object.values(s.piApproved || {}).some(Boolean)).length;

  // 1. Department Breakdown
  const deptStats = deptConfigs.map(dept => {
    const inDept = items.filter(s => s.selected?.includes(dept.id));
    const deptPiApproved = inDept.filter(s => Boolean(s.piApproved?.[dept.id])).length;
    const deptSubmitted = inDept.filter(s => s.status === 'submitted' && !s.piApproved?.[dept.id]).length;
    const deptDraft = inDept.filter(s => s.status === 'draft' && !s.piApproved?.[dept.id]).length;
    return {
      id: dept.id,
      name: dept.name,
      category: dept.category,
      color: dept.color,
      total: inDept.length,
      piApproved: deptPiApproved,
      submitted: deptSubmitted,
      draft: deptDraft,
      percentage: total > 0 ? Math.round((inDept.length / total) * 100) : 0,
      convRate: inDept.length > 0 ? Math.round((deptSubmitted / inDept.length) * 100) : 0,
    };
  }).sort((a, b) => b.total - a.total);

  const maxDeptTotal = Math.max(...deptStats.map(d => d.total), 1);

  // 2. Day-Wise Timeline
  const dates = new Set<string>();
  const dayCounts = new Map<string, { piApproved: number; submitted: number; drafts: number }>();

  items.forEach(s => {
    const k = getISTDateKey(s.submittedAt || s.updatedAt);
    if (k) {
      dates.add(k);
      if (!dayCounts.has(k)) dayCounts.set(k, { piApproved: 0, submitted: 0, drafts: 0 });
      const entry = dayCounts.get(k)!;
      const approved = Object.values(s.piApproved || {}).some(Boolean);
      if (approved) entry.piApproved++;
      else if (s.status === 'submitted') entry.submitted++;
      else entry.drafts++;
    }
  });

  const sortedDates = Array.from(dates).sort();
  const timeline: { dateKey: string; label: string; piApproved: number; submitted: number; drafts: number; total: number }[] = [];

  if (sortedDates.length > 0) {
    const minD = new Date(sortedDates[0] + 'T00:00:00+05:30');
    const maxD = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00+05:30');
    const dayMs = 24 * 3600 * 1000;
    const spanDays = Math.round((maxD.getTime() - minD.getTime()) / dayMs);

    if (spanDays >= 0 && spanDays <= 30) {
      for (let cur = new Date(minD); cur <= maxD; cur = new Date(cur.getTime() + dayMs)) {
        const k = getISTDateKey(cur.toISOString());
        const d = dayCounts.get(k) || { piApproved: 0, submitted: 0, drafts: 0 };
        timeline.push({
          dateKey: k,
          label: formatISTDayLabel(k),
          piApproved: d.piApproved,
          submitted: d.submitted,
          drafts: d.drafts,
          total: d.piApproved + d.submitted + d.drafts,
        });
      }
    } else {
      sortedDates.forEach(k => {
        const d = dayCounts.get(k) || { piApproved: 0, submitted: 0, drafts: 0 };
        timeline.push({
          dateKey: k,
          label: formatISTDayLabel(k),
          piApproved: d.piApproved,
          submitted: d.submitted,
          drafts: d.drafts,
          total: d.piApproved + d.submitted + d.drafts,
        });
      });
    }
  }

  const maxTimelineTotal = Math.max(...timeline.map(t => t.total), 5);
  const peakDay = timeline.reduce<{ dateKey: string; label: string; piApproved: number; submitted: number; drafts: number; total: number } | null>(
    (prev, cur) => (cur.total > (prev?.total || 0) ? cur : prev),
    timeline[0] || null
  );

  // 3. Academic Year Stats
  const yearDefs = [
    { key: '1', label: '1st Year', sub: 'Freshers' },
    { key: '2', label: '2nd Year', sub: 'Sophomores' },
    { key: '3', label: '3rd Year', sub: 'Juniors' },
    { key: '4', label: '4th Year', sub: 'Seniors' },
  ];

  const yearStats = yearDefs.map(y => {
    const matches = items.filter(s => {
      const yearStr = s.student.year || yearForSemester(s.student.semester) || '';
      return (
        yearStr.includes(y.key) ||
        s.student.semester === String(Number(y.key) * 2 - 1) ||
        s.student.semester === String(Number(y.key) * 2)
      );
    });
    const yearPiApproved = matches.filter(s => Object.values(s.piApproved || {}).some(Boolean)).length;
    const subCount = matches.filter(s => s.status === 'submitted' && !Object.values(s.piApproved || {}).some(Boolean)).length;
    const drfCount = matches.filter(s => s.status === 'draft' && !Object.values(s.piApproved || {}).some(Boolean)).length;
    return {
      ...y,
      total: matches.length,
      piApproved: yearPiApproved,
      submitted: subCount,
      drafts: drfCount,
      percentage: total > 0 ? Math.round((matches.length / total) * 100) : 0,
      convRate: matches.length > 0 ? Math.round((subCount / matches.length) * 100) : 0,
    };
  });

  // 4. College Branch Stats
  const branchMap = new Map<string, { total: number; piApproved: number; submitted: number; drafts: number }>();
  items.forEach(s => {
    const b = (s.student.academicBranch || 'Not specified').trim();
    if (!branchMap.has(b)) branchMap.set(b, { total: 0, piApproved: 0, submitted: 0, drafts: 0 });
    const e = branchMap.get(b)!;
    e.total++;
    if (Object.values(s.piApproved || {}).some(Boolean)) e.piApproved++;
    else if (s.status === 'submitted') e.submitted++;
    else e.drafts++;
  });

  const branchStats = Array.from(branchMap.entries())
    .map(([branch, d]) => ({
      branch,
      ...d,
      percentage: total > 0 ? ((d.total / total) * 100).toFixed(1) : '0',
    }))
    .sort((a, b) => b.total - a.total);

  const maxBranchTotal = Math.max(...branchStats.map(b => b.total), 1);
  const topBranch = branchStats[0] || { branch: '—', total: 0, percentage: '0' };

  // 5. Engagement Insights
  const singleTrack = items.filter(s => (s.selected?.length || 0) === 1).length;
  const twoTracks = items.filter(s => (s.selected?.length || 0) === 2).length;
  const threePlusTracks = items.filter(s => (s.selected?.length || 0) >= 3).length;
  const otherSocietiesCount = items.filter(s => s.student.inOtherSocieties).length;

  return (
    <div className="admin-metrics">
      {/* KPI Cards */}
      <div className="stats">
        <div style={{ cursor: 'pointer' }} onClick={() => onFilterStatus('all')} title="Click to view all applicants">
          <small>TOTAL APPLICANTS</small>
          <strong>{total}</strong>
          <span className="stats-subtext">All candidate profiles</span>
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => onFilterStatus('submitted')} title="Click to filter submitted">
          <small>SUBMITTED</small>
          <strong style={{ color: '#baf263' }}>{submitted}</strong>
          <span className="stats-subtext">{conversionRate}% conversion rate</span>
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => onFilterStatus('draft')} title="Click to filter drafts">
          <small>IN PROGRESS</small>
          <strong style={{ color: '#d8caa8' }}>{drafts}</strong>
          <span className="stats-subtext">{total > 0 ? Math.round((drafts / total) * 100) : 0}% active drafts</span>
        </div>
        <div>
          <small>PI APPROVED</small>
          <strong style={{ color: '#38bdf8' }}>{piApprovedTotal}</strong>
          <span className="stats-subtext">Applicants approved for at least one task</span>
        </div>
        <div>
          <small>TRACK SELECTIONS</small>
          <strong>{totalTrackPicks}</strong>
          <span className="stats-subtext">{avgTracks} tracks / applicant</span>
        </div>
        <div style={{ cursor: 'pointer' }} onClick={() => onSearchBranch(topBranch.branch)} title={`Filter search by branch ${topBranch.branch}`}>
          <small>TOP BRANCH</small>
          <strong style={{ fontSize: '28px', lineHeight: 1.2 }}>{topBranch.branch}</strong>
          <span className="stats-subtext">{topBranch.total} applicants ({topBranch.percentage}%)</span>
        </div>
      </div>

      {/* View Switcher & Toggle */}
      <div className="metrics-topbar">
        <div className="metrics-tabs">
          <button
            type="button"
            className={'metrics-tab' + (activeTab === 'all' ? ' active' : '')}
            onClick={() => { setActiveTab('all'); setCollapsed(false); }}
          >
            <BarChart3 size={15}/> All Analytics
          </button>
          <button
            type="button"
            className={'metrics-tab' + (activeTab === 'departments' ? ' active' : '')}
            onClick={() => { setActiveTab('departments'); setCollapsed(false); }}
          >
            <Layers size={15}/> Department Breakdown ({deptConfigs.length})
          </button>
          <button
            type="button"
            className={'metrics-tab' + (activeTab === 'timeline' ? ' active' : '')}
            onClick={() => { setActiveTab('timeline'); setCollapsed(false); }}
          >
            <Calendar size={15}/> Daily Timeline ({timeline.length}d)
          </button>
          <button
            type="button"
            className={'metrics-tab' + (activeTab === 'demographics' ? ' active' : '')}
            onClick={() => { setActiveTab('demographics'); setCollapsed(false); }}
          >
            <GraduationCap size={15}/> Year & Branch Demographics
          </button>
        </div>
        <button
          type="button"
          className="metrics-toggle-btn"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <><ChevronDown size={14}/> Show Visual Metrics</> : <><ChevronUp size={14}/> Hide Visual Metrics</>}
        </button>
      </div>

      {!collapsed && (
        <div className="metrics-grid">
          {/* Department Breakdown */}
          {(activeTab === 'all' || activeTab === 'departments') && (
            <div className={'metric-card' + (activeTab === 'departments' ? ' full-width' : '')}>
              <div className="metric-card-head">
                <div className="metric-card-title">
                  <Layers size={18}/>
                  <div>
                    <h3>Department Breakdown</h3>
                    <p className="metric-card-sub">PI approved, submitted and draft counts per track · click to filter</p>
                  </div>
                </div>
                {selectedTrack !== 'all' ? (
                  <button type="button" className="link-btn" onClick={() => onSelectTrack('all')}>Clear track filter</button>
                ) : (
                  <span className="metric-card-badge">{deptStats.filter(d => d.total > 0).length} with selections</span>
                )}
              </div>

              <div className="timeline-legend" style={{ marginBottom: 14 }}>
                <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#38bdf8' }}/><span>PI Approved</span></div>
                <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#baf263' }}/><span>Submitted (not PI approved)</span></div>
                <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#3c6b45' }}/><span>Draft (not PI approved)</span></div>
              </div>
              <div className="dept-metric-list">
                {deptStats.map(d => {
                  const isSelected = selectedTrack === d.id;
                  return (
                    <div
                      key={d.id}
                      className={'dept-metric-item' + (isSelected ? ' active' : '')}
                      onClick={() => onSelectTrack(isSelected ? 'all' : d.id)}
                      title={`Click to filter entries by ${d.name}`}
                    >
                      <div className="dept-metric-header">
                        <div className="dept-metric-title">
                          <span className="dept-color-pip" style={{ backgroundColor: d.color }}/>
                          <span className="dept-metric-name">{d.name}</span>
                          <span className="dept-metric-cat">{d.category}</span>
                        </div>
                        <div className="dept-metric-nums">
                          <span className="dept-metric-total">{d.total}</span>
                          <span className="dept-metric-split">({d.piApproved} PI · {d.submitted} submitted · {d.draft} drafts)</span>
                        </div>
                      </div>
                      <div className="metric-progress-track">
                        <div className="metric-progress-fill-pi" style={{ width: `${(d.piApproved / maxDeptTotal) * 100}%` }} title={`${d.piApproved} PI approved`}/>
                        <div className="metric-progress-fill-submitted" style={{ width: `${(d.submitted / maxDeptTotal) * 100}%` }} title={`${d.submitted} submitted (not PI approved)`}/>
                        <div className="metric-progress-fill-draft" style={{ width: `${(d.draft / maxDeptTotal) * 100}%` }} title={`${d.draft} drafts (not PI approved)`}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timeline Chart */}
          {(activeTab === 'all' || activeTab === 'timeline') && (
            <div className={'metric-card' + (activeTab === 'timeline' ? ' full-width' : '')}>
              <div className="metric-card-head">
                <div className="metric-card-title">
                  <TrendingUp size={18}/>
                  <div>
                    <h3>Submission Timeline</h3>
                    <p className="metric-card-sub">Daily applicant activity in IST; PI approvals are grouped by the applicant activity date, not the approval date.</p>
                  </div>
                </div>
                {peakDay && peakDay.total > 0 && (
                  <span className="metric-card-badge">Peak activity: {peakDay.label} ({peakDay.total})</span>
                )}
              </div>

              {timeline.length === 0 ? (
                <p className="empty" style={{ padding: '30px' }}>No dated activity recorded yet.</p>
              ) : (
                <>
                  <div className="timeline-legend">
                    <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#38bdf8' }}/><span>PI Approved</span></div>
                    <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#baf263' }}/><span>Submitted (not PI approved)</span></div>
                    <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#39613e' }}/><span>Draft (not PI approved)</span></div>
                  </div>

                  <div className="timeline-chart-wrap">
                    <svg viewBox="0 0 540 160" width="100%" height="160" style={{ overflow: 'visible' }}>
                      {/* Grid lines */}
                      {[0, 0.33, 0.66, 1].map((pct, idx) => {
                        const y = 25 + 105 * (1 - pct);
                        const val = Math.round(maxTimelineTotal * pct);
                        return (
                          <g key={idx}>
                            <line x1="38" y1={y} x2="525" y2={y} stroke="#1f3724" strokeDasharray="3 3"/>
                            <text x="32" y={y + 4} textAnchor="end" fill="#69826e" fontSize="10" fontFamily="'DM Mono', monospace">{val}</text>
                          </g>
                        );
                      })}

                      {/* Baseline */}
                      <line x1="38" y1="130" x2="525" y2="130" stroke="#2c4d32"/>

                      {/* Bars */}
                      {timeline.map((d, i) => {
                        const plotW = 485;
                        const stepW = plotW / timeline.length;
                        const barW = Math.min(32, Math.max(8, stepW * 0.58));
                        const cx = 40 + (i + 0.5) * stepW;
                        const totalH = (d.total / maxTimelineTotal) * 105;
                        const piApprovedH = (d.piApproved / maxTimelineTotal) * 105;
                        const submittedH = (d.submitted / maxTimelineTotal) * 105;
                        const draftH = (d.drafts / maxTimelineTotal) * 105;
                        const yBase = 130;
                        const isHovered = hoveredDay?.dateKey === d.dateKey;

                        return (
                          <g
                            key={d.dateKey}
                            onMouseEnter={() => setHoveredDay(d)}
                            onMouseLeave={() => setHoveredDay(null)}
                            style={{ cursor: 'pointer' }}
                          >
                            <rect x={cx - stepW / 2} y="15" width={stepW} height="130" fill="transparent"/>

                            {draftH > 0 && (
                              <rect
                                x={cx - barW / 2}
                                y={yBase - draftH}
                                width={barW}
                                height={draftH}
                                fill={isHovered ? '#4e8255' : '#39613e'}
                                rx={piApprovedH === 0 && submittedH === 0 ? 3 : 0}
                              />
                            )}

                            {submittedH > 0 && (
                              <rect
                                x={cx - barW / 2}
                                y={yBase - draftH - submittedH}
                                width={barW}
                                height={submittedH}
                                fill={isHovered ? '#d4ffa3' : '#baf263'}
                                rx={piApprovedH === 0 ? 3 : 0}
                              />
                            )}

                            {piApprovedH > 0 && (
                              <rect
                                x={cx - barW / 2}
                                y={yBase - draftH - submittedH - piApprovedH}
                                width={barW}
                                height={piApprovedH}
                                fill={isHovered ? '#7dd3fc' : '#38bdf8'}
                                rx={3}
                              />
                            )}

                            {totalH > 0 && (
                              <text
                                x={cx}
                                y={yBase - totalH - 4}
                                textAnchor="middle"
                                fill={isHovered ? '#baf263' : '#a8bda9'}
                                fontSize="10"
                                fontWeight="700"
                                fontFamily="'Space Grotesk', sans-serif"
                              >
                                {d.total}
                              </text>
                            )}

                            <text
                              x={cx}
                              y="146"
                              textAnchor="middle"
                              fill={isHovered ? '#baf263' : '#7f9883'}
                              fontSize={timeline.length > 12 ? '9' : '10'}
                              fontFamily="'DM Sans', sans-serif"
                            >
                              {d.label}
                            </text>
                          </g>
                        );
                      })}
                    </svg>

                    {hoveredDay && (
                      <div className="timeline-active-info">
                        <span><strong>{hoveredDay.label}</strong>: {hoveredDay.total} applicants by activity date</span>
                        <span>{hoveredDay.piApproved} PI approved · {hoveredDay.submitted} submitted · {hoveredDay.drafts} drafts</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Academic Year Stats */}
          {(activeTab === 'all' || activeTab === 'demographics') && (
            <div className={'metric-card' + (activeTab === 'demographics' ? ' full-width' : '')}>
              <div className="metric-card-head">
                <div className="metric-card-title">
                  <GraduationCap size={18}/>
                  <div>
                    <h3>Academic Year Statistics</h3>
                    <p className="metric-card-sub">Distribution across college study years · click to filter</p>
                  </div>
                </div>
                {selectedYear !== 'all' ? (
                  <button type="button" className="link-btn" onClick={() => onFilterYear('all')}>Clear year filter</button>
                ) : (
                  <span className="metric-card-badge">4 Cohorts</span>
                )}
              </div>

              <div className="year-grid">
                {yearStats.map(y => (
                  <div
                    key={y.key}
                    className={'year-card' + (selectedYear === y.key ? ' active' : '')}
                    onClick={() => onFilterYear(selectedYear === y.key ? 'all' : y.key)}
                    title={`Click to filter entries for ${y.label}`}
                  >
                    <div className="year-card-top">
                      <div>
                        <div className="year-card-label">{y.label}</div>
                        <small style={{ color: '#7a947f', fontSize: 10, letterSpacing: 0.5 }}>{y.sub}</small>
                      </div>
                      <div className="year-card-count">{y.total}</div>
                    </div>
                    <div className="metric-progress-track">
                      <div className="metric-progress-fill-pi" style={{ width: `${y.total > 0 ? (y.piApproved / y.total) * 100 : 0}%` }} title={`${y.piApproved} PI approved`}/>
                      <div className="metric-progress-fill-submitted" style={{ width: `${y.total > 0 ? (y.submitted / y.total) * 100 : 0}%` }} title={`${y.submitted} submitted (not PI approved)`}/>
                      <div className="metric-progress-fill-draft" style={{ width: `${y.total > 0 ? (y.drafts / y.total) * 100 : 0}%` }} title={`${y.drafts} drafts (not PI approved)`}/>
                    </div>
                    <div className="year-card-details">
                      <span>{y.percentage}% of pool</span>
                      <span>{y.piApproved} PI · {y.submitted} sub · {y.drafts} draft</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Cross-track insights */}
              <div className="insights-row">
                <div className="insight-pill">
                  <strong>{singleTrack} ({total > 0 ? Math.round((singleTrack / total) * 100) : 0}%)</strong>
                  <span>Single Track</span>
                </div>
                <div className="insight-pill">
                  <strong>{twoTracks} ({total > 0 ? Math.round((twoTracks / total) * 100) : 0}%)</strong>
                  <span>2 Tracks Picked</span>
                </div>
                <div className="insight-pill">
                  <strong>{threePlusTracks} ({total > 0 ? Math.round((threePlusTracks / total) * 100) : 0}%)</strong>
                  <span>3+ Tracks</span>
                </div>
              </div>
            </div>
          )}

          {/* College Branch Stats */}
          {(activeTab === 'all' || activeTab === 'demographics') && (
            <div className={'metric-card' + (activeTab === 'demographics' ? ' full-width' : '')}>
              <div className="metric-card-head">
                <div className="metric-card-title">
                  <Users size={18}/>
                  <div>
                    <h3>College Branch Statistics</h3>
                    <p className="metric-card-sub">Applicants by engineering branch · click to filter</p>
                  </div>
                </div>
                <span className="metric-card-badge">{branchStats.length} branches</span>
              </div>

              <div className="timeline-legend" style={{ marginBottom: 12 }}>
                <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#38bdf8' }}/><span>PI Approved</span></div>
                <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#baf263' }}/><span>Submitted</span></div>
                <div className="timeline-legend-item"><span className="timeline-legend-color" style={{ background: '#3c6b45' }}/><span>Draft</span></div>
              </div>
              <div className="branch-list">
                {branchStats.slice(0, 8).map(b => (
                  <div
                    key={b.branch}
                    className="branch-row"
                    onClick={() => onSearchBranch(b.branch)}
                    title={`Filter search by "${b.branch}"`}
                  >
                    <span className="branch-name">{b.branch}</span>
                    <div className="branch-bar-wrap">
                      <div className="branch-bar-fill-pi" style={{ width: `${(b.piApproved / maxBranchTotal) * 100}%` }} title={`${b.piApproved} PI approved`}/>
                      <div className="branch-bar-fill-submitted" style={{ width: `${(b.submitted / maxBranchTotal) * 100}%` }} title={`${b.submitted} submitted`}/>
                      <div className="branch-bar-fill-draft" style={{ width: `${(b.drafts / maxBranchTotal) * 100}%` }} title={`${b.drafts} drafts`}/>
                    </div>
                    <span className="branch-count">{b.total} <small style={{ color: '#38bdf8', fontSize: 10 }}>({b.piApproved} PI)</small></span>
                  </div>
                ))}
              </div>

              {otherSocietiesCount > 0 && (
                <p className="hint" style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #1c3522', color: '#91aa95', fontSize: 12 }}>
                  💡 <strong>{otherSocietiesCount} applicants ({total > 0 ? Math.round((otherSocietiesCount / total) * 100) : 0}%)</strong> report active membership in other college societies.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Department Admin Notes ──────────────────────────────────────────────────
function DeptAdminNotes({
  enrollment,
  deptId,
  initialNotes = '',
  onNotesSaved,
}: {
  enrollment: string;
  deptId: string;
  initialNotes?: string;
  onNotesSaved: (deptId: string, notes: string) => void;
}) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const lastSaved = useRef(initialNotes || '');

  useEffect(() => {
    setNotes(initialNotes || '');
    lastSaved.current = initialNotes || '';
    setStatus('idle');
  }, [initialNotes, enrollment, deptId]);

  const saveNotes = useCallback(async (val: string) => {
    if (val === lastSaved.current) return;
    setStatus('saving');
    try {
      await api<{ ok: boolean; adminNotes: Record<string, string> }>(
        `/admin/submissions/${encodeURIComponent(enrollment)}/notes`,
        {
          method: 'PUT',
          body: JSON.stringify({ deptId, notes: val }),
        }
      );
      lastSaved.current = val;
      setStatus('saved');
      onNotesSaved(deptId, val);
      setTimeout(() => {
        setStatus(curr => (curr === 'saved' ? 'idle' : curr));
      }, 2000);
    } catch {
      setStatus('error');
    }
  }, [enrollment, deptId, onNotesSaved]);

  useEffect(() => {
    if (notes === lastSaved.current) return;
    const timer = setTimeout(() => {
      saveNotes(notes);
    }, 700);
    return () => clearTimeout(timer);
  }, [notes, saveNotes]);

  return (
    <div className="admin-notes-section">
      <div className="admin-notes-header">
        <label htmlFor={`notes-${deptId}`}>
          <Pencil size={12}/> Notes
        </label>
        <span className={'admin-notes-status ' + status}>
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && 'Saved ✓'}
          {status === 'error' && 'Failed to save notes'}
        </span>
      </div>
      <textarea
        id={`notes-${deptId}`}
        className="admin-notes-textarea"
        placeholder="Write admin notes for this task submission (autosaves)..."
        value={notes}
        onChange={e => {
          setNotes(e.target.value);
          setStatus('idle');
        }}
        onBlur={() => {
          if (notes !== lastSaved.current) {
            saveNotes(notes);
          }
        }}
        rows={2}
      />
    </div>
  );
}

// ── Admin ───────────────────────────────────────────────────────────────────
function Admin() {
  const [items, setItems] = useState<Submission[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState('all'); const [track, setTrack] = useState('all'); const [yearFilter, setYearFilter] = useState('all'); const [selected, setSelected] = useState<Submission | null>(null);
  const [exporting, setExporting] = useState(false);
  const [mutating, setMutating] = useState<'draft' | 'submitted' | 'delete' | null>(null);
  const [savingPiApproval, setSavingPiApproval] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  useEffect(() => { api<Submission[]>('/admin/submissions').then(setItems).catch(e => { if (e.message.includes('Sign in')) location.assign('/login'); else setError(e.message); }).finally(() => setLoading(false)); }, []);
  const visible = items.filter(s => {
    const statusMatch = status === 'all' || s.status === status;
    const trackMatch = track === 'all' || s.selected.includes(track);
    const candidateYear = s.student.year || yearForSemester(s.student.semester) || '';
    const yearMatch =
      yearFilter === 'all' ||
      candidateYear.includes(yearFilter) ||
      s.student.semester === String(Number(yearFilter) * 2 - 1) ||
      s.student.semester === String(Number(yearFilter) * 2);
    const queryMatch = [
      s.student.name || '',
      s.student.enrollment || '',
      s.student.email || '',
      s.student.academicBranch || '',
    ].some(v => v.toLowerCase().includes(query.toLowerCase()));

    return statusMatch && trackMatch && yearMatch && queryMatch;
  });

  const selectedIdx = selected ? visible.findIndex(s => s.student.enrollment === selected.student.enrollment) : -1;
  const hasPrev = selectedIdx > 0;
  const hasNext = selectedIdx >= 0 && selectedIdx < visible.length - 1;

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.key === 'ArrowLeft' && hasPrev && !mutating) {
        e.preventDefault();
        setSelected(visible[selectedIdx - 1]);
        setActionError('');
      } else if (e.key === 'ArrowRight' && hasNext && !mutating) {
        e.preventDefault();
        setSelected(visible[selectedIdx + 1]);
        setActionError('');
      } else if (e.key === 'Escape' && !mutating) {
        e.preventDefault();
        setSelected(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, visible, selectedIdx, hasPrev, hasNext, mutating]);

  async function changeSubmission(action: 'draft' | 'submitted' | 'delete') {
    if (!selected || mutating) return;
    const entry = selected;
    const label = `${entry.student.name} (${entry.student.enrollment})`;
    const message = action === 'delete'
      ? `Permanently delete the entry for ${label}? All saved profile details and answers will be removed. This cannot be undone.`
      : action === 'submitted'
      ? `Move the draft for ${label} to submitted? This will mark their application as officially submitted.`
      : `Move the submission for ${label} back to draft? Their answers will be preserved and they can resume editing. Resubmission still requires an open submission window.`;
    if (!window.confirm(message)) return;
    setMutating(action);
    setActionError('');
    try {
      const result = await api<Submission>('/admin/submissions', {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        body: JSON.stringify({
          enrollment: entry.student.enrollment,
          ...(action === 'draft' || action === 'submitted' ? { status: action } : {}),
        }),
      });
      if (action === 'delete') {
        setItems(current => current.filter(s => s.student.enrollment !== entry.student.enrollment));
        setSelected(null);
      } else {
        setItems(current => [result, ...current.filter(s => s.student.enrollment !== entry.student.enrollment)]);
        setSelected(result);
      }
    } catch (e) {
      if ((e as any).status === 401) location.assign('/login');
      else setActionError((e as Error).message);
    } finally { setMutating(null); }
  }

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

  async function setPiApproval(deptId: string, approved: boolean) {
    if (!selected) return;
    const currentVal = Boolean(selected.piApproved?.[deptId]);
    if (currentVal === approved) return;
    setSavingPiApproval(deptId);
    try {
      await api<{ ok: boolean; piApproved: Record<string, boolean> }>(
        `/admin/submissions/${encodeURIComponent(selected.student.enrollment)}/pi-approval`,
        {
          method: 'PUT',
          body: JSON.stringify({ deptId, approved }),
        }
      );
      const updatedSub: Submission = {
        ...selected,
        piApproved: { ...(selected.piApproved || {}), [deptId]: approved },
      };
      setSelected(updatedSub);
      setItems(curr =>
        curr.map(item =>
          item.student.enrollment === selected.student.enrollment ? updatedSub : item
        )
      );
    } catch (e) {
      setActionError((e as Error).message || 'Failed to update PI approval.');
    } finally {
      setSavingPiApproval(null);
    }
  }

  function exportSingleJSON() {
    if (!selected) return;
    const jsonStr = JSON.stringify(selected, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const id = selected.student.enrollment || 'submission';
    a.download = `submission-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return <Shell admin><main className="admin-layout"><div className="admin-head"><div><p className="eyebrow">BYTE / RECRUITMENT DESK</p><h1>Submissions<span className="accent-period">.</span></h1><p>All the ideas and effort coming your way, in one place.</p></div><div className="admin-actions"><button className="export-btn" onClick={exportCSV} disabled={exporting}><Download size={16}/> {exporting ? 'Exporting…' : 'Export CSV'}</button><button className="export-btn secondary" onClick={exportJSON} disabled={exporting}><Download size={16}/> Export JSON</button><button className="logout" onClick={async () => { await post('/admin/logout'); location.assign('/login'); }}><LogOut size={16}/> Sign out</button></div></div>
  <AdminMetrics
    items={items}
    selectedTrack={track}
    onSelectTrack={setTrack}
    selectedYear={yearFilter}
    onFilterYear={setYearFilter}
    onSearchBranch={setQuery}
    onFilterStatus={setStatus}
  />
  <div className="admin-content"><div className="admin-section-heading"><h2>All entries</h2><span>{visible.length} results</span></div><div className="filters"><label className="search-field"><Search size={18}/><span className="sr-only">Search entries</span><input placeholder="Search name, enrollment, email..." value={query} onChange={e => setQuery(e.target.value)}/></label><label><span className="sr-only">Filter by status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="draft">Drafts</option></select></label><label><span className="sr-only">Filter by department</span><select value={track} onChange={e => setTrack(e.target.value)}><option value="all">All departments</option>{deptConfigs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label><span className="sr-only">Filter by year</span><select value={yearFilter} onChange={e => setYearFilter(e.target.value)}><option value="all">All years</option><option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option><option value="4">4th Year</option></select></label></div>{loading ? <p className="empty">Loading entries…</p> : error ? <p className="error-banner" role="alert">{error}</p> : !visible.length ? <p className="empty">No entries match your filters yet.</p> : <div className="entries"><div className="table-head"><span>STUDENT</span><span>TRACKS</span><span>STATUS</span><span>LAST UPDATED</span><span/></div>{visible.map(s => <button className="entry" key={s.student.enrollment} onClick={() => { setSelected(s); setActionError(''); }}><span className="entry-person"><strong>{s.student.name}</strong><small>{s.student.enrollment}{s.student.academicBranch ? ` · ${s.student.academicBranch}` : ''}</small></span><span className="entry-tracks">{s.selected.length ? s.selected.map(id => deptConfigs.find(d => d.id === id)?.name || tracks.find(t => t.id === id)?.name || id).join(', ') : 'Not selected yet'}</span><span><span className={'badge ' + s.status}>{s.status}</span></span><span className="date">{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span><ArrowUpRight size={17}/></button>)}</div>}</div></main>
  {selected && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !mutating) setSelected(null); }}><section className="detail" role="dialog" aria-modal="true" aria-label="Submission details"><div className="detail-top"><span className="eyebrow">SUBMISSION DETAILS</span><button onClick={() => setSelected(null)} disabled={!!mutating} aria-label="Close details">✕</button></div>
  <div className="detail-layout">
    <aside className="detail-sidebar">
      <div className="detail-nav-row">
        <span className="detail-nav-counter">
          {selectedIdx >= 0 ? `${selectedIdx + 1} of ${visible.length}` : `${visible.length} entries`}
        </span>
        <div className="detail-nav-buttons">
          <button
            type="button"
            className="detail-nav-btn"
            disabled={!hasPrev || !!mutating}
            onClick={() => {
              if (hasPrev) {
                setSelected(visible[selectedIdx - 1]);
                setActionError('');
              }
            }}
            title="Previous candidate (Left arrow)"
          >
            <ChevronLeft size={15}/> Prev
          </button>
          <button
            type="button"
            className="detail-nav-btn"
            disabled={!hasNext || !!mutating}
            onClick={() => {
              if (hasNext) {
                setSelected(visible[selectedIdx + 1]);
                setActionError('');
              }
            }}
            title="Next candidate (Right arrow)"
          >
            Next <ChevronRight size={15}/>
          </button>
        </div>
      </div>
      <h2>{selected.student.name}</h2>
      <span className={'badge ' + selected.status}>{selected.status}</span>
      <div className="detail-actions" aria-busy={!!mutating}>
        {selected.status === 'submitted' ? (
          <button className="export-btn" disabled={!!mutating} onClick={() => changeSubmission('draft')}>
            <Pencil size={16}/> {mutating === 'draft' ? 'Moving to draft…' : 'Move to draft'}
          </button>
        ) : (
          <button className="export-btn" disabled={!!mutating} onClick={() => changeSubmission('submitted')}>
            <Check size={16}/> {mutating === 'submitted' ? 'Moving to submission…' : 'Move to submission'}
          </button>
        )}
        <button type="button" className="export-btn" onClick={exportSingleJSON} title="Download candidate submission as JSON">
          <Download size={16}/> Export JSON
        </button>
        <button className="export-btn danger" disabled={!!mutating} onClick={() => changeSubmission('delete')}>
          <Trash2 size={16}/> {mutating === 'delete' ? 'Deleting…' : 'Delete entry'}
        </button>
      </div>
      {actionError && <p className="error-banner" role="alert">{actionError}</p>}
      <div className="detail-facts"><p><span>Enrollment</span>{selected.student.enrollment}</p><p><span>Email</span>{selected.student.email || '—'}</p><p><span>Phone</span>{selected.student.phone || '—'}</p><p><span>Branch</span>{selected.student.academicBranch || '—'}</p><p><span>Year / Sem</span>{selected.student.year ? `Year ${selected.student.year}, Sem ${selected.student.semester || '—'}` : '—'}</p><p><span>Societies</span>{selected.student.inOtherSocieties && (selected.student.societies || []).length > 0 ? (selected.student.societies || []).join(', ') : 'None'}</p><p><span>Instagram</span>{selected.student.instagram || '—'}</p><p><span>Twitter/X</span>{selected.student.twitter || '—'}</p><p><span>Discord</span>{selected.student.discord || '—'}</p><p><span>Updated</span>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '—'}</p></div>
    </aside>
    <div className="detail-main">
      <h3>Department submissions</h3>{!selected.selected.length && <p className="muted">No departments selected yet.</p>}{selected.selected.map(deptId => {
    const config = getDeptConfig(deptId);
    const deptAns = (selected.deptAnswers || {})[deptId] || {};
    const legacyAns = selected.answers?.[deptId] || {};
    const selectedTasks = (selected.deptSelected || {})[deptId] || [];
    if (config) {
      const isApproved = Boolean(selected.piApproved?.[config.id]);
      return <div className="detail-track" key={config.id}>
        <div className="detail-track-top">
          <h4>{config.name}</h4>
          <div className="pi-approval-control">
            <span className="pi-approval-label">PI Approved:</span>
            <div className="pi-approval-buttons" role="group" aria-label={`PI approval for ${config.name}`}>
              <button
                type="button"
                className={'pi-btn tick' + (isApproved ? ' active' : '')}
                onClick={() => setPiApproval(config.id, true)}
                disabled={savingPiApproval === config.id}
                title="Mark PI Approved (Tick)"
              >
                <Check size={14}/> {isApproved ? 'Approved' : ''}
              </button>
              <button
                type="button"
                className={'pi-btn cross' + (!isApproved ? ' active' : '')}
                onClick={() => setPiApproval(config.id, false)}
                disabled={savingPiApproval === config.id}
                title="Mark Not Approved (Cross)"
              >
                <X size={14}/> {!isApproved ? 'Not Approved' : ''}
              </button>
            </div>
          </div>
        </div>
        {config.globalFields.map(f => {
          const val = deptAns[f.key] !== undefined ? deptAns[f.key] : legacyAns[f.key];
          if (!val) return null;
          return <div key={f.key}><small>{f.label}</small><p>{
            f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)} <ArrowUpRight size={13}/></a> :
            f.type === 'url-list' && Array.isArray(val) ? val.filter(v => typeof v === 'string' && v.trim()).map((u, i) => (
              <span key={i} style={{display:'block'}}><a href={u} target="_blank" rel="noreferrer">{u} <ArrowUpRight size={13}/></a></span>
            )) :
            String(val)
          }</p></div>;
        })}
        {config.globalCheckboxes.filter(cb => deptAns[cb.key]).map(cb => <p key={cb.key} style={{fontSize:12,color:'#baf263',margin:'4px 0'}}>✓ {formatCheckboxLabel(config.id, cb.key, cb.label, selected.student.name, selected.student.academicBranch)}</p>)}
        {config.tasks.filter(t => !config.taskPicker || selectedTasks.includes(t.id)).filter(t => isTaskAttempted(t, deptAns)).map(task => {
          const studentYear = parseInt(selected.student.year, 10) || 0;
          const effTag = getEffectiveTaskTag(task, config.id, studentYear);
          return <div key={task.id} style={{marginTop:14,paddingLeft:12,borderLeft:'2px solid #3b543f'}}>
            <p style={{fontWeight:600,fontSize:13,margin:'6px 0',color:'#dce8dc'}}>{task.name} <span className={'task-tag tag-' + effTag.toLowerCase()}>{effTag}</span></p>
            {task.fields.filter(f => f.type !== 'toggle' && deptAns[f.key]).map(f => {
              const val = deptAns[f.key];
              return <div key={f.key}><small>{f.label}</small><p>{
                f.type === 'url' ? <a href={String(val)} target="_blank" rel="noreferrer">{String(val)} <ArrowUpRight size={13}/></a> :
                f.type === 'url-list' && Array.isArray(val) ? val.filter(v => typeof v === 'string' && v.trim()).map((u, i) => (
                  <span key={i} style={{display:'block'}}><a href={u} target="_blank" rel="noreferrer">{u} <ArrowUpRight size={13}/></a></span>
                )) :
                f.type === 'file' ? `${String(val).trim().split('\n').length} lines` :
                String(val)
              }</p></div>;
            })}
            {task.checkboxes.filter(cb => deptAns[cb.key]).map(cb => <p key={cb.key} style={{fontSize:12,color:'#baf263',margin:'4px 0'}}>✓ {formatCheckboxLabel(config.id, cb.key, cb.label, selected.student.name, selected.student.academicBranch)}</p>)}
          </div>;
        })}
        <DeptAdminNotes
          enrollment={selected.student.enrollment}
          deptId={config.id}
          initialNotes={selected.adminNotes?.[config.id] || ''}
          onNotesSaved={(dId, newNotes) => {
            const updatedSub: Submission = {
              ...selected,
              adminNotes: { ...(selected.adminNotes || {}), [dId]: newNotes },
            };
            setSelected(updatedSub);
            setItems(curr => curr.map(item => item.student.enrollment === selected.student.enrollment ? updatedSub : item));
          }}
        />
      </div>;
    }
    const track = tracks.find(t => t.id === deptId);
    if (!track) return null;
    const isTrackApproved = Boolean(selected.piApproved?.[track.id]);
    return <div className="detail-track" key={track.id}>
      <div className="detail-track-top">
        <h4>{track.name}</h4>
        <div className="pi-approval-control">
          <span className="pi-approval-label">PI Approved:</span>
          <div className="pi-approval-buttons" role="group" aria-label={`PI approval for ${track.name}`}>
            <button
              type="button"
              className={'pi-btn tick' + (isTrackApproved ? ' active' : '')}
              onClick={() => setPiApproval(track.id, true)}
              disabled={savingPiApproval === track.id}
              title="Mark PI Approved (Tick)"
            >
              <Check size={14}/> {isTrackApproved ? 'Approved' : ''}
            </button>
            <button
              type="button"
              className={'pi-btn cross' + (!isTrackApproved ? ' active' : '')}
              onClick={() => setPiApproval(track.id, false)}
              disabled={savingPiApproval === track.id}
              title="Mark Not Approved (Cross)"
            >
              <X size={14}/> {!isTrackApproved ? 'Not Approved' : ''}
            </button>
          </div>
        </div>
      </div>
      {track.fields.map(f => <div key={f.key}><small>{f.label}</small><p>{legacyAns[f.key] ? (f.type === 'url' ? <a href={legacyAns[f.key]} target="_blank" rel="noreferrer">{legacyAns[f.key]} <ArrowUpRight size={13}/></a> : legacyAns[f.key]) : '—'}</p></div>)}
      <DeptAdminNotes
        enrollment={selected.student.enrollment}
        deptId={track.id}
        initialNotes={selected.adminNotes?.[track.id] || ''}
        onNotesSaved={(dId, newNotes) => {
          const updatedSub: Submission = {
            ...selected,
            adminNotes: { ...(selected.adminNotes || {}), [dId]: newNotes },
          };
          setSelected(updatedSub);
          setItems(curr => curr.map(item => item.student.enrollment === selected.student.enrollment ? updatedSub : item));
        }}
      />
    </div>;
  })}</div></div></section></div>}</Shell>;
}

createRoot(document.getElementById('root')!).render(location.pathname === '/login' ? <Login/> : location.pathname === '/admin' ? <Admin/> : <Wizard/>);
