'use client';

import { useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useDirty } from '@/components/ui/useDirty';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, shortDate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ConfirmDialog';

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
  const dirty = useDirty({ form, follow });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.content.trim()) return setError('상담 내용을 입력해 주세요.');
    if (follow && !form.follow_up_date) return setError('후속 조치 날짜를 입력해 주세요.');
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
          <Field label="내용" wide>{(id) => <textarea id={id} rows={5} value={form.content} onChange={set('content')} />}</Field>
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
              <Field label="날짜" hint={<span className="cluster">{[[7, '1주 뒤'], [14, '2주 뒤'], [30, '한 달 뒤']].map(([d, l]) => <button key={d} type="button" className="link-btn" onClick={() => quick(d)}>{l}</button>)}</span>}>
                {(id) => <input id={id} type="date" value={form.follow_up_date} onChange={set('follow_up_date')} />}
              </Field>
              <Field label="할 일">{(id) => <input id={id} value={form.follow_up_title} onChange={set('follow_up_title')} placeholder={form.kind === '학부모' ? '학부모 후속 연락' : '학생 후속 상담'} />}</Field>
            </div>
          ) : (
            <div className="cluster muted">빠르게 설정: {[[7, '1주 뒤'], [14, '2주 뒤'], [30, '한 달 뒤']].map(([d, l]) => <button key={d} type="button" className="link-btn" onClick={() => quick(d)}>{l}</button>)}</div>
          )}
        </fieldset>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}

const FOLLOW_TAG = { 예정: 'amber', 완료: 'ok', 취소: 'muted' };

export default function CounselingTab({ studentId, onChanged }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { today } = useBoot();
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState(null);
  const state = useApi(() => api('getCounselingNotes', studentId), [studentId]);
  const reload = () => { state.reload(); onChanged(); };

  const remove = async (n) => {
    if (!(await confirm({ message: `${formatDate(n.counsel_date)} 상담일지를 삭제할까요?${n.follow_up_status === '예정' ? '\n연결된 후속 할 일도 취소됩니다.' : ''}`, confirmLabel: '삭제', danger: true }))) return;
    try {
      await api('deleteCounselingNote', n.note_id);
      toast('삭제했습니다.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
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
          const list = notes.filter((n) => !kind || n.kind === kind);
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
      {editing ? <NoteForm studentId={studentId} note={editing.note} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </div>
  );
}
