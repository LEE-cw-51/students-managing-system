'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import WeekdaySchedule from '@/components/ui/WeekdaySchedule';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';

const EMPTY = {
  class_name: '', grade: '', school_year: String(new Date().getFullYear()), semester: '',
  teacher: '', textbook: '', memo: '', status: '운영', schedule: []
};

/** Create or edit a class. onSaved(row) after a successful save. */
export default function ClassForm({ initial, onClose, onSaved }) {
  const boot = useBoot();
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(initial || {}), schedule: (initial && initial.schedule) || [] }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e && e.target ? e.target.value : e }));
  const isEdit = !!form.class_id;

  const scheduleProblem = form.schedule.find((s) => !s.start || !s.end || s.end <= s.start);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.class_name.trim()) return setError('반 이름을 입력해 주세요.');
    if (!form.schedule.length) return setError('수업 요일을 하나 이상 선택해 주세요.');
    if (scheduleProblem) return setError(`${scheduleProblem.day}요일 시간을 확인해 주세요. (예: 1800 ~ 2000)`);
    setError('');
    setSaving(true);
    try {
      const payload = {
        class_id: form.class_id, class_name: form.class_name.trim(), grade: form.grade,
        school_year: form.school_year, semester: form.semester, teacher: form.teacher,
        textbook: form.textbook, memo: form.memo, status: form.status, schedule: form.schedule
      };
      if (isEdit) {
        payload.current_progress = form.current_progress || '';
        payload.class_homework = form.class_homework || '';
      }
      const row = await api(isEdit ? 'updateClass' : 'createClass', payload);
      toast(isEdit ? '반 정보를 저장했습니다.' : '반을 등록했습니다.');
      boot.refresh();
      onSaved(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? '반 정보 수정' : '반 등록'} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="form-grid">
          <Field label="반 이름" wide>{(id) => <input id={id} value={form.class_name} onChange={set('class_name')} placeholder="예: 중2 A반" />}</Field>
          <Field label="학년">{(id) => (
            <select id={id} value={form.grade} onChange={set('grade')}>
              <option value="">선택</option>
              {(boot.grades || []).map((g) => <option key={g}>{g}</option>)}
            </select>
          )}</Field>
          <Field label="담당 강사">{(id) => <input id={id} value={form.teacher} onChange={set('teacher')} />}</Field>
          <Field label="학년도">{(id) => <input id={id} inputMode="numeric" value={form.school_year} onChange={set('school_year')} />}</Field>
          <Field label="학기">{(id) => (
            <select id={id} value={form.semester} onChange={set('semester')}>
              <option value="">-</option><option value="1">1학기</option><option value="2">2학기</option>
            </select>
          )}</Field>
          <Field label="교재" wide>{(id) => <input id={id} value={form.textbook} onChange={set('textbook')} />}</Field>
          <Field label="수업 요일 · 시간" wide hint="요일을 누른 뒤 시간을 숫자로 입력하세요. 1800 → 18:00">
            {() => <WeekdaySchedule value={form.schedule} onChange={set('schedule')} />}
          </Field>
          <Field label="메모" wide>{(id) => <textarea id={id} value={form.memo} onChange={set('memo')} rows={2} />}</Field>
          {isEdit ? (
            <Field label="상태">{(id) => (
              <select id={id} value={form.status} onChange={set('status')}>
                <option>운영</option><option>종료</option>
              </select>
            )}</Field>
          ) : null}
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
