'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Async, EmptyState, Kpi } from '@/components/ui/Feedback';
import GradeTrend from '@/components/ui/GradeTrend';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, percent, relativeDay, score, shortDate, timeSpan } from '@/lib/format';
import { dDayLabel } from '@/lib/term';
import Field from '@/components/ui/Field';
import ClassChangeDialog, { openRegularClasses } from './ClassChangeDialog';

/** Add a regular class to the student (추가 수강, or the first class for a 미배정 student). */
function AssignClassModal({ studentId, exceptIds, onClose, onDone }) {
  const boot = useBoot();
  const toast = useToast();
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(boot.today);
  const [error, setError] = useState('');
  const targets = openRegularClasses(boot, exceptIds);
  const submit = async (e) => {
    e.preventDefault();
    if (!classId) return setError('반을 골라 주세요.');
    try {
      await api('assignStudentToClass', { student_id: studentId, class_id: classId, start_date: date });
      toast('반에 배정했습니다.');
      boot.refresh();
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title="반 배정" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="반">{(id) => (
            <select id={id} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">반 선택</option>
              {targets.map((c) => <option key={c.id} value={c.id}>{c.name}{c.schedule_label ? ` · ${c.schedule_label}` : ''}</option>)}
            </select>
          )}</Field>
          <Field label="시작일">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn">배정</button>
        </div>
      </form>
    </Modal>
  );
}

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const RANGES = [
  { key: '1m', label: '최근 1개월', days: 31 },
  { key: '3m', label: '최근 3개월', days: 92 },
  { key: '6m', label: '최근 6개월', days: 183 }
];

function RangePicker({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="기간">
      {RANGES.map((r) => <button key={r.key} type="button" aria-pressed={value === r.key} onClick={() => onChange(r.key)}>{r.label}</button>)}
    </div>
  );
}

function useRange(initial, today) {
  const [range, setRange] = useState(initial);
  const days = RANGES.find((r) => r.key === range).days;
  return { range, setRange, start: addDays(today, -days), end: today };
}

const CONC = { A: 'A', B: 'B', C: 'C', D: 'D', ABSENT: '결석' };

/** Flip one lesson between 출석 and 결석. Other fields on that lesson stay put. */
function AttendanceSwitch({ lessonId, value, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const set = async (attendance) => {
    if (attendance === value || saving) return;
    setSaving(true);
    try {
      await api('updateLessonAttendance', { lesson_id: lessonId, attendance });
      toast(attendance === '결석' ? '결석으로 바꿨습니다.' : '출석으로 바꿨습니다.');
      await onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="chips" role="group" aria-label="출결">
      {['출석', '결석'].map((a) => (
        <button key={a} type="button" className={'chip' + (a === '결석' ? ' danger' : '')} aria-pressed={value === a} disabled={saving} onClick={() => set(a)}>{a}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 개요

export function OverviewTab({ data, onChanged }) {
  const { month, next, classes, exams, recent_notes: notes, counseling, open_tasks: tasks, today } = data;
  const s = data.student;
  const [changing, setChanging] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const upcoming = data.upcoming_classes || [];
  const done = () => { setChanging(null); setAssigning(false); onChanged(); };
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="다음 수업" value={next ? relativeDay(next.date, today) : '-'} note={next ? `${next.class_name} · ${shortDate(next.date)} ${timeSpan(next.time)}` : '예정된 수업 없음'} />
        <Kpi label="이번 달 출석률" value={percent(month.attendance_rate)} note={`수업 ${month.lesson_count}회 · 결석 ${month.absent_count}`} />
        <Kpi label="숙제 완료율" value={percent(month.homework_rate)} note="이번 달 체크 기준" />
        <Kpi label="테스트 평균" value={month.test_average_display} note={month.test_count ? `이번 달 ${month.test_count}회 · 100점 환산` : '이번 달 테스트 없음'} />
        <Kpi label="과제 이행 A 비율" value={percent(month.assignment_a_rate)} />
      </div>
      {exams.length ? (
        <section className="card">
          <div className="card-head"><h2>학교 시험</h2><Link className="link-btn" href="/exams">시험 일정</Link></div>
          <div className="stack-sm">
            {exams.map((x) => (
              <div key={x.school_exam_id} className="split" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>{x.label}</strong> <span className="muted">{x.school}</span>
                  <div className="prewrap">{[x.textbook, x.scope].filter(Boolean).join(' · ') || <span className="muted">범위 미입력</span>}</div>
                </div>
                <div>{formatDate(x.exam_date)} <span className={'tag ' + (x.d_day <= 7 ? 'danger' : x.d_day <= 21 ? 'amber' : '')}>{dDayLabel(x.d_day)}</span></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="cols-2">
        <section className="card">
          <div className="card-head"><h2>최근 특이사항</h2><Link className="link-btn" href="?tab=lessons" scroll={false}>수업 기록 전체</Link></div>
          {notes.length ? (
            <ul className="timeline">
              {notes.map((n) => (
                <li key={n.date + n.class_name}><div className="when">{shortDate(n.date)}<br />{n.class_name}</div><div className="what prewrap">{n.note}</div></li>
              ))}
            </ul>
          ) : <EmptyState>최근 수업 기록에 특이사항이 없습니다.</EmptyState>}
        </section>
        <section className="card">
          <div className="card-head"><h2>상담 · 후속 조치</h2><Link className="link-btn" href="?tab=counseling" scroll={false}>상담 전체</Link></div>
          {tasks.length ? (
            <div className="stack-sm" style={{ marginBottom: 12 }}>
              {tasks.map((t) => (
                <div key={t.task_id} className="split">
                  <span><span className={'tag ' + (t.due_date < today ? 'danger' : t.due_date === today ? 'amber' : '')}>{t.due_date === today ? '오늘' : shortDate(t.due_date)}</span> {t.title}</span>
                </div>
              ))}
            </div>
          ) : null}
          {counseling.length ? (
            <ul className="timeline">
              {counseling.map((n) => (
                <li key={n.note_id}><div className="when">{shortDate(n.counsel_date)}<br /><span className="tag muted">{n.kind}</span></div>
                  <div className="what"><strong>{n.title || '상담'}</strong><span className="muted prewrap">{n.content.length > 90 ? n.content.slice(0, 90) + '…' : n.content}</span></div></li>
              ))}
            </ul>
          ) : <EmptyState>상담 기록이 없습니다.</EmptyState>}
        </section>
      </div>
      <div className="cols-2">
        <section className="card">
          <div className="card-head">
            <h2>수강 중인 반{data.unassigned ? <span className="tag warn" style={{ marginLeft: 8 }}>미배정</span> : null}</h2>
            {s.status !== '퇴원' ? <button type="button" className="btn secondary sm" onClick={() => setAssigning(true)}>반 배정</button> : null}
          </div>
          {classes.length || upcoming.length ? (
            <div className="stack-sm">
              {classes.map((c) => (
                <div key={c.rel_id} className="split">
                  <span>
                    <Link href={`/classes/${c.class_id}`} style={{ fontWeight: 700 }}>{c.class_name}</Link>
                    {c.assignment_type === '임시' ? <span className="tag amber" style={{ marginLeft: 6 }}>시험대비 · {c.source_class_name}에서 이동 ~{shortDate(c.end_date)}</span> : null}
                  </span>
                  <span className="cluster">
                    <span className="muted">{c.schedule_label}</span>
                    {c.assignment_type !== '임시' ? <button type="button" className="btn ghost sm" onClick={() => setChanging(c)}>반 변경</button> : null}
                  </span>
                </div>
              ))}
              {upcoming.map((c) => (
                <div key={c.rel_id} className="split">
                  <span><Link href={`/classes/${c.class_id}`} style={{ fontWeight: 700 }}>{c.class_name}</Link> <span className="tag">{shortDate(c.start_date)}부터</span></span>
                  <button type="button" className="btn ghost sm" onClick={() => setChanging(c)}>반 변경</button>
                </div>
              ))}
            </div>
          ) : <EmptyState title="다니는 반이 없습니다" action={s.status !== '퇴원' ? <button type="button" className="btn" onClick={() => setAssigning(true)}>반 배정</button> : null}>
            {s.status === '재원' ? '재원생인데 반이 없어 미배정 상태입니다.' : null}
          </EmptyState>}
          {changing ? <ClassChangeDialog studentId={s.student_id} studentName={s.name} rel={changing} onClose={() => setChanging(null)} onDone={done} /> : null}
          {assigning ? <AssignClassModal studentId={s.student_id} exceptIds={[...classes, ...upcoming].map((c) => c.class_id)} onClose={() => setAssigning(false)} onDone={done} /> : null}
        </section>
        <section className="card">
          <h2>기본 정보</h2>
          <dl className="dl">
            <dt>학교</dt><dd>{s.school || <span className="tag warn">미입력 · 시험 일정과 연결되지 않음</span>}</dd>
            <dt>학생 연락처</dt><dd>{s.student_phone || '-'}</dd>
            <dt>학부모 연락처</dt><dd>{s.parent_phone ? <a href={`tel:${s.parent_phone}`}>{s.parent_phone}</a> : '-'}</dd>
            <dt>등록일</dt><dd>{s.enrollment_date || '-'}</dd>
            {s.memo ? <><dt>메모</dt><dd className="prewrap">{s.memo}</dd></> : null}
          </dl>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 출결 달력

const KIND = {
  present: { label: '출석', cls: 'att-present', mark: '●' },
  absent: { label: '결석', cls: 'att-absent', mark: '✕' },
  makeup: { label: '보강', cls: 'att-makeup', mark: '◆' },
  missing: { label: '미입력', cls: 'att-missing', mark: '?' },
  scheduled: { label: '예정', cls: 'att-scheduled', mark: '○' }
};

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function AttendanceTab({ studentId, today }) {
  const [ym, setYm] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(null);
  const state = useApi(() => api('getStudentAttendanceMonth', studentId, ym), [studentId, ym]);
  const [y, m] = ym.split('-').map(Number);
  return (
    <div className="stack">
      <div className="split">
        <div className="cluster">
          <button type="button" className="btn secondary sm" onClick={() => { setYm(shiftMonth(ym, -1)); setPicked(null); }} aria-label="이전 달">◀</button>
          <strong style={{ fontSize: 18 }}>{y}년 {m}월</strong>
          <button type="button" className="btn secondary sm" onClick={() => { setYm(shiftMonth(ym, 1)); setPicked(null); }} aria-label="다음 달">▶</button>
          {ym !== today.slice(0, 7) ? <button type="button" className="link-btn" onClick={() => setYm(today.slice(0, 7))}>이번 달</button> : null}
        </div>
        <div className="cluster att-legend" aria-label="범례">
          {Object.entries(KIND).map(([k, v]) => <span key={k} className={v.cls}><span aria-hidden="true">{v.mark}</span> {v.label}</span>)}
        </div>
      </div>
      <Async state={state}>
        {(d) => {
          const first = new Date(y, m - 1, 1).getDay();
          const lead = (first + 6) % 7;
          const cells = [...Array(lead).fill(null), ...d.days];
          const sel = picked && d.days.find((x) => x.date === picked);
          return (
            <>
              <div className="kpis">
                <Kpi label="출석률" value={percent(d.attendance_rate)} />
                <Kpi label="출석" value={d.counts.present} />
                <Kpi label="결석" value={d.counts.absent} tone={d.counts.absent ? 'red' : undefined} />
                <Kpi label="보강" value={d.counts.makeup} />
                <Kpi label="미입력" value={d.counts.missing} note="지난 수업일 중 기록 없음" tone={d.counts.missing ? 'terracotta' : undefined} />
              </div>
              <div className="att-grid" role="grid" aria-label={`${y}년 ${m}월 출결`}>
                {['월', '화', '수', '목', '금', '토', '일'].map((w) => <div key={w} className="att-head" role="columnheader">{w}</div>)}
                {cells.map((day, i) => day ? (
                  <button key={day.date} type="button" role="gridcell"
                    className={'att-cell' + (day.date === d.today ? ' is-today' : '') + (picked === day.date ? ' is-picked' : '') + (day.entries.length ? '' : ' is-empty')}
                    onClick={() => setPicked(day.entries.length ? day.date : null)}
                    aria-label={`${Number(day.date.slice(8))}일 ${day.entries.map((e) => KIND[e.kind].label).join(', ') || '수업 없음'}`}>
                    <span className="att-day">{Number(day.date.slice(8))}</span>
                    <span className="att-marks">
                      {day.entries.map((e, j) => <span key={j} className={KIND[e.kind].cls} title={`${e.class_name} ${KIND[e.kind].label}`}>{KIND[e.kind].mark}</span>)}
                    </span>
                  </button>
                ) : <div key={'pad' + i} className="att-cell is-pad" aria-hidden="true" />)}
              </div>
              {sel ? (
                <section className="card">
                  <h3>{formatDate(sel.date)}</h3>
                  <div className="stack-sm">
                    {sel.entries.map((e, j) => (
                      <div key={j} className="split" style={{ alignItems: 'flex-start' }}>
                        <span className="cluster" style={{ alignItems: 'center' }}>
                          {e.lesson_id ? <AttendanceSwitch lessonId={e.lesson_id} value={e.kind === 'absent' ? '결석' : '출석'} onSaved={state.reload} /> : <span className={'tag ' + (e.kind === 'absent' ? 'danger' : e.kind === 'missing' ? 'warn' : e.kind === 'makeup' ? 'amber' : e.kind === 'present' ? 'ok' : 'muted')}>{KIND[e.kind].label}</span>}
                          <strong>{e.class_name}</strong> {e.time ? <span className="muted">{timeSpan(e.time)}</span> : null}
                        </span>
                        <span className="muted">{[e.test && `테스트 ${e.test}`, e.test_scope && `범위 ${e.test_scope}`, e.assignment && `과제 ${e.assignment}`, e.concentration && e.kind === 'present' && `집중도 ${CONC[e.concentration] || e.concentration}`].filter(Boolean).join(' · ')}</span>
                        {e.special_note ? <div className="prewrap" style={{ flexBasis: '100%' }}>{e.special_note}</div> : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : <p className="muted" style={{ margin: 0 }}>날짜를 누르면 그날의 기록이 보이고, 기록된 수업의 출결만 바꿀 수 있습니다.</p>}
            </>
          );
        }}
      </Async>
    </div>
  );
}

// ---------------------------------------------------------------- 수업 기록

export function LessonsTab({ studentId }) {
  const boot = useBoot();
  const r = useRange('1m', boot.today);
  const state = useApi(() => api('getStudentLessons', studentId, r.start, r.end), [studentId, r.range]);
  const classNames = useMemo(() => Object.fromEntries((boot.search.classes || []).map((c) => [c.id, c.name])), [boot.search.classes]);
  return (
    <div className="stack">
      <div className="split"><span className="muted">출결만 여기서 바꿀 수 있습니다. 점수와 숙제는 그대로 둡니다.</span><RangePicker value={r.range} onChange={r.setRange} /></div>
      <Async state={state}>
        {(rows) => rows.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th>날짜</th><th>반</th><th>출결</th><th>테스트 (반 평균)</th><th className="center">과제</th><th className="center">집중도</th><th>진도 · 특이사항</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.lesson_id}>
                    <td className="primary">{shortDate(l.lesson_date)}</td>
                    <td data-label="반">{classNames[l.class_id] || l.class_id}</td>
                    <td data-label="출결"><AttendanceSwitch lessonId={l.lesson_id} value={l.attendance === '결석' ? '결석' : '출석'} onSaved={state.reload} /></td>
                    <td data-label="테스트">{l.test_status === '실시' ? <>{score(l.test_score)}/{l.test_max_score} <span className="muted">({l.class_test_average ? l.class_test_average.test_average_display : '-'})</span></> : <span className="muted">-</span>}{l.test_scope ? <div className="muted prewrap">범위: {l.test_scope}</div> : null}</td>
                    <td data-label="과제" className="center">{l.assignment_completion || '-'}</td>
                    <td data-label="집중도" className="center">{CONC[l.concentration] || l.concentration || '-'}</td>
                    <td data-label="진도 · 특이사항">
                      <span className="muted">{l.progress}</span>
                      {l.special_note ? <div className="prewrap"><strong>{l.special_note}</strong></div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card"><EmptyState title="이 기간에 수업 기록이 없습니다" /></div>}
      </Async>
    </div>
  );
}

// ---------------------------------------------------------------- 숙제

export function HomeworkTab({ studentId }) {
  const boot = useBoot();
  const toast = useToast();
  const r = useRange('1m', boot.today);
  const state = useApi(() => api('getStudentHomework', studentId, { start: r.start, end: r.end }), [studentId, r.range]);
  const [savingId, setSavingId] = useState('');

  const setStatus = async (row, item, status) => {
    if (!status || status === item.status || !item.item_id) return;
    setSavingId(item.item_id);
    try {
      await api('saveHomeworkChecks', {
        lesson_date: row.date,
        class_id: row.class_id,
        check_date: row.check_date,
        checks: [{ student_id: studentId, item_id: item.item_id, status }]
      });
      toast(status === '완료' ? `"${item.title}"을(를) 완료로 바꿨습니다.` : `"${item.title}"을(를) 미완료로 바꿨습니다.`);
      await state.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="stack">
      <div className="split"><span className="muted">수업일에 낸 숙제와 다음 수업에서 확인한 결과입니다. 완료 여부는 여기서 바로 고칠 수 있습니다.</span><RangePicker value={r.range} onChange={r.setRange} /></div>
      <Async state={state}>
        {(d) => (
          <>
            <div className="kpis">
              <Kpi label="완료율" value={percent(d.rate)} note={`확인한 숙제 ${d.checked}개`} />
              <Kpi label="미완료" value={`${d.missing.length}개`} tone={d.missing.length ? 'terracotta' : undefined} />
            </div>
            {d.missing.length ? (
              <section className="card">
                <h3>미완료 숙제</h3>
                <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
                  {d.missing.map((x, i) => <li key={i}>{shortDate(x.date)} · {x.class_name} — {x.title}</li>)}
                </ul>
              </section>
            ) : null}
            {d.rows.length ? (
              <div className="table-wrap">
                <table className="data-table stack-mobile">
                  <thead><tr><th>낸 날</th><th>반</th><th>숙제</th></tr></thead>
                  <tbody>
                    {d.rows.map((row) => (
                      <tr key={row.date + row.class_id}>
                        <td className="primary">{shortDate(row.date)}</td>
                        <td data-label="반">{row.class_name}</td>
                        <td data-label="숙제">
                          <div className="cluster" style={{ alignItems: 'center' }}>
                            {row.items.map((it) => {
                              const tone = it.status === '완료' ? 'ok' : it.status === '미완료' ? 'danger' : 'muted';
                              const busy = savingId === it.item_id;
                              return (
                                <label key={it.item_id || it.title} className={'tag ' + tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span>{it.title}{it.scope === 'student' ? ' · 개인' : ''}</span>
                                  <select
                                    aria-label={`${it.title} 완료 여부`}
                                    value={it.status === '미확인' ? '' : it.status}
                                    disabled={busy || !it.item_id}
                                    onChange={(e) => setStatus(row, it, e.target.value)}
                                    style={{ width: 'auto', minHeight: 28, padding: '2px 6px', fontSize: '0.85em' }}
                                  >
                                    {it.status === '미확인' ? <option value="">미확인</option> : null}
                                    <option value="완료">완료</option>
                                    <option value="미완료">미완료</option>
                                  </select>
                                </label>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="card"><EmptyState title="이 기간에 낸 숙제가 없습니다" /></div>}
          </>
        )}
      </Async>
    </div>
  );
}

// ---------------------------------------------------------------- 성적

export function GradesTab({ studentId }) {
  const boot = useBoot();
  const r = useRange('6m', boot.today);
  const state = useApi(() => api('getStudentGrades', studentId, { start: r.start, end: r.end }), [studentId, r.range]);
  return (
    <div className="stack">
      <div className="split"><span className="muted">그래프와 평균·최고·최저는 100점 환산입니다. 각 시험은 원점수이고, 막대의 세로선은 같은 날 반 평균입니다.</span><RangePicker value={r.range} onChange={r.setRange} /></div>
      <Async state={state}>
        {(d) => d.rows.length ? (
          <>
            <section className="card">
              <GradeTrend points={[...d.rows].reverse().map((t) => ({
                date: t.date,
                title: (t.title || t.class_name) + (t.own_paper ? ' (다른 시험지)' : ''),
                score: t.score_100,
                average: t.class_average_100,
                rank: t.rank,
                taken: t.taken
              }))} />
            </section>
            <div className="kpis">
              <Kpi label="응시" value={`${d.rows.length}회`} />
              <Kpi label="평균" value={score(d.stats.average)} note="100점 환산" />
              <Kpi label="최고" value={score(d.stats.high)} note="100점 환산" />
              <Kpi label="최저" value={score(d.stats.low)} note="100점 환산" />
            </div>
            <section className="card">
              <div className="stack-sm" role="list" aria-label="테스트별 점수">
                {d.rows.map((t) => {
                  const max = t.max_score || 100;
                  return (
                    <div key={t.date + t.class_id} role="listitem" className="grade-row">
                      <div className="grade-meta"><strong>{shortDate(t.date)}</strong> <span className="muted">{t.title || t.class_name}{t.difficulty ? ` · ${t.difficulty}` : ''}{t.scope && !t.own_paper ? ` · 범위 ${t.scope}` : ''}</span>{t.own_paper ? <> <span className="tag">다른 시험지</span></> : null}</div>
                      <div className="score-bar">
                        <span className="track" aria-hidden="true" style={{ position: 'relative' }}>
                          <span className="fill" style={{ width: `${Math.min(100, (t.score / max) * 100)}%`, display: 'block' }} />
                          {t.class_average !== null ? <span className="avg-tick" style={{ left: `${Math.min(100, (t.class_average / max) * 100)}%` }} /> : null}
                        </span>
                        <span className="val">{score(t.score)}/{max}{t.normalized !== null && t.normalized !== undefined ? <span className="muted"> · 환산 {score(t.normalized)}</span> : null}</span>
                        {t.rank != null ? <span className="grade-rank">{t.rank}등 / {t.taken}명</span> : null}
                      </div>
                      <div className="muted grade-avg">{t.own_paper ? '같은 시험지 평균' : '반 평균'} {score(t.class_average)}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : <div className="card"><EmptyState title="이 기간에 본 테스트가 없습니다" /></div>}
      </Async>
    </div>
  );
}

// ---------------------------------------------------------------- 보고서

function CopyButton({ text }) {
  const toast = useToast();
  return (
    <button type="button" className="btn secondary sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.', 'error'))}>복사</button>
  );
}

function DailyReportModal({ lessonId, onClose }) {
  const state = useApi(() => api('generateDailyReport', lessonId), [lessonId]);
  return (
    <Modal title="일일 보고서" onClose={onClose} footer={state.data ? <CopyButton text={state.data.text} /> : null}>
      <Async state={state}>{(d) => <pre className="report-text">{d.text}</pre>}</Async>
    </Modal>
  );
}

export function ReportsTab({ studentId }) {
  const state = useApi(() => api('getStudentReports', studentId), [studentId]);
  const [openMonthly, setOpenMonthly] = useState(null);
  const [daily, setDaily] = useState(null);
  return (
    <Async state={state}>
      {(d) => (
        <div className="cols-2">
          <section className="card">
            <div className="card-head"><h2>월간 보고서</h2><Link className="link-btn" href="/reports">보고서 화면</Link></div>
            {d.monthly.length ? (
              <div className="stack-sm">
                {d.monthly.map((r) => (
                  <div key={r.monthly_report_id}>
                    <div className="split">
                      <button type="button" className="link-btn" aria-expanded={openMonthly === r.monthly_report_id}
                        onClick={() => setOpenMonthly(openMonthly === r.monthly_report_id ? null : r.monthly_report_id)}>{r.year}년 {r.month}월</button>
                      <span className="cluster"><span className={'tag ' + (r.status === '확정' ? 'ok' : 'muted')}>{r.status}</span><CopyButton text={r.report_text} /></span>
                    </div>
                    {openMonthly === r.monthly_report_id ? <pre className="report-text">{r.report_text}</pre> : null}
                  </div>
                ))}
              </div>
            ) : <EmptyState title="저장된 월간 보고서가 없습니다">보고서 화면에서 반 단위로 한 번에 만들 수 있습니다.</EmptyState>}
          </section>
          <section className="card">
            <h2>일일 보고서</h2>
            {d.lessons.length ? (
              <div className="stack-sm">
                {d.lessons.map((l) => (
                  <div key={l.lesson_id} className="split">
                    <span>{shortDate(l.date)} <span className="muted">{l.class_name}</span> {l.attendance === '결석' ? <span className="tag danger">결석</span> : null}</span>
                    <button type="button" className="btn secondary sm" onClick={() => setDaily(l.lesson_id)}>보고서 보기</button>
                  </div>
                ))}
              </div>
            ) : <EmptyState>수업 기록이 없습니다.</EmptyState>}
          </section>
          {daily ? <DailyReportModal lessonId={daily} onClose={() => setDaily(null)} /> : null}
        </div>
      )}
    </Async>
  );
}

// ---------------------------------------------------------------- 반 이력

/** Change when a regular assignment starts. Shows the check result before saving. */
function StartDateModal({ rel, onClose, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState(rel.start_date || '');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pick = (v) => { setDate(v); setPreview(null); setError(''); };
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      // First press checks; a second press saves once the warning was shown.
      if (!preview) {
        const p = await api('previewClassStartChange', { id: rel.id, start_date: date });
        if (p.problem) return setError(p.problem);
        if (p.missing_count) return setPreview(p);
      }
      setSaving(true);
      await api('updateStudentClassStart', { id: rel.id, start_date: date });
      toast('반 배정 시작일을 바꿨습니다.');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`${rel.class_name} 시작일 수정`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="시작일" hint="이 날부터 수업 기록 명단에 나옵니다.">{(id) => <input id={id} type="date" value={date} onChange={(e) => pick(e.target.value)} />}</Field>
        {preview ? (
          <div className="notice-bar" role="status">
            {preview.missing_count}일치 수업에 이 학생 기록이 없습니다({preview.missing_dates.map(shortDate).join(', ')}). 저장하면 그 날짜 명단에 &lsquo;미기록&rsquo;으로 나옵니다.
          </div>
        ) : null}
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving || !date || date === rel.start_date}>{preview ? '그래도 저장' : '저장'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function HistoryTab({ studentId }) {
  const state = useApi(() => api('getStudent', studentId), [studentId]);
  const [editing, setEditing] = useState(null);
  return (
    <Async state={state}>
      {(s) => s.class_history.length ? (
        <div className="table-wrap">
          <table className="data-table stack-mobile">
            <thead><tr><th>반</th><th>기간</th><th>구분</th><th>상태</th><th /></tr></thead>
            <tbody>
              {s.class_history.map((h) => (
                <tr key={h.id}>
                  <td className="primary"><Link href={`/classes/${h.class_id}`}>{h.class_name}</Link></td>
                  <td data-label="기간">{h.start_date || '?'} ~ {h.end_date || '현재'}</td>
                  <td data-label="구분">{h.assignment_type === '임시' ? <span className="tag amber">시험대비 임시</span> : <span className="tag muted">정규</span>}</td>
                  <td data-label="상태">{h.status === '현재' ? <span className="tag ok">수강 중</span> : h.status === '임시' ? <span className="tag amber">임시</span> : <span className="tag muted">종료</span>}</td>
                  <td className="right">{h.status !== '임시' ? <button type="button" className="btn ghost sm" onClick={() => setEditing(h)}>시작일 수정</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {editing ? <StartDateModal rel={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); state.reload(); }} /> : null}
        </div>
      ) : <div className="card"><EmptyState title="반 배정 이력이 없습니다" /></div>}
    </Async>
  );
}
