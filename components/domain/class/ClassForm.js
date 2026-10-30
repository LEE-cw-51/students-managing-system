'use client';

import { useState } from 'react';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import WeekdaySchedule from '@/components/ui/WeekdaySchedule';
import CurriculumEditor from './CurriculumEditor';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
import { shortDate } from '@/lib/format';

const EMPTY = {
  class_name: '', grade: '', school_year: String(new Date().getFullYear()), semester: '',
  teacher: '', textbook: '', textbook_started_on: '', memo: '', status: '운영', schedule: [], curriculum: []
};

function textbookSpan(row) {
  const from = row.from ? shortDate(row.from) : '시작일 없음';
  return row.to ? `${row.textbook} (${from} ~ ${shortDate(row.to)})` : `${row.textbook} (${from} ~ 사용 중)`;
}

/** Create or edit a class. onSaved(row) after a successful save. */
export default function ClassForm({ initial, onClose, onSaved }) {
  const boot = useBoot();
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...(initial || {}),
    schedule: (initial && initial.schedule) || [],
    curriculum: Array.isArray(initial && initial.curriculum) ? initial.curriculum : [],
    textbook_history: Array.isArray(initial && initial.textbook_history) ? initial.textbook_history : [],
    textbook_started_on: boot.today
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = useDirty(form);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e && e.target ? e.target.value : e }));
  const isEdit = !!form.class_id;
  const storedTextbook = String((initial && initial.textbook) || '').trim();
  const textbookChanged = isEdit && form.textbook.trim() !== storedTextbook;
  const askTextbookStart = (!isEdit && !!form.textbook.trim()) || textbookChanged;

  const scheduleProblem = form.schedule.find((s) => !s.start || !s.end || s.end <= s.start);
  const unitProblem = form.curriculum.findIndex((u) => u.title.trim() && !(Number(u.sessions) >= 1 && Number(u.sessions) <= 20));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.class_name.trim()) return setError('반 이름을 입력해 주세요.');
    if (!form.schedule.length) return setError('수업 요일을 하나 이상 선택해 주세요.');
    if (scheduleProblem) return setError(`${scheduleProblem.day}요일 시간을 확인해 주세요. (예: 1800 ~ 2000)`);
    if (unitProblem !== -1) return setError(`${unitProblem + 1}번째 단원의 수업 횟수는 1~20회로 입력해 주세요.`);
    if (askTextbookStart && !form.textbook_started_on) return setError('교재 시작일을 입력해 주세요.');
    setError('');
    setSaving(true);
    try {
      const payload = {
        class_id: form.class_id, class_name: form.class_name.trim(), grade: form.grade,
        school_year: form.school_year, semester: form.semester, teacher: form.teacher,
        textbook: form.textbook, memo: form.memo, status: form.status, schedule: form.schedule,
        ...(askTextbookStart ? { textbook_started_on: form.textbook_started_on } : {}),
        curriculum: form.curriculum.filter((u) => u.title.trim()).map((u) => ({ ...u, title: u.title.trim(), sessions: Number(u.sessions) }))
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
    <Modal title={isEdit ? '반 정보 수정' : '반 등록'} onClose={onClose} dirty={dirty}>
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
          <Field label="교재" wide hint={isEdit ? '이름을 바꾸면 이전 교재는 기록으로 남습니다.' : ''}>{(id) => <input id={id} value={form.textbook} onChange={set('textbook')} />}</Field>
          {askTextbookStart ? (
            <Field label={form.textbook.trim() ? '이 교재 시작일' : '교재를 끝내는 날'} hint="이전 교재는 그 전날까지로 남습니다.">
              {(id) => <input id={id} type="date" value={form.textbook_started_on} onChange={set('textbook_started_on')} />}
            </Field>
          ) : null}
          {isEdit && form.textbook_history.length ? (
            <Field label="교재 기록" wide>{() => (
              <ul className="stack-sm" style={{ margin: 0 }}>
                {form.textbook_history.map((h, i) => <li key={i}>{textbookSpan(h)}</li>)}
              </ul>
            )}</Field>
          ) : null}
          <Field label="수업 요일 · 시간" wide hint="요일을 누른 뒤 시간을 숫자로 입력하세요. 1800 → 18:00">
            {() => <WeekdaySchedule value={form.schedule} onChange={set('schedule')} />}
          </Field>
          <Field label="교재 · 단원 목록 (강의 계획용)" wide hint="단원마다 예상 수업 횟수를 넣으세요. 이름을 바꾸거나 순서를 옮겨도 기존 계획과 연결이 유지됩니다.">
            {() => <CurriculumEditor value={form.curriculum} onChange={set('curriculum')} textbook={form.textbook} />}
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
          <ModalCancel />
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}
