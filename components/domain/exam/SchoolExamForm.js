'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
import { useConfirm } from '@/components/ui/ConfirmDialog';

/** Create / edit one school's math exam (date, textbook, scope). */
export default function SchoolExamForm({ initial, schools, onClose, onSaved }) {
  const confirm = useConfirm();
  const boot = useBoot();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    school: '', grade: '', exam_date: '', textbook: '', scope: '', memo: '', title: '', ...initial
  }));
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const isEdit = !!form.school_exam_id;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('saveSchoolExam', form);
      toast('시험 일정을 저장했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ message: `${form.school} ${form.grade} 시험 일정을 삭제할까요?`, confirmLabel: '삭제', danger: true }))) return;
    try {
      await api('deleteSchoolExam', form.school_exam_id);
      toast('삭제했습니다.');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isEdit ? '시험 일정 수정' : '시험 일정 추가'} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="학교" hint="재원생 학교 목록에서 고르거나 직접 입력하세요.">{(id) => (
            <>
              <input id={id} list="school-options" value={form.school} onChange={set('school')} placeholder="예: 한빛중학교" />
              <datalist id="school-options">{(schools || []).map((s) => <option key={s} value={s} />)}</datalist>
            </>
          )}</Field>
          <Field label="학년">{(id) => (
            <select id={id} value={form.grade} onChange={set('grade')}>
              <option value="">선택</option>
              {(boot.grades || []).map((g) => <option key={g}>{g}</option>)}
            </select>
          )}</Field>
          <Field label="학년도">{(id) => <input id={id} inputMode="numeric" value={form.school_year} onChange={set('school_year')} />}</Field>
          <Field label="학기">{(id) => (
            <select id={id} value={form.semester} onChange={set('semester')}>
              <option value="1">1학기</option><option value="2">2학기</option>
            </select>
          )}</Field>
          <Field label="시험">{(id) => (
            <select id={id} value={form.exam_type} onChange={set('exam_type')}>
              <option value="중간">중간고사</option><option value="기말">기말고사</option><option value="기타">기타</option>
            </select>
          )}</Field>
          {form.exam_type === '기타' ? (
            <Field label="시험 이름">{(id) => <input id={id} value={form.title} onChange={set('title')} placeholder="예: 수행평가" />}</Field>
          ) : null}
          <Field label="수학 시험일">{(id) => <input id={id} type="date" value={form.exam_date} onChange={set('exam_date')} />}</Field>
          <Field label="교재" wide>{(id) => <input id={id} value={form.textbook} onChange={set('textbook')} placeholder="예: 교과서(천재), 익힘책" />}</Field>
          <Field label="시험 범위" wide>{(id) => <textarea id={id} rows={3} value={form.scope} onChange={set('scope')} placeholder="예: 1단원 삼각형의 성질 ~ 2단원 사각형의 성질, 교과서 p.10~78" />}</Field>
          <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          {isEdit ? <button type="button" className="btn ghost" style={{ marginRight: 'auto', color: 'var(--red)' }} onClick={remove}>삭제</button> : null}
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}
