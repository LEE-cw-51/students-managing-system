'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useDirty } from '@/components/ui/useDirty';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import Field, { focusInvalid } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { addDays, formatDate, shortDate } from '@/lib/format';

export const FOLLOW_QUICK = [[7, '1주 뒤'], [14, '2주 뒤'], [30, '한 달 뒤']];
export const followDefault = (kind) => (kind === '학부모' ? '학부모 후속 연락' : '학생 후속 상담');

/** `note` edits a saved note; `draft` prefills a new one. */
export function NoteForm({ studentId, note, draft, onClose, onSaved }) {
  const { today } = useBoot();
  const toast = useToast();
  const start = note || draft;
  const [form, setForm] = useState(() => ({
    kind: '학부모', counsel_date: today, title: '', content: '', follow_up_date: '', follow_up_title: '', ...(start || {})
  }));
  const [follow, setFollow] = useState(!!(start && start.follow_up_date));
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState({});
  const dirty = useDirty({ form, follow });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setInvalid((v) => ({ ...v, [key]: '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const problems = {};
    if (!form.content.trim()) problems.content = '상담 내용을 입력해 주세요.';
    if (follow && !form.follow_up_date) problems.follow_up_date = '후속 조치 날짜를 입력해 주세요.';
    setInvalid(problems);
    if (Object.keys(problems).length) return focusInvalid(e.currentTarget);
    setSaving(true);
    setError('');
    try {
      await api('saveCounselingNote', {
        note_id: form.note_id, student_id: studentId, kind: form.kind, counsel_date: form.counsel_date,
        title: form.title, content: form.content,
        follow_up_date: follow ? form.follow_up_date : '', follow_up_title: follow ? form.follow_up_title : ''
      });
      toast(follow ? `상담일지를 저장하고 ${shortDate(form.follow_up_date)} 할 일을 등록했습니다.` : '상담일지를 저장했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const quick = (days) => { setFollow(true); setForm((f) => ({ ...f, follow_up_date: addDays(f.counsel_date || today, days) })); };

  return (
    <Modal title={note ? '상담일지 수정' : '상담일지 작성'} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="상담 대상">{() => (
            <div className="segmented" role="group" aria-label="상담 대상">
              {['학부모', '학생'].map((k) => <button key={k} type="button" aria-pressed={form.kind === k} onClick={() => setForm((f) => ({ ...f, kind: k }))}>{k}</button>)}
            </div>
          )}</Field>
          <Field label="상담일">{(id) => <input id={id} type="date" value={form.counsel_date} onChange={set('counsel_date')} />}</Field>
          <Field label="제목" wide>{(id) => <input id={id} value={form.title} onChange={set('title')} placeholder="예: 숙제 이행 관련 통화" />}</Field>
          <Field label="내용" wide error={invalid.content}>{(id) => <textarea id={id} rows={5} value={form.content} aria-invalid={!!invalid.content} onChange={set('content')} />}</Field>
        </div>
        <fieldset className="follow-box">
          <legend>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} style={{ width: 'auto', minHeight: 0 }} />
              후속 조치 (그날 ‘오늘’ 화면 할 일에 표시)
            </label>
          </legend>
          {follow ? (
            <div className="form-grid">
              <Field label="날짜" error={invalid.follow_up_date} hint={<span className="cluster">{FOLLOW_QUICK.map(([d, l]) => <button key={d} type="button" className="link-btn" onClick={() => quick(d)}>{l}</button>)}</span>}>
                {(id) => <input id={id} type="date" value={form.follow_up_date} aria-invalid={!!invalid.follow_up_date} onChange={set('follow_up_date')} />}
              </Field>
              <Field label="할 일">{(id) => <input id={id} value={form.follow_up_title} onChange={set('follow_up_title')} placeholder={followDefault(form.kind)} />}</Field>
            </div>
          ) : (
            <div className="cluster muted">빠르게 설정: {FOLLOW_QUICK.map(([d, l]) => <button key={d} type="button" className="link-btn" onClick={() => quick(d)}>{l}</button>)}</div>
          )}
        </fieldset>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <ModalCancel />
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}

const nameKey = (v) => v.replace(/\s+/g, '').toLowerCase();

/** Name search that resolves to one student id. */
function StudentPicker({ value, onChange, invalid, inputRef }) {
  const boot = useBoot();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const all = boot.search.students || [];
  const picked = value ? all.find((s) => s.id === value) : null;
  const q = nameKey(query);
  const matches = q && !picked
    ? all.filter((s) => nameKey(s.name).includes(q)).sort((a, b) => (a.status === '재원' ? 0 : 1) - (b.status === '재원' ? 0 : 1)).slice(0, 8)
    : [];
  const shown = open && matches.length > 0;
  const label = picked ? [picked.name, picked.grade].filter(Boolean).join(' · ') : '';
  const choose = (s) => { onChange(s.id); setQuery(''); setOpen(false); };
  const type = (v) => {
    if (picked) onChange('');
    setQuery(!picked ? v : v.startsWith(label) ? v.slice(label.length) : label.startsWith(v) ? '' : v);
    setActive(0);
    setOpen(true);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % matches.length); }
    else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setOpen(true); setActive((i) => (i - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter' && shown) { e.preventDefault(); choose(matches[active] || matches[0]); }
    else if (e.key === 'Escape' && shown) { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="student-picker">
      <input ref={inputRef} type="text" role="combobox" autoComplete="off" aria-label="학생 선택" aria-autocomplete="list"
        aria-expanded={shown} aria-controls={listId} aria-activedescendant={shown ? `${listId}-${active}` : undefined} aria-invalid={invalid || undefined}
        placeholder="학생 이름 검색" value={picked ? label : query} onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      {picked ? <button type="button" className="student-picker-clear" aria-label="학생 선택 지우기" onClick={() => { onChange(''); inputRef.current?.focus(); }}>✕</button> : null}
      <ul id={listId} role="listbox" aria-label="학생" className="student-picker-list" hidden={!shown}>
        {matches.map((s, i) => (
          <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(s)}>
            <strong>{s.name}</strong>
            <span className="muted">{[s.grade, s.school, s.classes.join(', ')].filter(Boolean).join(' · ')}</span>
            {s.status !== '재원' ? <span className="tag muted">{s.status}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Today's counseling note in one line of input; "자세히" carries it over to the full dialog. Without `studentId` a student picker comes first. */
export function QuickCounsel({ studentId, today, onSaved }) {
  const toast = useToast();
  const [picked, setPicked] = useState('');
  const [kind, setKind] = useState('학부모');
  const [content, setContent] = useState('');
  const [days, setDays] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);
  const pickerRef = useRef(null);
  const target = studentId || picked;
  const followDate = days ? addDays(today, days) : '';
  const reset = () => { setContent(''); setDays(0); setError(null); if (!studentId) setPicked(''); };

  const check = (form) => {
    if (!target) {
      setError({ at: 'student', message: '학생을 골라 주세요.' });
      pickerRef.current?.focus();
      return false;
    }
    if (form && !content.trim()) {
      setError({ at: 'content', message: '상담 내용을 입력해 주세요.' });
      form.querySelector('textarea').focus();
      return false;
    }
    return true;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!check(e.currentTarget)) return;
    setSaving(true);
    setError(null);
    try {
      await api('saveCounselingNote', {
        student_id: target, kind, counsel_date: today, title: '', content,
        follow_up_date: followDate, follow_up_title: followDate ? followDefault(kind) : ''
      });
      toast(followDate ? `상담일지를 저장하고 ${shortDate(followDate)} 할 일을 등록했습니다.` : '상담일지를 저장했습니다.');
      reset();
      onSaved();
    } catch (err) {
      setError({ at: '', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form className="sd-quick" onSubmit={submit} aria-label="상담 빠른 기록">
        <div className="cluster">
          {studentId ? null : <StudentPicker value={picked} inputRef={pickerRef} invalid={error?.at === 'student'} onChange={(id) => { setPicked(id); setError(null); }} />}
          <div className="segmented" role="group" aria-label="상담 대상">
            {['학부모', '학생'].map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}
          </div>
          <span className="muted">오늘 {shortDate(today)}</span>
        </div>
        <textarea rows={2} value={content} placeholder="상담 내용" aria-label="상담 내용" aria-invalid={error?.at === 'content'}
          onChange={(e) => { setContent(e.target.value); setError(null); }} />
        {error ? <div className="error-text" role="alert">{error.message}</div> : null}
        <div className="sd-quick-foot">
          <div className="cluster" role="group" aria-label="후속 조치">
            <span className="muted">후속</span>
            {FOLLOW_QUICK.map(([d, l]) => <button key={d} type="button" className="chip" aria-pressed={days === d} onClick={() => setDays(days === d ? 0 : d)}>{l}</button>)}
            {followDate ? <span className="muted">{shortDate(followDate)} · {followDefault(kind)}</span> : null}
          </div>
          <div className="cluster">
            <button type="button" className="btn secondary sm" onClick={() => { if (check()) setDetail({ kind, content, follow_up_date: followDate, follow_up_title: '' }); }}>자세히</button>
            <button type="submit" className="btn sm" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      </form>
      {detail ? <NoteForm studentId={target} draft={detail} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); reset(); onSaved(); }} /> : null}
    </>
  );
}

export function CopyButton({ text }) {
  const toast = useToast();
  return (
    <button type="button" className="btn secondary sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.', 'error'))}>복사</button>
  );
}

function MonthlyReports({ studentId }) {
  const state = useApi(() => api('getStudentReports', studentId), [studentId]);
  const [open, setOpen] = useState(null);
  return (
    <section className="card">
      <div className="card-head"><h2>월간 보고서</h2><Link className="btn secondary sm" href="/reports">보고서 화면</Link></div>
      <Async state={state}>
        {(d) => d.monthly.length ? (
          <ul className="sd-lines">
            {d.monthly.map((r) => (
              <li key={r.monthly_report_id} className="sd-report">
                <div className="split">
                  <button type="button" className="link-btn" aria-expanded={open === r.monthly_report_id}
                    onClick={() => setOpen(open === r.monthly_report_id ? null : r.monthly_report_id)}>{r.year}년 {r.month}월</button>
                  <span className="cluster"><span className={'tag ' + (r.status === '확정' ? 'ok' : 'muted')}>{r.status}</span><CopyButton text={r.report_text} /></span>
                </div>
                {open === r.monthly_report_id ? <pre className="report-text">{r.report_text}</pre> : null}
              </li>
            ))}
          </ul>
        ) : <EmptyState title="저장된 월간 보고서가 없습니다">보고서 화면에서 반 단위로 한 번에 만들 수 있습니다.</EmptyState>}
      </Async>
    </section>
  );
}

const UNDO_MS = 5000;
const FOLLOW_TAG = { 예정: 'amber', 완료: 'ok', 취소: 'muted' };

function followCancelNote(n) {
  if ('follow_up_status' in n) return n.follow_up_status === '예정' ? ' 연결된 후속 할 일도 취소됩니다.' : '';
  return n.follow_up_task_id ? ' 예정된 후속 할 일이 있으면 함께 취소됩니다.' : '';
}

/**
 * Notes are hidden right away; the delete is sent after the undo window closes, even if the view is left meanwhile.
 * `onDeleted(stillMounted)` runs after the delete went through.
 */
export function useNoteDelete(onDeleted) {
  const toast = useToast();
  const [pending, setPending] = useState([]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const remove = (n) => {
    let undone = false;
    const unhide = () => setPending((p) => p.filter((id) => id !== n.note_id));
    setPending((p) => (p.includes(n.note_id) ? p : [...p, n.note_id]));
    toast(`${formatDate(n.counsel_date)} 상담일지를 ${UNDO_MS / 1000}초 뒤 삭제합니다.${followCancelNote(n)}`, 'ok', {
      duration: UNDO_MS,
      action: { label: '되돌리기', onClick: () => { undone = true; unhide(); } }
    });
    setTimeout(async () => {
      if (undone) return;
      try {
        await api('deleteCounselingNote', n.note_id);
        toast(`${formatDate(n.counsel_date)} 상담일지를 삭제했습니다.`);
        onDeleted(mounted.current);
      } catch (err) {
        if (mounted.current) unhide();
        toast(`상담일지를 삭제하지 못해 다시 표시했습니다. ${err.message}`, 'error');
      }
    }, UNDO_MS);
  };
  return { pending, remove };
}

export default function CounselingTab({ studentId, onChanged }) {
  const toast = useToast();
  const { today } = useBoot();
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState(null);
  const state = useApi(() => api('getCounselingNotes', studentId), [studentId]);
  const reload = () => { state.reload(); onChanged(); };
  const { pending, remove } = useNoteDelete((stillMounted) => (stillMounted ? reload() : onChanged()));
  const complete = async (n) => {
    try {
      await api('updateTaskStatus', n.follow_up_task_id, '완료');
      toast('후속 조치를 완료했습니다.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="sd-counsel">
      <section className="card">
        <div className="card-head">
          <div className="segmented" role="group" aria-label="상담 대상">
            {[['', '전체'], ['학부모', '학부모'], ['학생', '학생']].map(([v, l]) => <button key={l} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>)}
          </div>
          <button type="button" className="btn" onClick={() => setEditing({})}>상담일지 작성</button>
        </div>
        <Async state={state}>
          {(notes) => {
            const list = notes.filter((n) => !pending.includes(n.note_id) && (!kind || n.kind === kind));
            return list.length ? (
              <div className="sd-counsel-list">
                {list.map((n) => (
                  <article key={n.note_id} className="sd-counsel-item">
                    <div className="card-head">
                      <div className="cluster">
                        <span className={'tag ' + (n.kind === '학부모' ? '' : 'muted')}>{n.kind}</span>
                        <strong>{formatDate(n.counsel_date)}</strong>
                        {n.title ? <span>{n.title}</span> : null}
                      </div>
                      <div className="cluster">
                        <button type="button" className="btn secondary sm" onClick={() => setEditing({ note: n })}>수정</button>
                        <button type="button" className="btn ghost sm" onClick={() => remove(n)}>삭제</button>
                      </div>
                    </div>
                    <div className="prewrap">{n.content}</div>
                    {n.follow_up_date ? (
                      <div className="follow-line">
                        <span className={'tag ' + (n.follow_up_status === '예정' && n.follow_up_date < today ? 'danger' : FOLLOW_TAG[n.follow_up_status] || 'muted')}>
                          후속 {n.follow_up_status || '예정'}
                        </span>
                        <span>{shortDate(n.follow_up_date)} · {n.follow_up_title}</span>
                        {n.follow_up_status === '예정' ? <button type="button" className="link-btn" onClick={() => complete(n)}>완료로 표시</button> : null}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title={kind ? `${kind} 상담 기록이 없습니다` : '상담 기록이 없습니다'}
                action={<button type="button" className="btn" onClick={() => setEditing({})}>상담일지 작성</button>} />
            );
          }}
        </Async>
      </section>
      <MonthlyReports studentId={studentId} />
      {editing ? <NoteForm key={editing.note?.note_id ?? 'new'} studentId={studentId} note={editing.note} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </div>
  );
}
