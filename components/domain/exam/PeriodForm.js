'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
import { currentTerm } from '@/lib/term';

/** Create / edit an exam-prep period and the school exam it is for. */
export default function PeriodForm({ initial, onClose, onSaved }) {
  const { today } = useBoot();
  const toast = useToast();
  const term = currentTerm(today);
  const [form, setForm] = useState(() => ({
    title: '', start_date: '', end_date: '', exam_year: term.year, exam_semester: term.semester, exam_type: '기말', memo: '', ...(initial || {})
  }));
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const isEdit = !!form.exam_period_id;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const row = await api('saveExamPeriod', { ...form, title: form.title || `${form.exam_semester}학기 ${form.exam_type}고사 대비` });
      toast(isEdit ? '기간을 저장했습니다.' : '시험대비 기간을 만들었습니다.');
      onSaved(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? '시험대비 기간 수정' : '새 시험대비 기간'} onClose={onClose} dirty={dirty}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="연결할 학교 시험" hint="학교별 수학 시험일을 임시 반 종료일로 씁니다." wide>{() => (
            <div className="cluster">
              <input value={form.exam_year} onChange={set('exam_year')} inputMode="numeric" aria-label="학년도" style={{ width: 90 }} />
              <select value={form.exam_semester} onChange={set('exam_semester')} aria-label="학기" style={{ width: 'auto' }}>
                <option value="1">1학기</option><option value="2">2학기</option>
              </select>
              <select value={form.exam_type} onChange={set('exam_type')} aria-label="시험" style={{ width: 'auto' }}>
                <option value="중간">중간고사</option><option value="기말">기말고사</option>
              </select>
            </div>
          )}</Field>
          <Field label="이름" wide>{(id) => <input id={id} value={form.title} onChange={set('title')} placeholder={`${form.exam_semester}학기 ${form.exam_type}고사 대비`} />}</Field>
          <Field label="시작일">{(id) => <input id={id} type="date" value={form.start_date} onChange={set('start_date')} />}</Field>
          <Field label="종료일" hint="보통 마지막 학교 시험일">{(id) => <input id={id} type="date" value={form.end_date} onChange={set('end_date')} />}</Field>
          <Field label="메모" wide>{(id) => <textarea id={id} rows={2} value={form.memo} onChange={set('memo')} />}</Field>
        </div>
        {isEdit ? <p className="hint" style={{ margin: 0 }}>기간을 줄이면 범위를 벗어난 임시 배정 날짜도 함께 줄어듭니다.</p> : null}
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : isEdit ? '저장' : '만들고 편성하기'}</button>
        </div>
      </form>
    </Modal>
  );
}
