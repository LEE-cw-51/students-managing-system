'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Async, EmptyState, Kpi } from '@/components/ui/Feedback';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, percent, relativeDay, score, shortDate, timeSpan } from '@/lib/format';
import { dDayLabel } from '@/lib/term';

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

// ---------------------------------------------------------------- 개요

export function OverviewTab({ data }) {
  const { month, next, classes, exams, recent_notes: notes, counseling, open_tasks: tasks, today } = data;
  const s = data.student;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="다음 수업" value={next ? relativeDay(next.date, today) : '-'} note={next ? `${next.class_name} · ${shortDate(next.date)} ${timeSpan(next.time)}` : '예정된 수업 없음'} />
        <Kpi label="이번 달 출석률" value={percent(month.attendance_rate)} note={`수업 ${month.lesson_count}회 · 결석 ${month.absent_count}`} />
        <Kpi label="숙제 완료율" value={percent(month.homework_rate)} note="이번 달 체크 기준" />
        <Kpi label="테스트 평균" value={month.test_average_display} note={`이번 달 ${month.test_count}회`} />
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
          <h2>수강 중인 반</h2>
          {classes.length ? (
            <div className="stack-sm">
              {classes.map((c) => (
                <div key={c.rel_id} className="split">
                  <span>
                    <Link href={`/classes/${c.class_id}`} style={{ fontWeight: 700 }}>{c.class_name}</Link>
                    {c.assignment_type === '임시' ? <span className="tag amber" style={{ marginLeft: 6 }}>시험대비 · {c.source_class_name}에서 이동 ~{shortDate(c.end_date)}</span> : null}
                  </span>
                  <span className="muted">{c.schedule_label}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="수강 중인 반이 없습니다">반 화면의 학생 탭에서 배정하세요.</EmptyState>}
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
                        <span><span className={'tag ' + (e.kind === 'absent' ? 'danger' : e.kind === 'missing' ? 'warn' : e.kind === 'makeup' ? 'amber' : e.kind === 'present' ? 'ok' : 'muted')}>{KIND[e.kind].label}</span> <strong>{e.class_name}</strong> {e.time ? <span className="muted">{timeSpan(e.time)}</span> : null}</span>
                        <span className="muted">{[e.test && `테스트 ${e.test}`, e.assignment && `과제 ${e.assignment}`, e.concentration && e.kind === 'present' && `집중도 ${CONC[e.concentration] || e.concentration}`].filter(Boolean).join(' · ')}</span>
                        {e.special_note ? <div className="prewrap" style={{ flexBasis: '100%' }}>{e.special_note}</div> : null}
                      </div>
                    ))}
                  </div>
                </section>
              ) : <p className="muted" style={{ margin: 0 }}>날짜를 누르면 그날의 수업 기록이 보입니다.</p>}
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
      <div className="split"><span className="muted">수업일별 출결·테스트·과제·집중도와 특이사항입니다.</span><RangePicker value={r.range} onChange={r.setRange} /></div>
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
                    <td data-label="출결">{l.attendance === '결석' ? <span className="tag danger">결석</span> : <span className="tag ok">출석</span>}</td>
                    <td data-label="테스트">{l.test_status === '실시' ? <>{score(l.test_score)}/{l.test_max_score} <span className="muted">({l.class_test_average ? l.class_test_average.test_average_display : '-'})</span></> : <span className="muted">-</span>}</td>
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
  const r = useRange('1m', boot.today);
  const state = useApi(() => api('getStudentHomework', studentId, { start: r.start, end: r.end }), [studentId, r.range]);
  return (
    <div className="stack">
      <div className="split"><span className="muted">수업일에 낸 숙제와 다음 수업에서 확인한 결과입니다.</span><RangePicker value={r.range} onChange={r.setRange} /></div>
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
                          <div className="cluster">
                            {row.items.map((it, i) => (
                              <span key={i} className={'tag ' + (it.status === '완료' ? 'ok' : it.status === '미완료' ? 'danger' : 'muted')}>
                                {it.status === '완료' ? '✓' : it.status === '미완료' ? '✕' : '·'} {it.title}
                              </span>
                            ))}
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
      <div className="split"><span className="muted">본 테스트와 같은 날 반 평균입니다. 막대의 세로선이 반 평균입니다.</span><RangePicker value={r.range} onChange={r.setRange} /></div>
      <Async state={state}>
        {(d) => d.rows.length ? (
          <>
            <div className="kpis">
              <Kpi label="응시" value={`${d.rows.length}회`} />
              <Kpi label="평균" value={d.comparable ? score(d.stats.average) : '만점 다름'} />
              <Kpi label="최고" value={d.comparable ? score(d.stats.high) : '-'} />
              <Kpi label="최저" value={d.comparable ? score(d.stats.low) : '-'} />
            </div>
            <section className="card">
              <div className="stack-sm" role="list" aria-label="테스트별 점수">
                {d.rows.map((t) => {
                  const max = t.max_score || 100;
                  return (
                    <div key={t.date + t.class_id} role="listitem" className="grade-row">
                      <div className="grade-meta"><strong>{shortDate(t.date)}</strong> <span className="muted">{t.title || t.class_name}{t.difficulty ? ` · ${t.difficulty}` : ''}</span></div>
                      <div className="score-bar">
                        <span className="track" aria-hidden="true" style={{ position: 'relative' }}>
                          <span className="fill" style={{ width: `${Math.min(100, (t.score / max) * 100)}%`, display: 'block' }} />
                          {t.class_average !== null ? <span className="avg-tick" style={{ left: `${Math.min(100, (t.class_average / max) * 100)}%` }} /> : null}
                        </span>
                        <span className="val">{score(t.score)}/{max}</span>
                      </div>
                      <div className="muted grade-avg">반 평균 {score(t.class_average)} · {t.rank}/{t.taken}등</div>
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

export function HistoryTab({ studentId }) {
  const state = useApi(() => api('getStudent', studentId), [studentId]);
  return (
    <Async state={state}>
      {(s) => s.class_history.length ? (
        <div className="table-wrap">
          <table className="data-table stack-mobile">
            <thead><tr><th>반</th><th>기간</th><th>구분</th><th>상태</th></tr></thead>
            <tbody>
              {s.class_history.map((h) => (
                <tr key={h.id}>
                  <td className="primary"><Link href={`/classes/${h.class_id}`}>{h.class_name}</Link></td>
                  <td data-label="기간">{h.start_date || '?'} ~ {h.end_date || '현재'}</td>
                  <td data-label="구분">{h.assignment_type === '임시' ? <span className="tag amber">시험대비 임시</span> : <span className="tag muted">정규</span>}</td>
                  <td data-label="상태">{h.status === '현재' ? <span className="tag ok">수강 중</span> : h.status === '임시' ? <span className="tag amber">임시</span> : <span className="tag muted">종료</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card"><EmptyState title="반 배정 이력이 없습니다" /></div>}
    </Async>
  );
}
