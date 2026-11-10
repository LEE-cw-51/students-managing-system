'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import Badges from '@/components/domain/Badges';
import MakeupForm from './MakeupForm';
import TaskForm, { TASK_LABEL } from './TaskForm';
import { api } from '@/lib/client-api';
import { dateRange, shortDate } from '@/lib/format';

/** `state` is the page's getTodayBoard load, shared with WeekStrip so one reload refreshes both. */
export default function TodayBoard({ date, state, onOpenClass }) {
  const toast = useToast();
  const [addingMakeup, setAddingMakeup] = useState(false);
  // null = closed; { task: null } = new task; { task } = edit that task.
  const [taskForm, setTaskForm] = useState(null);

  const tasksChanged = () => state.reload();
  const setTask = async (task, status) => {
    try {
      await api('updateTaskStatus', task.task_id || task.id, status);
      toast(status === '완료' ? '완료했습니다.' : '취소했습니다.');
      tasksChanged();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const restoreClass = async (c) => {
    try {
      await api('restoreClassDate', { class_id: c.class_id, date });
      toast(`${c.class_name} 휴강을 취소했습니다.`);
      state.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const finishMakeup = async (m) => {
    try {
      const row = await api('getMakeupSession', m.makeup_id);
      await api('updateMakeupSession', { ...row, student_ids: row.student_id ? [row.student_id] : [], status: '완료' });
      toast('보강을 완료로 표시했습니다.');
      state.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Async state={state}>
      {(b) => (
        <div className="stack today-board">
          <section>
            <div className="card-head"><h2 style={{ margin: 0 }}>수업{b.classes.length ? ` ${b.classes.length}개` : ''}{b.makeups.length ? ` · 보강 ${b.makeups.length}개` : ''}</h2><button type="button" className="btn secondary sm" onClick={() => setAddingMakeup(true)}>보강 추가</button></div>
            {b.classes.length || b.makeups.length ? (
              <div className="class-cards">
                {b.classes.map((c) => (
                  <button key={c.class_id} type="button" className={'class-card' + (c.complete ? ' is-done' : '')} onClick={() => onOpenClass(c.class_id)}>
                    <span className="class-card-time">{c.start_time}{c.end_time ? `–${c.end_time}` : ''}</span>
                    <strong className="class-card-name">{c.class_name}{c.class_type === '시험대비' ? <span className="tag amber" style={{ marginLeft: 6 }}>시험대비</span> : null}</strong>
                    <span className="class-card-meta">
                      {c.complete ? <span className="tag ok">기록 완료</span>
                        : c.recorded_count ? <span className="tag amber">기록 {c.recorded_count}/{c.student_count}</span>
                          : <span className="tag muted">기록 전 · {c.student_count}명</span>}
                    </span>
                    <span className="class-card-cta">{c.complete ? '기록 보기 →' : '수업 기록 →'}</span>
                  </button>
                ))}
                {b.makeups.map((m) => (
                  <div key={m.makeup_id} className="class-card is-makeup">
                    <span className="class-card-time">{m.start_time || '시간 미정'}</span>
                    <strong className="class-card-name">{m.title}</strong>
                    <span className="class-card-meta"><span className={'tag ' + (m.status === '완료' ? 'ok' : 'amber')}>보강 {m.status}</span></span>
                    <span className="cluster">
                      {m.kind === '반' && m.class_id ? <button type="button" className="link-btn" onClick={() => onOpenClass(m.class_id)}>수업 기록 →</button> : null}
                      {m.kind === '학생' && m.student_id ? <Link href={`/students/${m.student_id}`}>학생 보기</Link> : null}
                      {m.status !== '완료' ? <button type="button" className="link-btn" onClick={() => finishMakeup(m)}>완료</button> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : <div className="card"><EmptyState title="이 날은 수업이 없습니다">위의 주간 띠에서 다른 날짜를 고르거나 보강을 추가하세요.</EmptyState></div>}
            {b.cancelled.length ? (
              <div className="stack-sm" style={{ marginTop: 8 }}>
                {b.cancelled.map((c) => (
                  <div key={c.class_id} className="split muted">
                    <span><span className="tag muted">휴강</span> {c.start_time} {c.class_name}{c.reason ? ` · ${c.reason}` : ''}</span>
                    <button type="button" className="link-btn" onClick={() => restoreClass(c)}>휴강 취소</button>
                  </div>
                ))}
              </div>
            ) : null}
            {b.suspended.length ? (
              <p className="muted" style={{ marginTop: 8 }}>시험대비 휴강: {b.suspended.map((s) => `${s.class_name}(${shortDate(s.resume_date)}부터 돌아온 학생과 수업)`).join(', ')}</p>
            ) : null}
          </section>

          <div className="cols-2 board-cards">
            <section className="card">
              <div className="card-head"><h2>할 일</h2><button type="button" className="btn secondary sm" onClick={() => setTaskForm({ task: null })}>할 일 추가</button></div>
              {b.tasks.length || b.overdue_tasks.length ? (
                <ul className="task-list">
                  {[...b.overdue_tasks, ...b.tasks].map((t) => (
                    <li key={t.id || t.task_id} className={t.status === '완료' ? 'is-done' : ''}>
                      {t.overdue ? <span className="tag danger">{shortDate(t.due_date)} 지남</span> : null}
                      <span className="tag muted">{TASK_LABEL[t.kind] || t.kind}</span>
                      {t.source === 'counseling' ? <span className="tag" title="상담일지에서 수정합니다">상담일지</span> : null}
                      <span className="task-title">
                        {t.student_id ? <Link href={`/students/${t.student_id}`}>{t.student_name || t.title}</Link> : null}
                        {t.student_id ? ' · ' : ''}{t.title}
                        {t.memo ? <span className="muted"> — {t.memo}</span> : null}
                      </span>
                      <span className="cluster">
                        {t.source !== 'auto' && t.status === '예정' ? (
                          <>
                            <button type="button" className="btn ok sm" onClick={() => setTask(t, '완료')}>완료</button>
                            <button type="button" className="btn ghost sm" onClick={() => setTask(t, '취소')}>취소</button>
                          </>
                        ) : <span className="tag ok">{t.status}</span>}
                        {t.editable ? <button type="button" className="btn secondary sm" onClick={() => setTaskForm({ task: t })}>수정</button> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState>이 날 예정된 할 일이 없습니다. 위의 ‘할 일 추가’로 직접 적거나, 상담일지의 후속 조치가 여기에 표시됩니다.</EmptyState>}
            </section>

            <section className="card">
              <div className="card-head"><h2>D-7 학교 시험</h2><Link className="link-btn" href="/exams">시험 일정</Link></div>
              {b.exams_soon.length ? (
                <div className="stack-sm">
                  {b.exams_soon.map((x) => (
                    <div key={x.school_exam_id}>
                      <div className="split">
                        <strong>{x.school} {x.grade}</strong>
                        <span>{[dateRange(x.exam_date, x.exam_end_date), x.math_label].filter(Boolean).join(' · ')} <span className={'tag ' + x.d_day_tone}>{x.d_day_label}</span></span>
                      </div>
                      <div className="muted prewrap">{[x.textbook, x.scope].filter(Boolean).join(' · ') || '범위 미입력'} · {x.students.map((s) => s.name).join(', ')}</div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState>7일 안에 있는 학교 시험이 없습니다.</EmptyState>}
            </section>

            <section className="card">
              <div className="card-head"><h2>주의 학생 {b.flagged.length ? `${b.flagged.length}명` : ''}</h2><Link className="link-btn" href="/students">학생 목록</Link></div>
              {b.unassigned_count ? (
                <div className="notice-bar" style={{ marginBottom: 12 }}>
                  반이 없는 재원생 {b.unassigned_count}명 · <Link href="/students?class=__none__">미배정 학생 보기</Link>
                </div>
              ) : null}
              {b.flagged.length ? (
                <div className="stack-sm">
                  {b.flagged.map((f) => (
                    <div key={f.student_id} className="split" style={{ alignItems: 'flex-start' }}>
                      <Link href={`/students/${f.student_id}`} style={{ fontWeight: 700 }}>{f.name}</Link>
                      <Badges badges={f.badges} />
                    </div>
                  ))}
                </div>
              ) : <EmptyState>{b.date === b.today ? '주의가 필요한 학생이 없습니다.' : '주의 학생은 오늘 날짜에서만 보여 줍니다.'}</EmptyState>}
            </section>
            <section className="card">
              <div className="card-head"><h2>이번 주 숙제 확인</h2><span className="muted">{b.weekly_homework.week_label}</span></div>
              {b.weekly_homework.classes.length ? (
                <div className="stack-sm">
                  {b.weekly_homework.classes.map((c) => (
                    <div key={c.class_id} className="split">
                      <Link href={`/classes/${c.class_id}?tab=homework`}>{c.class_name}</Link>
                      <span className="cluster">
                        {c.slots.map((s) => (
                          <span key={s.check_date} className={'tag ' + (!s.item_count ? 'muted' : s.students_incomplete ? 'warn' : 'ok')} title={`${shortDate(s.assigned_date)}에 낸 숙제`}>
                            {shortDate(s.check_date)} {!s.item_count ? '숙제 없음' : s.students_incomplete ? `미완료 ${s.students_incomplete}명` : '완료'}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <EmptyState>이번 주 수업이 없습니다.</EmptyState>}
            </section>
          </div>
          {addingMakeup ? <MakeupForm date={date} onClose={() => setAddingMakeup(false)} onSaved={() => { setAddingMakeup(false); state.reload(); }} /> : null}
          {taskForm ? <TaskForm date={date} task={taskForm.task} onClose={() => setTaskForm(null)} onSaved={() => { setTaskForm(null); tasksChanged(); }} /> : null}
        </div>
      )}
    </Async>
  );
}
