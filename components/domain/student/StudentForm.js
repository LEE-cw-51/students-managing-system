'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
import { useConfirm } from '@/components/ui/ConfirmDialog';

/** Register or edit a student. New students can be placed in a class right away. */
export default function StudentForm({ initial, onClose, onSaved }) {
  const confirm = useConfirm();
  const boot = useBoot();
  const toast = useToast();
  const isEdit = !!(initial && initial.student_id);
  const [form, setForm] = useState(() => ({
    name: '', grade: '', school: '', student_phone: '', parent_phone: '',
    enrollment_date: boot.today, status: '재원', memo: '', class_id: '', ...(initial || {})
  }));
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영' && c.class_type !== '시험대비');
  const schools = Array.from(new Set((boot.search.students || []).map((s) => s.school).filter(Boolean))).sort();

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('이름을 입력해 주세요.');
    setSaving(true);
    setError('');
    try {
      const payload = {
        student_id: form.student_id, name: form.name.trim(), grade: form.grade, school: form.school.trim(),
        student_phone: form.student_phone, parent_phone: form.parent_phone,
        enrollment_date: form.enrollment_date, status: form.status, memo: form.memo
      };
      if (!isEdit && form.class_id) payload.class_id = form.class_id;
      if (isEdit && initial.enrollment_date && form.enrollment_date !== initial.enrollment_date && initial.first_class_start === initial.enrollment_date) {
        payload.sync_class_start = (await confirm({ message: `첫 반 배정도 등록일(${initial.enrollment_date})에 시작했습니다. 반 배정 시작일도 ${form.enrollment_date}로 같이 옮길까요?`, title: '반 배정 시작일', confirmLabel: '같이 옮기기', cancelLabel: '그대로 두기' }));
      }
      const row = await api(isEdit ? 'updateStudent' : 'createStudent', payload);
      const sync = row.class_start_sync;
      if (sync && !sync.synced) toast(`학생 정보는 저장했지만 반 배정 시작일은 옮기지 못했습니다. ${sync.problem}`, 'error');
      else toast(isEdit ? '학생 정보를 저장했습니다.' : `${row.name} 학생을 등록했습니다.`);
      boot.refresh();
      onSaved(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? '학생 정보 수정' : '학생 등록'} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="이름">{(id) => <input id={id} value={form.name} onChange={set('name')} />}</Field>
          <Field label="학년">{(id) => (
            <select id={id} value={form.grade} onChange={set('grade')}>
              <option value="">선택</option>
              {(boot.grades || []).map((g) => <option key={g}>{g}</option>)}
            </select>
          )}</Field>
          <Field label="학교" hint="시험 일정과 연결됩니다. 예: 한빛중학교">{(id) => (
            <>
              <input id={id} list="student-school-options" value={form.school} onChange={set('school')} />
              <datalist id="student-school-options">{schools.map((s) => <option key={s} value={s} />)}</datalist>
            </>
          )}</Field>
          <Field label="학생 연락처">{(id) => <input id={id} type="tel" inputMode="tel" value={form.student_phone} onChange={set('student_phone')} placeholder="010-0000-0000" />}</Field>
          <Field label="학부모 연락처">{(id) => <input id={id} type="tel" inputMode="tel" value={form.parent_phone} onChange={set('parent_phone')} placeholder="010-0000-0000" />}</Field>
          <Field label="등록일">{(id) => <input id={id} type="date" value={form.enrollment_date} onChange={set('enrollment_date')} />}</Field>
          {isEdit ? (
            <Field label="상태" hint="퇴원해도 기록은 남습니다.">{(id) => (
              <select id={id} value={form.status} onChange={set('status')}>
                <option>재원</option><option>휴원</option><option>퇴원</option>
              </select>
            )}</Field>
          ) : (
            <Field label="반 배정 (선택)">{(id) => (
              <select id={id} value={form.class_id} onChange={set('class_id')}>
                <option value="">나중에 배정</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.schedule_label ? ` · ${c.schedule_label}` : ''}</option>)}
              </select>
            )}</Field>
          )}
          <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}
