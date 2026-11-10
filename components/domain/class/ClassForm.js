'use client';

import { useId, useRef, useState } from 'react';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import Field from '@/components/ui/Field';
import WeekdaySchedule from '@/components/ui/WeekdaySchedule';
import CurriculumEditor from './CurriculumEditor';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api } from '@/lib/client-api';
const EMPTY = {
  class_name: '', grade: '', school_year: String(new Date().getFullYear()), semester: '',
  teacher: '', textbook: '', textbook_started_on: '', memo: '', status: '운영', schedule: [], curriculum: []
};

function curriculumSummary(textbook, units) {
  const named = units.filter((u) => u.title.trim());
  if (!textbook.trim() && !named.length) return '비어 있음';
  const total = named.reduce((n, u) => n + (Number(u.sessions) || 0), 0);
  const current = named.some((u) => u.completed) ? named.findIndex((u) => !u.completed) : 0;
  return [
    textbook.trim() || '교재 없음',
    named.length ? `${named.length}단원 · ${total}회` : '단원 없음',
    named.length && current >= 0 ? `지금 ${current + 1}단원` : ''
  ].filter(Boolean).join(' · ');
}

function FormSection({ title, note, summary, open, onToggle, children }) {
  const id = useId();
  return (
    <section className="cf-section">
      <button type="button" className="cf-section-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className="cf-section-title"><span className="cf-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>{title} <small>{note}</small></span>
        <span className="cf-section-summary">{summary}</span>
      </button>
      <div id={id} className="cf-section-body" hidden={!open}>{children}</div>
    </section>
  );
}

/**
 * Create or edit a class. onSaved(row) after a successful save.
 * `section="curriculum"` shows only the unit list; `onDelete` adds the delete button.
 */
export default function ClassForm({ initial, onClose, onSaved, section, onDelete }) {
  const boot = useBoot();
  const toast = useToast();
  const formId = useId();
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...(initial || {}),
    schedule: (initial && initial.schedule) || [],
    curriculum: Array.isArray(initial && initial.curriculum) ? initial.curriculum : [],
    textbook_started_on: initial && initial.class_id ? '' : boot.today
  }));
  const [open, setOpen] = useState({ textbook: false, more: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const dirty = useDirty(form);
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e && e.target ? e.target.value : e }));
    setError((err) => (err && err.key === key ? null : err));
  };
  const toggle = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const isEdit = !!form.class_id;
  const timeline = (initial && initial.textbook_timeline) || [];
  const storedTextbook = String((initial && initial.textbook) || '').trim();
  const textbookChanged = isEdit && form.textbook.trim() !== storedTextbook;
  const askTextbookStart = (!isEdit && !!form.textbook.trim()) || textbookChanged;
  const clearingTextbook = textbookChanged && !form.textbook.trim();
  const closing = isEdit && form.status === '종료' && initial.status !== '종료';

  const scheduleProblem = form.schedule.find((s) => !s.start || !s.end || s.end <= s.start);
  const unitProblem = form.curriculum.findIndex((u) => u.title.trim() && !(Number(u.sessions) >= 1 && Number(u.sessions) <= 20));

  const findProblem = () => {
    if (!form.class_name.trim()) return { key: 'class_name', message: '반 이름을 입력해 주세요.', target: '[name="class_name"]' };
    if (!form.schedule.length) return { key: 'schedule', message: '수업 요일을 하나 이상 선택해 주세요.', target: '.weekday-picker button' };
    if (scheduleProblem) {
      return {
        key: 'schedule', message: `${scheduleProblem.day}요일 시간을 확인해 주세요. (예: 1800 ~ 2000)`,
        target: `[aria-label="${scheduleProblem.day}요일 ${scheduleProblem.start ? '종료' : '시작'} 시간"]`
      };
    }
    if (unitProblem !== -1) {
      return {
        key: 'curriculum', section: 'textbook', message: `${unitProblem + 1}번째 단원의 수업 횟수는 1~20회로 입력해 주세요.`,
        target: `[aria-label="${unitProblem + 1}번째 단원 수업 횟수"]`
      };
    }
    if (askTextbookStart && !form.textbook_started_on) {
      return {
        key: 'textbook_started_on', section: 'textbook', target: '[name="textbook_started_on"]',
        message: clearingTextbook ? '이전 교재를 끝내는 날을 입력해 주세요.' : textbookChanged ? '교재를 바꿨습니다. 새 교재 시작일을 입력해 주세요.' : '교재 시작일을 입력해 주세요.'
      };
    }
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const problem = findProblem();
    if (problem) {
      setError(problem);
      if (problem.section) setOpen((o) => ({ ...o, [problem.section]: true }));
      requestAnimationFrame(() => formRef.current?.querySelector(problem.target)?.focus());
      return;
    }
    setError(null);
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
      setError({ key: '', message: err.message });
      requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'nearest' }));
    } finally {
      setSaving(false);
    }
  };

  const errorFor = (key) => (error && error.key === key ? error.message : '');
  const formError = error && !error.key ? <div className="error-box" role="alert" ref={errorRef}>{error.message}</div> : null;
  const curriculumField = (
    <Field label="단원 목록 (강의 계획용)" wide error={errorFor('curriculum')} hint="단원마다 예상 수업 횟수를 넣으세요. 이름을 바꾸거나 순서를 옮겨도 기존 계획과 연결이 유지됩니다.">
      {() => <CurriculumEditor value={form.curriculum} onChange={set('curriculum')} textbook={form.textbook} />}
    </Field>
  );
  const saveButton = (
    <button type="submit" form={formId} className="btn" disabled={saving}>{saving ? '저장 중…' : isEdit ? '저장' : '등록'}</button>
  );

  if (section === 'curriculum') {
    return (
      <Modal title={`${form.class_name} 단원 목록`} onClose={onClose} dirty={dirty}>
        <form id={formId} ref={formRef} onSubmit={submit} className="stack" noValidate>
          <div className="form-grid">{curriculumField}</div>
          {formError}
          <div className="form-actions">
            <ModalCancel />
            {saveButton}
          </div>
        </form>
      </Modal>
    );
  }

  const footer = (
    <>
      {onDelete ? <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={onDelete}>반 삭제</button> : null}
      <ModalCancel />
      {saveButton}
    </>
  );

  return (
    <Modal title={isEdit ? `반 정보 수정 · ${initial.class_name}` : '반 등록'} onClose={onClose} dirty={dirty} footer={footer} className="cf-modal">
      <form id={formId} ref={formRef} onSubmit={submit} className="cf-form" noValidate>
        <section className="cf-basic">
          <div className={'cf-row' + (isEdit ? ' has-status' : '')}>
            <Field label="반 이름 *" className="cf-name" error={errorFor('class_name')}>{(id) => (
              <input id={id} name="class_name" value={form.class_name} onChange={set('class_name')} placeholder="예: 중2 A반"
                aria-invalid={errorFor('class_name') ? 'true' : undefined} />
            )}</Field>
            <Field label="학년">{(id) => (
              <select id={id} value={form.grade} onChange={set('grade')}>
                <option value="">선택</option>
                {(boot.grades || []).map((g) => <option key={g}>{g}</option>)}
              </select>
            )}</Field>
            {isEdit ? (
              <div className="field">
                <span className="cf-label" id={`${formId}-status`}>상태</span>
                <div className="segmented cf-status" role="group" aria-labelledby={`${formId}-status`}>
                  {['운영', '종료'].map((s) => (
                    <button key={s} type="button" aria-pressed={form.status === s} onClick={() => set('status')(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {closing ? <p className="hint cf-closing">저장하면 이 반의 학생 배정이 모두 끝납니다.</p> : null}
          <Field label="수업 요일 · 시간 *" error={errorFor('schedule')} hint="요일을 누른 뒤 시간을 숫자로 입력하세요. 1800 → 18:00">
            {() => <WeekdaySchedule value={form.schedule} onChange={set('schedule')} copyPrevious />}
          </Field>
        </section>

        <FormSection title="교재 · 단원 목록" note="선택 · 강의 계획 초안에 씀" summary={curriculumSummary(form.textbook, form.curriculum)}
          open={open.textbook} onToggle={() => toggle('textbook')}>
          <div className="stack">
            <div className="cf-row">
              <Field label="교재" className="cf-name" hint={isEdit ? '이름을 바꾸면 이전 교재는 기록으로 남습니다.' : ''}>{(id) => (
                <input id={id} value={form.textbook} onChange={set('textbook')} />
              )}</Field>
              {askTextbookStart ? (
                <Field label={clearingTextbook ? '교재를 끝내는 날 *' : '이 교재 시작일 *'} error={errorFor('textbook_started_on')}
                  hint={clearingTextbook ? '이전 교재는 이 날까지 쓴 것으로 남습니다.' : isEdit ? '이전 교재는 그 전날까지로 남습니다.' : ''}>
                  {(id) => (
                    <input id={id} name="textbook_started_on" type="date" value={form.textbook_started_on} onChange={set('textbook_started_on')}
                      aria-invalid={errorFor('textbook_started_on') ? 'true' : undefined} />
                  )}
                </Field>
              ) : null}
            </div>
            {isEdit && timeline.length ? (
              <details className="cf-history">
                <summary>교재 기록 {timeline.length}개</summary>
                <ul className="stack-sm">
                  {timeline.map((h, i) => <li key={i}>{h.label}</li>)}
                </ul>
              </details>
            ) : null}
            {curriculumField}
          </div>
        </FormSection>

        <FormSection title="기타" note="선택"
          summary={`${form.school_year ? `${form.school_year}학년도` : '학년도 -'} · ${form.semester ? `${form.semester}학기` : '학기 -'} · 강사 ${form.teacher.trim() || '-'} · 메모 ${form.memo.trim() ? '있음' : '-'}`}
          open={open.more} onToggle={() => toggle('more')}>
          <div className="stack">
            <div className="cf-row cf-row-3">
              <Field label="학년도">{(id) => <input id={id} inputMode="numeric" value={form.school_year} onChange={set('school_year')} />}</Field>
              <Field label="학기">{(id) => (
                <select id={id} value={form.semester} onChange={set('semester')}>
                  <option value="">-</option><option value="1">1학기</option><option value="2">2학기</option>
                </select>
              )}</Field>
              <Field label="담당 강사">{(id) => <input id={id} value={form.teacher} onChange={set('teacher')} />}</Field>
            </div>
            <Field label="메모">{(id) => <textarea id={id} value={form.memo} onChange={set('memo')} rows={2} />}</Field>
          </div>
        </FormSection>
        {formError}
      </form>
    </Modal>
  );
}
