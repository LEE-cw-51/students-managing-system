'use client';

import { useState } from 'react';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';

export const TASK_KINDS = [
  ['counsel_parent', '학부모 상담'], ['counsel_student', '학생 상담'], ['homework_check', '과제 확인'], ['admin', '행정'], ['other', '기타']
];
export const TASK_LABEL = Object.fromEntries(TASK_KINDS);

/** Add or edit a hand-written task. Passing `task` switches to edit mode and shows 삭제. */
export default function TaskForm({ date, task, onClose, onSaved }) {
  const boot = useBoot();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(() => ({
    due_date: (task && task.due_date) || date,
    kind: (task && task.kind) || 'other',
    title: (task && task.title) || '',
    memo: (task && task.memo) || '',
    student_id: (task && task.student_id) || '',
    class_id: (task && task.class_id) || ''
  }));
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }));
  const isEdit = !!(task && (task.task_id || task.id));
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영' || c.id === form.class_id);
  const students = (boot.search.students || []).filter((s) => s.id === form.student_id || (s.status === '재원' && (!filter || s.name.includes(filter))));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.due_date) return setError('날짜를 고르세요.');
    if (!form.title.trim()) return setError('제목을 입력하세요.');
    setSaving(true);
    setError('');
    try {
      await api('saveTask', {
        ...form,
        title: form.title.trim(),
        status: isEdit ? task.status || '예정' : '예정',
        ...(isEdit ? { task_id: task.task_id || task.id } : {})
      });
      toast(isEdit ? '할 일을 수정했습니다.' : '할 일을 추가했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ message: `‘${task.title}’ 할 일을 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return;
    try {
      await api('deleteTask', task.task_id || task.id);
      toast('할 일을 삭제했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isEdit ? '할 일 수정' : '할 일 추가'} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="날짜">{(id) => <input id={id} type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />}</Field>
          <Field label="종류">{(id) => (
            <select id={id} value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              {TASK_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}</Field>
          <Field label="제목" wide>{(id) => <input id={id} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 김민수 학부모 통화" />}</Field>
          <Field label="학생 (선택)">{(id) => (
            <>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름으로 찾기" aria-label="학생 이름으로 찾기" />
              <select id={id} value={form.student_id} onChange={(e) => set('student_id', e.target.value)} style={{ marginTop: 8 }}>
                <option value="">없음</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}</Field>
          <Field label="반 (선택)">{(id) => (
            <select id={id} value={form.class_id} onChange={(e) => set('class_id', e.target.value)}>
              <option value="">없음</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}</Field>
        </div>
        <Field label="메모">{(id) => <textarea id={id} rows={2} value={form.memo} onChange={(e) => set('memo', e.target.value)} />}</Field>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          {isEdit ? <button type="button" className="btn ghost" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={remove}>삭제</button> : null}
          <ModalCancel />
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : isEdit ? '저장' : '추가'}</button>
        </div>
      </form>
    </Modal>
  );
}
