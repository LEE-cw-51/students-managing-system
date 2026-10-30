'use client';

import { useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useDirty } from '@/components/ui/useDirty';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import Field, { focusInvalid } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, shortDate } from '@/lib/format';

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function NoteForm({ studentId, note, onClose, onSaved }) {
  const { today } = useBoot();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    kind: '학부모', counsel_date: today, title: '', content: '', follow_up_date: '', follow_up_title: '', ...(note || {})
  }));
  const [follow, setFollow] = useState(!!(note && note.follow_up_date));
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
              <Field label="날짜" error={invalid.follow_up_date} hint={<span className="cluster">{[[7, '1주 뒤'], [14, '2주 뒤'], [30, '한 달 뒤']].map(([d, l]) => <button key={d} type="button" className="link-btn" onClick={() => quick(d)}>{l}</button>)}</span>}>
                {(id) => <input id={id} type="date" value={form.follow_up_date} aria-invalid={!!invalid.follow_up_date} onChange={set('follow_up_date')} />}
              </Field>
              <Field label="할 일">{(id) => <input id={id} value={form.follow_up_title} onChange={set('follow_up_title')} placeholder={form.kind === '학부모' ? '학부모 후속 연락' : '학생 후속 상담'} />}</Field>
            </div>
          ) : (
            <div className="cluster muted">빠르게 설정: {[[7, '1주 뒤'], [14, '2주 뒤'], [30, '한 달 뒤']].map(([d, l]) => <button key={d} type="button" className="link-btn" onClick={() => quick(d)}>{l}</button>)}</div>
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

const UNDO_MS = 5000;
const FOLLOW_TAG = { 예정: 'amber', 완료: 'ok', 취소: 'muted' };

export default function CounselingTab({ studentId, onChanged }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { today } = useBoot();
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState(null);
  const state = useApi(() => api('getCounselingNotes', studentId), [studentId]);
  const reload = () => { state.reload(); onChanged(); };

  // Hidden right away; the delete is sent after the undo window closes.
  const [pending, setPending] = useState([]);
  const remove = async (n) => {
    const ok = await confirm({
      title: '상담일지 삭제',
      message: `${formatDate(n.counsel_date)} 상담일지를 삭제할까요?${n.follow_up_status === '예정' ? ' 연결된 후속 할 일도 취소됩니다.' : ''}`,
      confirmLabel: '삭제',
      danger: true
    });
    if (!ok) return;
    let undone = false;
    const unhide = () => setPending((p) => p.filter((id) => id !== n.note_id));
    setPending((p) => (p.includes(n.note_id) ? p : [...p, n.note_id]));
    toast(`${formatDate(n.counsel_date)} 상담일지를 ${UNDO_MS / 1000}초 뒤 삭제합니다.${n.follow_up_status === '예정' ? ' 연결된 후속 할 일도 취소됩니다.' : ''}`, 'ok', {
      duration: UNDO_MS,
      action: { label: '되돌리기', onClick: () => { undone = true; unhide(); } }
    });
    setTimeout(async () => {
      if (undone) return;
      try {
        await api('deleteCounselingNote', n.note_id);
        toast(`${formatDate(n.counsel_date)} 상담일지를 삭제했습니다.`);
        reload();
      } catch (err) {
        unhide();
        toast(`상담일지를 삭제하지 못해 다시 표시했습니다. ${err.message}`, 'error');
      }
    }, UNDO_MS);
  };
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
    <div className="stack">
      <div className="split">
        <div className="segmented" role="group" aria-label="상담 대상">
          {[['', '전체'], ['학부모', '학부모'], ['학생', '학생']].map(([v, l]) => <button key={l} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>)}
        </div>
        <button type="button" className="btn" onClick={() => setEditing({})}>상담일지 작성</button>
      </div>
      <Async state={state}>
        {(notes) => {
          const list = notes.filter((n) => !pending.includes(n.note_id) && (!kind || n.kind === kind));
          return list.length ? (
            <div className="stack-sm">
              {list.map((n) => (
                <article key={n.note_id} className="card">
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
            <div className="card">
              <EmptyState title={kind ? `${kind} 상담 기록이 없습니다` : '상담 기록이 없습니다'}
                action={<button type="button" className="btn" onClick={() => setEditing({})}>상담일지 작성</button>} />
            </div>
          );
        }}
      </Async>
      {editing ? <NoteForm key={editing.note?.note_id ?? 'new'} studentId={studentId} note={editing.note} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </div>
  );
}
