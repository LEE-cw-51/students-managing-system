'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import LMS from '../../../src/00_Core.js';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import Badges from '@/components/domain/Badges';
import DailyReportsModal from './DailyReportsModal';
import CancelDayDialog from '@/components/domain/class/CancelDayDialog';
import { api, useApi } from '@/lib/client-api';
import { formatDate, shortDate, timeSpan } from '@/lib/format';

const CONC = ['A', 'B', 'C', 'D'];
const ASSIGN = ['A', 'B', 'C'];
const PLAN_DONE = ['완료', '일부', '못 함'];

function Chips({ value, options, onChange, label, disabled }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className="chip" aria-pressed={value === o} disabled={disabled}
          onClick={() => onChange(value === o ? '' : o)}>{o}</button>
      ))}
    </div>
  );
}

function priorItemsForStudent(prior, studentId) {
  if (!prior) return [];
  const personal = (prior.personal_items_by_student && prior.personal_items_by_student[studentId]) || [];
  const classItems = (prior.items || []).filter((it) => it.item_id);
  const replace = !!(prior.replace_by_student && prior.replace_by_student[studentId]);
  const list = replace ? personal : classItems.concat(personal);
  return list.filter((it) => it.item_id);
}

function anyPriorReady(d) {
  const prior = d.prior_homework;
  if (!prior) return false;
  return d.students.some((s) => priorItemsForStudent(prior, s.student_id).length > 0);
}

/** Build the editable form state from getTodayClassSession. */
function initialForm(d) {
  const ses = d.session || {};
  const anyTest = d.students.some((s) => s.lesson && s.lesson.test_status === '실시');
  const prior = d.prior_homework;
  const priorReady = anyPriorReady(d);
  const todayPersonal = (d.today_homework && d.today_homework.personal_items_by_student) || {};
  const todayReplace = (d.today_homework && d.today_homework.replace_by_student) || {};
  return {
    session: {
      // No record yet → start from today's plan so the usual case is just a confirm.
      progress: ses.progress || (!d.recorded_count && d.daily_plan ? d.daily_plan.title || '' : ''),
      content: ses.content || '',
      test_on: !!(ses.test_title || ses.test_max_score || ses.test_scope || anyTest),
      test_title: ses.test_title || '',
      test_max_score: ses.test_max_score === null || ses.test_max_score === undefined ? '' : String(ses.test_max_score),
      test_difficulty: ses.test_difficulty || '',
      test_scope: ses.test_scope || '',
      class_notice: ses.class_notice || d.class_notice || ''
    },
    // Nothing checked yet → start everyone at 완료 so only the exceptions need a click.
    checks: priorReady ? Object.fromEntries(d.students.map((s) => {
      const items = priorItemsForStudent(prior, s.student_id);
      return [s.student_id, prior.has_checks
        ? { ...(prior.checks_by_student[s.student_id] || {}) }
        : Object.fromEntries(items.map((it) => [it.item_id, '완료']))];
    })) : {},
    homework: ((d.today_homework && d.today_homework.items) || []).map((it) => ({ item_id: it.item_id || '', title: it.title })),
    plan_done: d.daily_plan ? d.daily_plan.done_status || '' : '',
    students: Object.fromEntries(d.students.map((s) => {
      const l = s.lesson || {};
      return [s.student_id, {
        attendance: l.attendance || '출석',
        test_score: l.test_status === '실시' && l.test_score !== '' && l.test_score !== null ? String(l.test_score) : '',
        concentration: l.concentration && l.concentration !== 'ABSENT' ? l.concentration : '',
        // With prior homework the grade follows the checks unless the teacher picks one.
        assignment_manual: priorReady ? '' : (l.assignment_completion || ''),
        special_note: l.special_note || '',
        student_notice: l.student_notice || '',
        homework_replace_class: !!(todayReplace[s.student_id] || l.homework_replace_class === 'Y'),
        personal_homework: (todayPersonal[s.student_id] || []).map((it) => ({
          item_id: it.item_id || '',
          title: it.title || ''
        })),
        progress_own: l.progress_own === 'Y',
        own_progress: l.progress_own === 'Y' ? l.progress || '' : ''
      }];
    }))
  };
}

function useUnsavedGuard(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.getAttribute('href').startsWith('#') || a.getAttribute('href').startsWith('tel:')) return;
      if (!window.confirm('저장하지 않은 수업 기록이 있습니다. 이 화면을 떠날까요?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}

function Editor({ data, onSaved, onGoDate }) {
  const toast = useToast();
  const [form, setForm] = useState(() => initialForm(data));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialForm(data)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedOnce, setSavedOnce] = useState(false);
  const [reports, setReports] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const dirty = JSON.stringify(form) !== baseline;
  useUnsavedGuard(dirty);

  useEffect(() => {
    const next = initialForm(data);
    setForm(next);
    setBaseline(JSON.stringify(next));
  }, [data]);

  const cls = data.class;
  const prior = data.prior_homework;
  const priorClassItems = (prior && prior.items ? prior.items : []).filter((it) => it.item_id);
  const hasPriorHomework = anyPriorReady(data);
  const setSession = (key, v) => setForm((f) => ({ ...f, session: { ...f.session, [key]: v } }));
  const setStudent = (id, key, v) => setForm((f) => ({ ...f, students: { ...f.students, [id]: { ...f.students[id], [key]: v } } }));
  const setOwnProgress = (id, on) => setForm((f) => ({
    ...f,
    students: { ...f.students, [id]: { ...f.students[id], progress_own: on, own_progress: on ? f.session.progress : '' } }
  }));
  const setCheck = (sid, itemId, done) => setForm((f) => ({ ...f, checks: { ...f.checks, [sid]: { ...f.checks[sid], [itemId]: done ? '완료' : '미완료' } } }));
  const setAllChecks = (sid, done) => setForm((f) => ({
    ...f,
    checks: Object.fromEntries(Object.entries(f.checks).map(([id, m]) => {
      if (sid !== null && sid !== id) return [id, m];
      const items = priorItemsForStudent(prior, id);
      return [id, Object.fromEntries(items.map((it) => [it.item_id, done ? '완료' : '미완료']))];
    }))
  }));

  const autoGrade = useCallback((sid) => {
    const items = priorItemsForStudent(prior, sid);
    if (!items.length) return '';
    const m = form.checks[sid] || {};
    const done = items.filter((it) => m[it.item_id] === '완료').length;
    return LMS.assignmentGradeFromChecks(done, items.length);
  }, [form.checks, prior]);

  const setPersonalHomework = (sid, list) => setStudent(sid, 'personal_homework', list);

  const homework = form.homework;
  const setHomework = (list) => setForm((f) => ({ ...f, homework: list }));
  const planHomework = data.daily_plan && data.daily_plan.homework ? data.daily_plan.homework : '';

  // 개별 공지 · 개인 숙제 are rarely used: folded per student unless opened or already filled.
  const [extraOpen, setExtraOpen] = useState({});
  const presentCount = data.students.filter((s) => form.students[s.student_id].attendance !== '결석').length;

  const restore = async () => {
    try {
      await api('restoreClassDate', { class_id: cls.class_id, date: data.date });
      toast('휴강을 취소했습니다.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const save = async () => {
    setError('');
    const s = form.session;
    if (s.test_on && !String(s.test_max_score).trim()) {
      setError('테스트 만점을 입력해 주세요.');
      return document.getElementById('rec-tm')?.focus();
    }
    setSaving(true);
    try {
      await api('saveTodaySession', {
        lesson_date: data.date,
        class_id: cls.class_id,
        session: {
          progress: s.progress, content: s.content, class_notice: s.class_notice,
          test_title: s.test_on ? s.test_title : '', test_max_score: s.test_on ? s.test_max_score : '', test_difficulty: s.test_on ? s.test_difficulty : '',
          test_scope: s.test_on ? s.test_scope : ''
        },
        prior: hasPriorHomework ? {
          assigned_date: prior.assigned_date,
          checks: data.students.flatMap((st) => priorItemsForStudent(prior, st.student_id).map((it) => ({
            item_id: it.item_id,
            student_id: st.student_id,
            status: (form.checks[st.student_id] || {})[it.item_id] === '완료' ? '완료' : '미완료'
          })))
        } : null,
        homework_items: homework.filter((h) => h.title.trim()).map((h) => ({ item_id: h.item_id, title: h.title.trim() })),
        ...(data.daily_plan ? { plan_done_status: form.plan_done } : {}),
        students: data.students.map((st) => {
          const v = form.students[st.student_id];
          const tested = s.test_on && v.attendance !== '결석' && String(v.test_score).trim() !== '';
          const own = v.progress_own && v.own_progress.trim() !== '' && v.own_progress.trim() !== s.progress.trim();
          return {
            ...(own ? { progress_own: 'Y', progress: v.own_progress.trim() } : { progress_own: '' }),
            student_id: st.student_id,
            attendance: v.attendance,
            test_status: tested ? '실시' : '미실시',
            test_score: tested ? v.test_score : '',
            concentration: v.concentration,
            assignment_completion: v.assignment_manual,
            special_note: v.special_note,
            student_notice: v.student_notice,
            homework_replace_class: v.homework_replace_class ? 'Y' : '',
            personal_homework: (v.personal_homework || []).filter((h) => h.title.trim()).map((h) => ({
              item_id: h.item_id,
              title: h.title.trim()
            }))
          };
        })
      });
      toast('수업 기록을 저장했습니다.');
      setSavedOnce(true);
      setBaseline(JSON.stringify(form));
      onSaved();
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S (⌘S) saves; ignored while a dialog is open or nothing can be saved.
  const saveRef = useRef(save);
  saveRef.current = () => { if (!saving && data.students.length && !document.querySelector('.modal')) save(); };
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="stack recorder">
      {!data.meets ? (
        <div className="notice-bar">
          {data.cancellation ? (
            <>
              이 날은 휴강으로 지정했습니다{data.cancellation.reason ? `(${data.cancellation.reason})` : ''}.{' '}
              <button type="button" className="link-btn" onClick={restore}>휴강 취소</button>{' · '}
            </>
          ) : data.suspension ? `${data.suspension.title} 기간이라 이 반은 휴강입니다. ` : '이 날은 이 반의 정규 수업일이 아닙니다. 보강이면 그대로 기록하세요. '}
          {data.prev_meeting ? <button type="button" className="link-btn" onClick={() => onGoDate(data.prev_meeting)}>최근 수업일 {shortDate(data.prev_meeting)}</button> : null}
          {data.prev_meeting && data.next_meeting ? ' · ' : null}
          {data.next_meeting ? <button type="button" className="link-btn" onClick={() => onGoDate(data.next_meeting)}>다음 수업일 {shortDate(data.next_meeting)}</button> : null}
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2>① 반 공통</h2>
          {data.meets && !data.recorded_count && !savedOnce ? <button type="button" className="btn ghost sm" onClick={() => setCancelling(true)}>이 날 휴강</button> : null}
        </div>
        {cancelling ? (
          <CancelDayDialog classId={cls.class_id} className={cls.class_name} date={data.date}
            onClose={() => setCancelling(false)} onDone={() => onSaved()} />
        ) : null}
        <div className="form-grid">
          <div className="field span-all">
            <label htmlFor="rec-progress">진도</label>
            {data.daily_plan ? (
              <div className="plan-check">
                <span>계획: <strong>{data.daily_plan.title || data.daily_plan.content}</strong></span>
                <Chips value={form.plan_done} options={PLAN_DONE} label="계획 진행 결과" onChange={(v) => setForm((f) => ({ ...f, plan_done: v }))} />
                <span className="hint">고르지 않으면 계획대로 끝낸 것으로 봅니다. 다음 초안을 짤 때 씁니다.</span>
              </div>
            ) : null}
            <textarea id="rec-progress" rows={2} value={form.session.progress} onChange={(e) => setSession('progress', e.target.value)} />
            {data.last_progress ? (
              <span className="hint">지난 수업({shortDate(data.last_progress.date)}): {data.last_progress.progress}{' '}
                {!form.session.progress ? <button type="button" className="link-btn" onClick={() => setSession('progress', data.last_progress.progress)}>그대로 가져오기</button> : null}
              </span>
            ) : null}
          </div>
          <div className="field span-all">
            <label htmlFor="rec-content">수업 내용 (선택)</label>
            <textarea id="rec-content" rows={2} value={form.session.content} onChange={(e) => setSession('content', e.target.value)} />
          </div>
          <div className="field span-all">
            <label className="check-label"><input type="checkbox" checked={form.session.test_on} onChange={(e) => setSession('test_on', e.target.checked)} /> 오늘 테스트를 봤어요</label>
            {form.session.test_on ? (
              <div className="form-grid" style={{ marginTop: 8 }}>
                <div className="field"><label htmlFor="rec-tt">테스트 이름</label><input id="rec-tt" value={form.session.test_title} onChange={(e) => setSession('test_title', e.target.value)} placeholder="예: 단원 확인 테스트" /></div>
                <div className="field"><label htmlFor="rec-tm">만점</label><input id="rec-tm" inputMode="numeric" value={form.session.test_max_score} aria-invalid={error === '테스트 만점을 입력해 주세요.'} onChange={(e) => setSession('test_max_score', e.target.value.replace(/[^\d.]/g, ''))} /></div>
                <div className="field"><label>난이도</label><Chips value={form.session.test_difficulty} options={['상', '중', '하']} label="난이도" onChange={(v) => setSession('test_difficulty', v)} /></div>
                <div className="field span-all"><label htmlFor="rec-scope">시험 범위</label><input id="rec-scope" value={form.session.test_scope} onChange={(e) => setSession('test_scope', e.target.value)} placeholder="예: 3단원 함수 ~ 4단원" /></div>
              </div>
            ) : null}
          </div>
          <div className="field span-all">
            <label htmlFor="rec-notice">반 공지 (일일 보고서 공지사항)</label>
            <textarea id="rec-notice" rows={2} value={form.session.class_notice} onChange={(e) => setSession('class_notice', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>② 지난 숙제 확인</h2>
          {hasPriorHomework ? <span className="cluster"><span className="muted">{shortDate(prior.assigned_date)}에 낸 숙제</span><button type="button" className="btn secondary sm" onClick={() => setAllChecks(null, true)}>전체 완료</button></span> : null}
        </div>
        {hasPriorHomework && !prior.has_checks ? <p className="hint" style={{ marginTop: 0 }}>아직 확인 전이라 모두 ‘완료’로 채워 두었습니다. 안 한 숙제만 체크를 해제하세요.</p> : null}
        {hasPriorHomework ? (
          <div className="table-wrap">
            <table className="data-table check-table">
              <thead>
                <tr>
                  <th>학생</th>
                  {priorClassItems.map((it) => <th key={it.item_id} className="center">{it.title}</th>)}
                  <th>개인 숙제</th>
                  <th className="center">과제 등급</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.students.map((st) => {
                  const replace = !!(prior.replace_by_student && prior.replace_by_student[st.student_id]);
                  const personal = ((prior.personal_items_by_student && prior.personal_items_by_student[st.student_id]) || []).filter((it) => it.item_id);
                  return (
                    <tr key={st.student_id}>
                      <td>
                        <strong>{st.name}</strong>
                        {replace ? <span className="tag muted" style={{ marginLeft: 6 }}>반 숙제 제외</span> : null}
                      </td>
                      {priorClassItems.map((it) => {
                        if (replace) {
                          return <td key={it.item_id} className="center muted">—</td>;
                        }
                        const done = (form.checks[st.student_id] || {})[it.item_id] === '완료';
                        return (
                          <td key={it.item_id} className="center">
                            <input type="checkbox" className="big-check" checked={done} aria-label={`${st.name} ${it.title}`} onChange={(e) => setCheck(st.student_id, it.item_id, e.target.checked)} />
                          </td>
                        );
                      })}
                      <td>
                        {personal.length ? (
                          <div className="stack-sm">
                            {personal.map((it) => {
                              const done = (form.checks[st.student_id] || {})[it.item_id] === '완료';
                              return (
                                <label key={it.item_id} className="check-label" style={{ margin: 0 }}>
                                  <input type="checkbox" className="big-check" checked={done} aria-label={`${st.name} ${it.title}`} onChange={(e) => setCheck(st.student_id, it.item_id, e.target.checked)} />
                                  <span>{it.title} <span className="tag muted">개인</span></span>
                                </label>
                              );
                            })}
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="center"><strong>{form.students[st.student_id].assignment_manual || autoGrade(st.student_id) || '-'}</strong></td>
                      <td><button type="button" className="link-btn" onClick={() => setAllChecks(st.student_id, true)}>모두 완료</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>{prior && prior.assigned_date ? `${shortDate(prior.assigned_date)} 수업에 낸 숙제가 없습니다.` : '이전 수업이 없습니다.'} 과제 등급은 학생별 입력에서 직접 고르세요.</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>③ 오늘 낼 숙제</h2>
          {planHomework && !homework.length ? <button type="button" className="link-btn" onClick={() => setHomework(planHomework.split(/\n+/).filter(Boolean).map((t) => ({ item_id: '', title: t.trim() })))}>강의 계획 숙제 불러오기</button> : null}
        </div>
        <div className="stack-sm">
          {homework.map((h, i) => (
            <div key={i} className="cluster" style={{ flexWrap: 'nowrap' }}>
              <span className="muted" style={{ width: 20 }}>{i + 1}</span>
              <input value={h.title} aria-label={`숙제 ${i + 1}`} onChange={(e) => setHomework(homework.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="예: 교재 80~83쪽" />
              <button type="button" className="btn ghost sm" aria-label={`숙제 ${i + 1} 삭제`} onClick={() => setHomework(homework.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div><button type="button" className="btn secondary sm" onClick={() => setHomework([...homework, { item_id: '', title: '' }])}>+ 숙제 추가</button></div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>④ 학생별 기록</h2>
          <span className="muted">출석 {presentCount}/{data.students.length}명</span>
        </div>
        {data.on_leave && data.on_leave.length ? (
          <p className="hint">휴원 학생 {data.on_leave.length}명({data.on_leave.map((s) => s.name).join(', ')})은 명단에서 뺐습니다.</p>
        ) : null}
        {data.students.length ? (
          <div className="student-rows">
            {data.students.map((st) => {
              const v = form.students[st.student_id];
              const absent = v.attendance === '결석';
              const grade = v.assignment_manual || autoGrade(st.student_id);
              const extra = extraOpen[st.student_id] || !!v.student_notice || !!v.homework_replace_class || !!(v.personal_homework || []).length;
              return (
                <div key={st.student_id} className={'student-row' + (absent ? ' is-absent' : '')}>
                  <div className="sr-name">
                    <Link href={`/students/${st.student_id}`}>{st.name}</Link>
                    {st.off_roster ? <span className="tag muted">명단 밖</span> : null}
                    {v.progress_own ? <span className="tag">개인 진도</span> : null}
                    <Badges badges={st.badges} quiet />
                  </div>
                  <div className="sr-field">
                    <span className="sr-label">출결</span>
                    <div className="chips" role="group" aria-label={`${st.name} 출결`}>
                      {['출석', '결석'].map((a) => <button key={a} type="button" className={'chip' + (a === '결석' ? ' danger' : '')} aria-pressed={v.attendance === a} onClick={() => setStudent(st.student_id, 'attendance', a)}>{a}</button>)}
                    </div>
                  </div>
                  {form.session.test_on ? (
                    <div className="sr-field">
                      <span className="sr-label">점수</span>
                      <input className="score-input" inputMode="decimal" disabled={absent} value={absent ? '' : v.test_score} aria-label={`${st.name} 점수`}
                        placeholder={absent ? '결석' : '미응시'} onChange={(e) => setStudent(st.student_id, 'test_score', e.target.value.replace(/[^\d.]/g, ''))} />
                      {form.session.test_max_score ? <span className="muted">/ {form.session.test_max_score}</span> : null}
                    </div>
                  ) : null}
                  <div className="sr-field">
                    <span className="sr-label">집중도</span>
                    <Chips value={absent ? '' : v.concentration} options={CONC} label={`${st.name} 집중도`} disabled={absent} onChange={(x) => setStudent(st.student_id, 'concentration', x)} />
                  </div>
                  <div className="sr-field">
                    <span className="sr-label">과제{!v.assignment_manual && grade ? ' (자동)' : ''}</span>
                    <Chips value={grade} options={ASSIGN} label={`${st.name} 과제 이행`} onChange={(x) => setStudent(st.student_id, 'assignment_manual', x)} />
                  </div>
                  {extra ? <div className="sr-note" style={{ flexBasis: '100%' }}>
                    <input value={v.student_notice} aria-label={`${st.name} 개별 공지`} placeholder="개별 공지 (피드백과 별도)" onChange={(e) => setStudent(st.student_id, 'student_notice', e.target.value)} />
                  </div> : null}
                  {v.progress_own ? (
                    <div className="sr-field sr-progress">
                      <span className="sr-label">진도</span>
                      <input value={v.own_progress} aria-label={`${st.name} 개인 진도`} placeholder="이 학생의 오늘 진도"
                        onChange={(e) => setStudent(st.student_id, 'own_progress', e.target.value)} />
                      <button type="button" className="link-btn" onClick={() => setOwnProgress(st.student_id, false)}>반 진도로</button>
                    </div>
                  ) : (
                    <div className="sr-field">
                      <button type="button" className="link-btn" onClick={() => setOwnProgress(st.student_id, true)}>진도 다름</button>
                    </div>
                  )}
                  <div className="sr-note">
                    <input value={v.special_note} aria-label={`${st.name} 특이사항`} placeholder="특이사항 · 학생 피드백" onChange={(e) => setStudent(st.student_id, 'special_note', e.target.value)} />
                  </div>
                  {extra ? <div className="sr-note" style={{ flexBasis: '100%' }}>
                    <div className="cluster" style={{ marginBottom: 6 }}>
                      <span className="sr-label">개인 숙제</span>
                      <label className="check-label" style={{ margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={!!v.homework_replace_class}
                          onChange={(e) => setStudent(st.student_id, 'homework_replace_class', e.target.checked)}
                        />
                        반 숙제 제외
                      </label>
                      <button
                        type="button"
                        className="btn secondary sm"
                        onClick={() => setPersonalHomework(st.student_id, [...(v.personal_homework || []), { item_id: '', title: '' }])}
                      >
                        + 추가
                      </button>
                    </div>
                    {(v.personal_homework || []).length ? (
                      <div className="stack-sm">
                        {(v.personal_homework || []).map((h, i) => (
                          <div key={i} className="cluster" style={{ flexWrap: 'nowrap' }}>
                            <input
                              value={h.title}
                              aria-label={`${st.name} 개인 숙제 ${i + 1}`}
                              placeholder="예: 보충 워크북 3쪽"
                              onChange={(e) => setPersonalHomework(st.student_id, v.personal_homework.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                            />
                            <button
                              type="button"
                              className="btn ghost sm"
                              aria-label={`${st.name} 개인 숙제 ${i + 1} 삭제`}
                              onClick={() => setPersonalHomework(st.student_id, v.personal_homework.filter((_, j) => j !== i))}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : <span className="muted">반 공통 숙제만 냅니다.</span>}
                  </div> : (
                    <div className="sr-field">
                      <button type="button" className="link-btn" onClick={() => setExtraOpen((o) => ({ ...o, [st.student_id]: true }))}>+ 개별 공지 · 개인 숙제</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <EmptyState title="이 날 이 반에 배정된 학생이 없습니다">반 화면의 학생 탭에서 배정하세요.</EmptyState>}
      </section>

      <div className="save-bar">
        {error ? <div className="error-box save-bar-error" role="alert">{error}</div> : null}
        <span className={'save-state ' + (dirty ? 'dirty' : savedOnce ? 'saved' : '')}>
          {dirty ? '● 저장하지 않은 변경이 있습니다' : savedOnce ? '✓ 저장됨' : data.recorded_count ? `기록 ${data.recorded_count}/${data.total_count}명 저장됨` : '아직 저장하지 않았습니다'}
        </span>
        <span className="cluster">
          {data.recorded_count || savedOnce ? <button type="button" className="btn secondary" onClick={() => setReports(true)} disabled={dirty}>일일 보고서</button> : null}
          <button type="button" className="btn" onClick={save} disabled={saving || !data.students.length} title="저장 (Ctrl+S)">{saving ? '저장 중…' : '저장'}</button>
        </span>
      </div>
      {reports ? <DailyReportsModal classId={cls.class_id} className={cls.class_name} date={data.date} onClose={() => setReports(false)} /> : null}
    </div>
  );
}

export default function LessonRecorder({ classId, date, onGoDate }) {
  const state = useApi(() => api('getTodayClassSession', date, classId), [classId, date]);
  return (
    <Async state={state}>
      {(d) => (
        <>
          <div className="recorder-head">
            <div>
              <h2 className="display" style={{ margin: 0 }}><Link href={`/classes/${d.class.class_id}`}>{d.class.class_name}</Link></h2>
              <div className="muted">{formatDate(d.date, true)} {d.time ? timeSpan(d.time) : ''} · {d.class.schedule_label}</div>
            </div>
          </div>
          <Editor data={d} onSaved={state.reload} onGoDate={onGoDate} />
        </>
      )}
    </Async>
  );
}
