'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Async, EmptyState, Kpi } from '@/components/ui/Feedback';
import Modal from '@/components/ui/Modal';
import Field from '@/components/ui/Field';
import MiniBars from '@/components/ui/MiniBars';
import { useToast } from '@/components/ui/Toast';
import { SelectAllCheckbox, useSelection } from '@/components/ui/useSelection';
import { useBoot } from '@/components/shell/AppShell';
import ClassChangeDialog, { openRegularClasses } from '@/components/domain/student/ClassChangeDialog';
import { api, useApi } from '@/lib/client-api';
import { formatDate, percent, relativeDay, score, shortDate, timeSpan } from '@/lib/format';
import { dDayLabel } from '@/lib/term';

function textbookLine(cls) {
  const history = Array.isArray(cls.textbook_history) ? cls.textbook_history : [];
  const past = history.filter((h) => h && h.to);
  return (
    <>
      {cls.textbook || '-'}
      {past.length ? <div className="muted">{past.map((h) => `${h.textbook} (${h.from || '시작일 없음'} ~ ${h.to})`).join(' · ')}</div> : null}
    </>
  );
}

function ExamNotice({ exam }) {
  if (!exam || !exam.period) return null;
  const p = exam.period;
  const range = `${shortDate(p.start_date)} ~ ${shortDate(p.end_date)}`;
  if (exam.kind === 'suspended') return <div className="notice-bar">시험대비 기간({p.title}, {range})이라 이 반은 휴강 중입니다. 학생들은 시험대비 반에서 수업하고, 시험이 끝난 학생부터 돌아옵니다({exam.resume_date ? `첫 복귀 ${shortDate(exam.resume_date)}` : '기간이 끝나면 복귀'}).</div>;
  if (exam.kind === 'upcoming') return <div className="notice-bar">{p.title} 시험대비 기간({range})이 시작되면 휴강하고, 시험이 끝난 학생부터 돌아와 수업합니다{exam.resume_date ? `(첫 복귀 ${shortDate(exam.resume_date)})` : ''}.</div>;
  if (exam.kind === 'exam_class') return <div className="notice-bar">{p.title} 시험대비 반입니다 ({range}). 기간이 끝나면 학생들은 원래 반으로 돌아갑니다.</div>;
  return null;
}

// ---------------------------------------------------------------- 개요

export function OverviewTab({ data }) {
  const { class: cls, month, next, recent, plans, roster, today } = data;
  return (
    <div className="stack">
      <ExamNotice exam={data.exam} />
      <div className="kpis sd-kpis">
        <Kpi label="다음 수업" value={next ? relativeDay(next.date, today) : '-'} note={next ? `${shortDate(next.date)} ${timeSpan(next.time)}` : '예정된 수업 없음'} />
        <Kpi label="학생" value={`${roster.length}명`} />
        <Kpi label="이번 달 출석률" value={percent(month.attendance_rate)} note={`수업 ${month.lesson_count}회`} />
        <Kpi label="숙제 완료율" value={percent(month.homework_rate)} note="이번 달 체크 기준" />
        <Kpi label="테스트 평균" value={month.test_average_display} note="이번 달 · 만점 같은 테스트만" />
      </div>
      {data.exams && data.exams.length ? <UpcomingExams exams={data.exams} /> : null}
      <div className="cols-2">
        <section className="card">
          <div className="card-head">
            <h2>최근 수업</h2>
            <Link className="link-btn" href="?tab=lessons" scroll={false}>수업 계획·기록</Link>
          </div>
          {recent.length ? (
            <ul className="timeline">
              {recent.map((r) => (
                <li key={r.date}>
                  <div className="when">{shortDate(r.date)}<br />{r.roster_count ? `출석 ${r.present_count}/${r.roster_count}` : ''}</div>
                  <div className="what">
                    <strong>{r.progress || <span className="muted">진도 미입력</span>}</strong>
                    {r.test_title || r.test_scope ? <span className="muted">테스트: {r.test_title || '테스트'}{r.test_max_score ? ` (${r.test_max_score}점 만점)` : ''}{r.test_scope ? ` · 범위 ${r.test_scope}` : ''}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="아직 수업 기록이 없습니다">‘수업 기록하기’로 첫 수업을 기록하세요.</EmptyState>}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>강의 계획</h2>
            <Link className="link-btn" href="?tab=lessons" scroll={false}>계획 관리</Link>
          </div>
          <div className="stack-sm">
            {next ? <PlanLine label={`다음 수업 ${shortDate(next.date)}`} plan={plans.next_day} /> : null}
            <PlanLine label="이번 주" plan={plans.week} />
            <PlanLine label="이번 달" plan={plans.month} />
          </div>
          <dl className="dl cd-unit">
            <dt>지금 단원</dt>
            <dd>{data.current_unit
              ? (data.current_unit.all_done ? '단원 목록을 모두 마쳤습니다' : `${data.current_unit.title}${data.current_unit.sessions > 1 ? ` (${data.current_unit.index}/${data.current_unit.sessions}회차)` : ''}`)
              : (cls.current_progress || <span className="muted">정보 수정에서 단원 목록을 넣으면 표시됩니다</span>)}</dd>
            <dt>교재</dt><dd>{textbookLine(cls)}</dd>
          </dl>
        </section>
      </div>
      <section className="card">
        <div className="card-head">
          <h2>학생 {roster.length}명</h2>
          <Link className="link-btn" href="?tab=students" scroll={false}>배정 관리</Link>
        </div>
        {roster.length ? (
          <div className="roster-chips">
            {roster.map((s) => <Link key={s.student_id} href={`/students/${s.student_id}`}>{s.name}{s.school ? <span className="muted"> · {s.school}</span> : null}</Link>)}
          </div>
        ) : <EmptyState title="배정된 학생이 없습니다">학생 탭에서 학생을 배정하세요.</EmptyState>}
      </section>
    </div>
  );
}

function UpcomingExams({ exams }) {
  return (
    <section className="card sd-exams">
      <h2>학교 시험</h2>
      <ul className="sd-exam-list">
        {exams.map((x) => (
          <li key={x.school_exam_id}>
            <strong>{x.school} {x.grade}</strong>
            <span className="muted">{x.label}</span>
            <span>{shortDate(x.exam_date)} <span className={'tag ' + (x.d_day <= 7 ? 'danger' : x.d_day <= 21 ? 'amber' : '')}>{dDayLabel(x.d_day)}</span></span>
            <span className="sd-line-text">{[x.textbook, x.scope].filter(Boolean).join(' · ') || <span className="muted">범위 미입력</span>}</span>
            <details className="cd-exam-students">
              <summary>{x.students.length}명</summary>
              <span>{x.students.map((s) => s.name).join(', ')}</span>
            </details>
          </li>
        ))}
      </ul>
      <Link className="btn secondary sm" href="/exams">시험 일정</Link>
    </section>
  );
}

function PlanLine({ label, plan }) {
  return (
    <div className="split" style={{ alignItems: 'flex-start' }}>
      <span className="tag muted">{label}</span>
      <div style={{ flex: 1 }}>
        {plan ? (
          <>
            <strong>{plan.title || plan.objectives || '제목 없음'}</strong>
            {plan.content ? <div className="muted prewrap">{plan.content.length > 120 ? plan.content.slice(0, 120) + '…' : plan.content}</div> : null}
          </>
        ) : <span className="muted">작성된 계획이 없습니다.</span>}
      </div>
    </div>
  );
}

const RANGES = [
  { key: '1m', label: '최근 1개월', days: 31 },
  { key: '3m', label: '3개월', days: 92 },
  { key: '6m', label: '6개월', days: 183 }
];

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function RangePicker({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="기간">
      {RANGES.map((r) => <button key={r.key} type="button" aria-pressed={value === r.key} onClick={() => onChange(r.key)}>{r.label}</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- 숙제

function gradeTone(letter) {
  if (!letter) return 'unchecked';
  return letter === 'A' || letter === 'B' ? 'full' : letter === 'E' || letter === 'F' ? 'none' : 'part';
}

function HwCell({ cell, who, open, onToggle }) {
  if (!cell) return <span className="muted">-</span>;
  const text = cell.checked ? cell.letter : '미입력';
  return (
    <button type="button" className={'hw-cell ' + gradeTone(cell.checked ? cell.letter : '')} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${who} ${text}, 항목별 등급 보기`} onClick={(e) => onToggle(e.currentTarget)}>{text}</button>
  );
}

/** Per-item grades of one cell; opened by click, Enter or touch, closed by Escape, a click outside or scrolling. */
function GradePopover({ anchor, title, cell, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    if (pos) ref.current.focus({ preventScroll: true });
  }, [pos]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      anchor.focus();
    };
    const onDown = (e) => {
      if (ref.current.contains(e.target) || anchor.contains(e.target)) return;
      onClose();
    };
    const onScroll = (e) => { if (!ref.current.contains(e.target)) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  const onBlur = (e) => {
    if (e.relatedTarget && (ref.current.contains(e.relatedTarget) || e.relatedTarget === anchor)) return;
    onClose();
  };
  return (
    <div className="hw-pop" role="dialog" aria-label={title} ref={ref} tabIndex={-1} onBlur={onBlur}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      <strong>{title}</strong>
      {cell.replace_class ? <span className="hint">반 숙제 제외 · 개인 숙제만</span> : null}
      <ul>
        {(cell.grades || []).map((g, i) => (
          <li key={i}><span>{g.title}</span><span className={'hw-cell ' + gradeTone(g.grade)}>{g.grade || '미입력'}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** The lesson after each assignment date, where its grades were entered (or will be). */
function checkDates(rows, meetings) {
  const sorted = meetings.slice().sort();
  return Object.fromEntries(rows.map((r) => [r.date, sorted.find((d) => d > r.date) || '']));
}

export function HomeworkTab({ classId }) {
  const { today } = useBoot();
  const [range, setRange] = useState('1m');
  const [open, setOpen] = useState(null);
  const days = RANGES.find((r) => r.key === range).days;
  const start = addDays(today, -days);
  const state = useApi(() => api('getClassHomeworkLog', classId, { start, end: today }), [classId, range, today]);
  const lessons = useApi(() => api('getClassProgressLog', classId, { start, end: addDays(today, 28) }), [classId, range, today]);
  const checkedOn = useMemo(() => (state.data && lessons.data ? checkDates(state.data.rows, lessons.data.rows.map((r) => r.date)) : {}), [state.data, lessons.data]);
  const closePop = useCallback(() => setOpen(null), []);
  const toggle = (key, anchor, title, cell) => setOpen((o) => (o && o.key === key ? null : { key, anchor, title, cell }));
  const checkLink = (date) => {
    const d = checkedOn[date];
    if (!d || d > today) return null;
    return <Link className="link-btn" href={`/today?class=${classId}&date=${d}`}>확인한 수업 →</Link>;
  };
  return (
    <div className="stack">
      <div className="split">
        <RangePicker value={range} onChange={(v) => { setOpen(null); setRange(v); }} />
        <span className="muted hw-legend desktop-only">A·B 완료 · C·D 일부 · E·F 안 함 · 미입력 = 아직 확인 안 함</span>
      </div>
      <Async state={state}>
        {(data) => data.rows.length ? (
          <>
            <div className="table-wrap hw-matrix-wrap">
              <table className="data-table hw-matrix">
                <thead>
                  <tr>
                    <th className="sticky">숙제 (낸 날)</th>
                    <th className="num">완료율</th>
                    {data.students.map((s) => <th key={s.student_id} className="student"><Link href={`/students/${s.student_id}`}>{s.name}</Link></th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.date}>
                      <td className="sticky">
                        <strong>{shortDate(r.date)}</strong>
                        <div className="muted">{r.items.map((it) => it.title).join(' · ')}</div>
                      </td>
                      <td className="num">{r.checked ? percent(r.rate) : <span className="muted">확인 전</span>}</td>
                      {data.students.map((s) => {
                        const key = `${r.date}|${s.student_id}`;
                        const cell = r.cells[s.student_id];
                        const title = `${s.name} · ${shortDate(r.date)} 숙제`;
                        return (
                          <td key={s.student_id} className="student">
                            <HwCell cell={cell} who={`${s.name} ${shortDate(r.date)}`} open={!!open && open.key === key} onToggle={(el) => toggle(key, el, title, cell)} />
                          </td>
                        );
                      })}
                      <td className="hw-check">{r.checked ? checkLink(r.date) : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="hw-cards">
              {data.rows.map((r) => {
                const cells = data.students.map((s) => ({ s, cell: r.cells[s.student_id] })).filter((x) => x.cell);
                const missing = cells.filter((x) => !x.cell.checked || gradeTone(x.cell.letter) !== 'full');
                return (
                  <li key={r.date} className="hw-card">
                    <div className="hw-card-head"><strong>{shortDate(r.date)} 낸 숙제</strong><span className="muted">{r.checked ? `완료율 ${percent(r.rate)}` : '확인 전'}</span></div>
                    {r.items.length ? <span className="muted">{r.items.map((it) => it.title).join(' · ')}</span> : null}
                    {r.checked ? (
                      <>
                        {missing.length ? (
                          <div className="hw-card-missing">
                            <span className="hint">안 함 · 일부 · 미입력</span>
                            {missing.map(({ s, cell }) => (
                              <Link key={s.student_id} href={`/students/${s.student_id}?tab=homework`}>{s.name} <span className={'hw-cell ' + gradeTone(cell.checked ? cell.letter : '')}>{cell.checked ? cell.letter : '미입력'}</span></Link>
                            ))}
                          </div>
                        ) : null}
                        <span>완료(A·B) {cells.length - missing.length}명</span>
                        {checkLink(r.date)}
                      </>
                    ) : <span className="muted">다음 수업에서 확인합니다.</span>}
                  </li>
                );
              })}
            </ul>
            {open ? <GradePopover anchor={open.anchor} title={open.title} cell={open.cell} onClose={closePop} /> : null}
          </>
        ) : <div className="card"><EmptyState title="이 기간에 낸 숙제가 없습니다">수업 기록 화면에서 오늘 낼 숙제를 입력하면 여기에 쌓입니다.</EmptyState></div>}
      </Async>
    </div>
  );
}

// ---------------------------------------------------------------- 테스트 기록

function TestDetail({ classId, date, onClose }) {
  const state = useApi(() => api('getClassTestDetail', classId, date), [classId, date]);
  return (
    <Modal title={`${formatDate(date)} 테스트`} onClose={onClose}>
      <Async state={state}>
        {(d) => (
          <div className="stack">
            {d.papers.map((p) => {
              const max = (p.own ? p.max : Number(d.session.test_max_score) || p.max) || Math.max(1, ...p.rows.map((r) => r.max_score || 0));
              return (
                <section className="stack" key={p.key} aria-label={p.title || (p.own ? '다른 시험지' : '반 테스트')}>
                  <div className="cluster">
                    {p.own ? <span className="tag">다른 시험지</span> : null}
                    {p.title ? <strong>{p.title}</strong> : null}
                    <span className="tag muted">만점 {max}</span>
                    {!p.own && d.session.test_scope ? <span className="muted">범위 {d.session.test_scope}</span> : null}
                    {p.difficulty ? <span className="tag muted">난이도 {p.difficulty}</span> : null}
                  </div>
                  <div className="kpis">
                    <Kpi label="응시" value={`${p.stats.count}명`} />
                    <Kpi label="평균" value={score(p.stats.average)} />
                    <Kpi label="최고" value={score(p.stats.high)} />
                    <Kpi label="최저" value={score(p.stats.low)} />
                  </div>
                  <div className="stack-sm" role="list" aria-label="학생별 점수">
                    {p.rows.map((r) => (
                      <div className="score-bar" role="listitem" key={r.student_id}>
                        <span className="score-who">
                          <Link href={`/students/${r.student_id}`}>{r.name}</Link>
                          {r.rank != null ? <span className="grade-rank">{r.rank}등 / {p.stats.count}명</span> : null}
                        </span>
                        {r.score === null ? (
                          <span className="muted">{r.attendance === '결석' ? '결석' : '미응시'}</span>
                        ) : (
                          <>
                            <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${Math.min(100, (r.score / max) * 100)}%`, display: 'block' }} /></span>
                            <span className="val">{score(r.score)}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Async>
    </Modal>
  );
}

export function TestsTab({ classId }) {
  const { today } = useBoot();
  const [range, setRange] = useState('3m');
  const [open, setOpen] = useState(null);
  const days = RANGES.find((r) => r.key === range).days;
  const state = useApi(() => api('getClassTests', classId, { start: addDays(today, -days), end: today }), [classId, range, today]);
  return (
    <div className="stack">
      <div className="split">
        <RangePicker value={range} onChange={setRange} />
        <span className="muted desktop-only">줄을 누르면 학생별 점수</span>
      </div>
      <Async state={state}>
        {(data) => data.rows.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th>날짜</th><th>테스트</th><th className="num">만점</th><th className="num">응시</th><th className="num">평균</th><th className="num">최고</th><th className="num">최저</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.date} className="clickable" onClick={() => setOpen(r.date)}>
                    <td className="primary">{shortDate(r.date)}</td>
                    <td data-label="테스트"><button type="button" className="link-btn" onClick={(e) => { e.stopPropagation(); setOpen(r.date); }}>{r.title || '테스트'}</button>{r.difficulty ? <span className="muted"> · {r.difficulty}</span> : null}{r.other_paper_count ? <span className="muted"> + 다른 시험지 {r.other_paper_count}명</span> : null}{r.scope ? <div className="muted prewrap">범위: {r.scope}</div> : null}</td>
                    <td data-label="만점" className="num">{r.max_score || '-'}</td>
                    <td data-label="응시" className="num">{r.taken_count}{r.not_taken_count ? <span className="muted"> / {r.taken_count + r.not_taken_count}</span> : null}</td>
                    <td data-label="평균" className="num"><strong>{score(r.average)}</strong></td>
                    <td data-label="최고" className="num">{score(r.high)}</td>
                    <td data-label="최저" className="num">{score(r.low)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card"><EmptyState title="이 기간에 본 테스트가 없습니다">수업 기록에서 테스트 점수를 입력하면 여기에 정리됩니다.</EmptyState></div>}
      </Async>
      {open ? <TestDetail classId={classId} date={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- 학생

function AssignModal({ classId, members, onClose, onDone }) {
  const boot = useBoot();
  const toast = useToast();
  const inClass = new Set([...members.current, ...members.upcoming].map((m) => m.student_id));
  // Students without a class come first: they are usually the ones waiting for one.
  const candidates = (boot.search.students || []).filter((s) => s.status === '재원' && !inClass.has(s.id))
    .sort((a, b) => (a.classes.length ? 1 : 0) - (b.classes.length ? 1 : 0) || a.name.localeCompare(b.name, 'ko'));
  const classNames = Object.fromEntries((boot.search.classes || []).map((c) => [c.id, c.name]));
  const [chosenMode, setMode] = useState('add');
  const [fromChoice, setFromClass] = useState('');
  const [date, setDate] = useState(boot.today);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const visible = candidates.filter((s) => !filter || s.name.includes(filter) || s.school.includes(filter));
  const sel = useSelection(visible.map((s) => s.id));
  const picked = candidates.filter((s) => sel.selected.has(s.id));
  const anyInClass = picked.some((s) => (s.class_ids || []).length);
  const mode = anyInClass ? chosenMode : 'add';
  // One student in two or more classes: ask which class they leave, as before.
  const single = picked.length === 1 && (picked[0].class_ids || []).length > 1 ? picked[0] : null;
  const fromClass = single && single.class_ids.includes(fromChoice) ? fromChoice : '';
  const multiClassCount = picked.filter((s) => (s.class_ids || []).length > 1).length;

  const toggle = (id) => { sel.toggle(id); setFromClass(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (!picked.length) return setError('학생을 선택해 주세요.');
    if (mode === 'move' && single && !fromClass) return setError('어느 반에서 옮길지 골라 주세요.');
    setSaving(true);
    setError('');
    try {
      if (mode === 'move' && single) {
        await api('moveStudent', { student_id: single.id, class_id: classId, start_date: date, from_class_id: fromClass });
        toast(`${single.name} 학생을 옮겼습니다.`);
      } else {
        const res = await api('assignStudentsToClass', { class_id: classId, student_ids: picked.map((s) => s.id), start_date: date, mode });
        toast(mode === 'move' ? `${res.count}명을 이 반으로 옮겼습니다.` : `${res.count}명을 배정했습니다.`);
      }
      boot.refresh();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="학생 배정" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="학생 찾기">{(id) => <input id={id} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="이름 또는 학교" />}</Field>
        <div className="split">
          <label className="check-label"><SelectAllCheckbox sel={sel} label="검색 결과 전체 선택" /> 검색 결과 전체 선택</label>
          <span className="muted" aria-live="polite">{picked.length}명 선택됨</span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
          <table className="data-table">
            <tbody>
              {visible.length ? visible.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => toggle(s.id)} aria-selected={sel.selected.has(s.id)}
                  style={sel.selected.has(s.id) ? { background: 'var(--navy-soft)' } : undefined}>
                  <td className="check-col"><input type="checkbox" checked={sel.selected.has(s.id)} onChange={() => toggle(s.id)} onClick={(e) => e.stopPropagation()} aria-label={`${s.name} 선택`} /></td>
                  <td><strong>{s.name}</strong> <span className="muted">{s.grade} · {s.school || '학교 미입력'}</span></td>
                  <td>{s.classes.length ? <span className="muted">{s.classes.join(', ')}</span> : <span className="tag warn">미배정</span>}</td>
                </tr>
              )) : <tr><td className="muted">배정할 수 있는 재원생이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        {anyInClass ? (
          <div className="segmented" role="group" aria-label="배정 방식">
            <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')}>추가 수강 (기존 반 유지)</button>
            <button type="button" aria-pressed={mode === 'move'} onClick={() => setMode('move')}>반 이동 (기존 반 종료)</button>
          </div>
        ) : null}
        {mode === 'move' && !single && multiClassCount ? (
          <div className="notice-bar">두 반 이상 다니는 학생 {multiClassCount}명은 어느 반에서 옮길지 정할 수 없어 함께 옮길 수 없습니다. 한 명씩 고르거나 추가 수강으로 배정하세요.</div>
        ) : null}
        {mode === 'move' && single ? (
          <Field label="어느 반에서 옮기나요?">{(id) => (
            <select id={id} value={fromClass} onChange={(e) => setFromClass(e.target.value)}>
              <option value="">반 선택</option>
              {single.class_ids.map((cid) => <option key={cid} value={cid}>{classNames[cid] || cid}</option>)}
            </select>
          )}</Field>
        ) : null}
        <Field label={mode === 'move' ? '이동일' : '시작일'}>{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        {error ? <div className="error-box prewrap" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : picked.length > 1 ? `${picked.length}명 배정` : '배정'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** "선택한 N명 → 반 · 이동일 → 이동" or "→ 마지막 수업일 → 반에서 빼기" for the checked students of this class. */
function BulkMoveBar({ classId, className, ids, onDone, onClear }) {
  const boot = useBoot();
  const toast = useToast();
  const [action, setAction] = useState('move');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState(boot.today);
  // Taking out ends yesterday so the students leave today's roster right away.
  const [endDate, setEndDate] = useState(addDays(boot.today, -1));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const targets = openRegularClasses(boot, [classId]);
  const run = async () => {
    if (action === 'move' && !target) return setError('옮겨 갈 반을 골라 주세요.');
    setSaving(true);
    setError('');
    try {
      if (action === 'move') {
        const res = await api('moveStudents', { from_class_id: classId, to_class_id: target, student_ids: ids, date });
        toast(`${res.moved_count}명을 ${targets.find((c) => c.id === target).name}으로 옮겼습니다.`);
      } else {
        const res = await api('closeStudentsInClass', { class_id: classId, student_ids: ids, end_date: endDate });
        toast(`${res.count}명을 ${className || '이 반'}에서 뺐습니다.`);
      }
      boot.refresh();
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="card bulk-bar">
      <div className="cluster">
        <strong>선택한 {ids.length}명</strong>
        <div className="segmented" role="group" aria-label="할 일">
          <button type="button" aria-pressed={action === 'move'} onClick={() => { setAction('move'); setError(''); }}>이동</button>
          <button type="button" aria-pressed={action === 'out'} onClick={() => { setAction('out'); setError(''); }}>반에서 빼기</button>
        </div>
        <span className="muted">→</span>
        {action === 'move' ? (
          <>
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="옮겨 갈 반" style={{ width: 'auto' }}>
              <option value="">옮겨 갈 반</option>
              {targets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="이동일" style={{ width: 'auto' }} />
            <button type="button" className="btn sm" onClick={run} disabled={saving}>{saving ? '옮기는 중…' : '이동'}</button>
          </>
        ) : (
          <>
            <label className="cluster"><span className="muted">마지막 수업일</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: 'auto' }} /></label>
            <button type="button" className="btn ghost sm danger-text" onClick={run} disabled={saving}>{saving ? '빼는 중…' : '반에서 빼기'}</button>
          </>
        )}
        <button type="button" className="btn ghost sm" onClick={onClear}>선택 해제</button>
      </div>
      {action === 'out' ? <div className="hint" style={{ marginTop: 6 }}>마지막 수업일까지 명단에 남고 기록은 그대로입니다. 다른 반이 없는 학생은 미배정이 됩니다.</div> : null}
      {error ? <div className="error-box prewrap" role="alert" style={{ marginTop: 8 }}>{error}</div> : null}
    </div>
  );
}

function MemberRows({ rows, selectable, selected, onToggle, onChange }) {
  return rows.map((r) => {
    const regular = r.assignment_type !== '임시';
    return (
      <tr key={r.rel_id}>
        {selectable ? (
          <td className="check-col" data-label="선택">
            {regular ? <input type="checkbox" checked={selected.has(r.student_id)} onChange={() => onToggle(r.student_id)} aria-label={`${r.name} 선택`} /> : null}
          </td>
        ) : null}
        <td className="primary"><Link href={`/students/${r.student_id}`}>{r.name}</Link>
          {r.other_classes && r.other_classes.length ? <div className="muted">함께 다니는 반: {r.other_classes.join(', ')}</div> : null}</td>
        <td data-label="학교 · 학년">{[r.school, r.grade].filter(Boolean).join(' · ') || '-'}</td>
        <td data-label="학부모">{r.parent_phone || '-'}</td>
        <td data-label="시작일">{r.start_date || '-'}</td>
        <td data-label="구분">
          {r.assignment_type === '임시' ? <span className="tag amber">임시 ← {r.source_class_name}</span> : <span className="tag muted">정규</span>}
          {r.away ? <span className="tag amber" style={{ marginLeft: 4 }}>{r.away.class_name} 수업 중</span> : null}
          {r.student_status === '휴원' ? <span className="tag muted" style={{ marginLeft: 4 }}>휴원 · 수업 기록 명단 제외</span> : null}
        </td>
        <td>{regular ? <button type="button" className="btn ghost sm" onClick={() => onChange(r)}>반 변경</button> : <span className="hint">시험 화면에서 변경</span>}</td>
      </tr>
    );
  });
}

export function StudentsTab({ classId, onChanged }) {
  const state = useApi(() => api('getClassMembers', classId), [classId]);
  const [assigning, setAssigning] = useState(false);
  const [changing, setChanging] = useState(null);
  const [showPast, setShowPast] = useState(false);
  const regularIds = state.data ? state.data.current.filter((r) => r.assignment_type !== '임시').map((r) => r.student_id) : [];
  const sel = useSelection(regularIds);
  const done = () => { setAssigning(false); setChanging(null); sel.clear(); state.reload(); onChanged(); };
  const head = (withCheck) => (
    <thead><tr>{withCheck ? <th className="check-col"><SelectAllCheckbox sel={sel} label="정규 학생 전체 선택" /></th> : null}<th>이름</th><th>학교 · 학년</th><th>학부모 연락처</th><th>시작일</th><th>구분</th><th /></tr></thead>
  );
  return (
    <Async state={state}>
      {(m) => (
        <div className="stack">
          <div className="split">
            <span className="muted">현재 {m.current.length}명{m.upcoming.length ? ` · 시작 예정 ${m.upcoming.length}명` : ''}{m.current.length ? ' · 체크해서 여러 명을 한 번에 옮기거나 반에서 뺄 수 있습니다' : ''}</span>
            <button type="button" className="btn" onClick={() => setAssigning(true)}>학생 배정</button>
          </div>
          {sel.chosen.length ? <BulkMoveBar classId={classId} className={m.class_name} ids={sel.chosen} onDone={done} onClear={sel.clear} /> : null}
          {regularIds.length ? <label className="check-label mobile-only"><SelectAllCheckbox sel={sel} label="정규 학생 전체 선택" /> 전체 선택</label> : null}
          {m.current.length ? (
            <div className="table-wrap">
              <table className="data-table stack-mobile">
                {head(true)}
                <tbody><MemberRows rows={m.current} selectable selected={sel.selected} onToggle={sel.toggle} onChange={setChanging} /></tbody>
              </table>
            </div>
          ) : <div className="card"><EmptyState title="배정된 학생이 없습니다" action={<button type="button" className="btn" onClick={() => setAssigning(true)}>학생 배정</button>} /></div>}
          {m.upcoming.length ? (
            <div>
              <h3 style={{ margin: '4px 0 8px' }}>시작 예정</h3>
              <div className="table-wrap">
                <table className="data-table stack-mobile">
                  {head(false)}
                  <tbody><MemberRows rows={m.upcoming} onChange={setChanging} /></tbody>
                </table>
              </div>
            </div>
          ) : null}
          {m.past.length ? (
            <div>
              <button type="button" className="link-btn" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
                {showPast ? '지난 학생 숨기기' : `지난 학생 ${m.past.length}명 보기`}
              </button>
              {showPast ? (
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="data-table stack-mobile">
                    <thead><tr><th>이름</th><th>기간</th><th>구분</th></tr></thead>
                    <tbody>
                      {m.past.map((r) => (
                        <tr key={r.rel_id}>
                          <td className="primary"><Link href={`/students/${r.student_id}`}>{r.name}</Link></td>
                          <td data-label="기간">{r.start_date} ~ {r.end_date || ''}</td>
                          <td data-label="구분">{r.assignment_type === '임시' ? '시험대비 임시' : r.student_status === '퇴원' ? '퇴원' : '반 종료'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
          {assigning ? <AssignModal classId={classId} members={m} onClose={() => setAssigning(false)} onDone={done} /> : null}
          {changing ? (
            <ClassChangeDialog studentId={changing.student_id} studentName={changing.name}
              rel={{ rel_id: changing.rel_id, class_id: classId, class_name: m.class_name || '이 반', start_date: changing.start_date, removable: changing.removable }}
              onClose={() => setChanging(null)} onDone={done} />
          ) : null}
        </div>
      )}
    </Async>
  );
}

// ---------------------------------------------------------------- 통계

export function StatsTab({ classId, today }) {
  const [ym, setYm] = useState(today.slice(0, 7));
  const trend = useApi(() => api('getClassTrend', classId, 6), [classId]);
  const [y, m] = ym.split('-').map(Number);
  const monthly = useApi(() => api('getClassStats', classId, y, m), [classId, ym]);
  const points = useMemo(() => (trend.data ? trend.data.months : []), [trend.data]);
  const pts = (key) => points.map((p) => ({ label: p.label, value: p[key] }));
  return (
    <div className="stack">
      <Async state={trend}>
        {() => (
          <section className="card">
            <h2>최근 6개월 추이</h2>
            <div className="cols-3">
              <MiniBars title="출석률" points={pts('attendance_rate')} max={100} format={(v) => `${v}%`} />
              <MiniBars title="숙제 완료율" points={pts('homework_rate')} max={100} format={(v) => `${v}%`} />
              <MiniBars title="테스트 평균 (원점수)" points={pts('test_average')} format={(v) => score(v)} />
            </div>
            <details style={{ marginTop: 12 }}>
              <summary className="muted">표로 보기</summary>
              <ul className="trend-months">
                {points.slice().reverse().map((p) => (
                  <li key={p.label}>
                    <strong>{p.year}년 {p.label}</strong>
                    <span>수업 {p.lesson_days}</span>
                    <span>출석 {percent(p.attendance_rate)}</span>
                    <span>숙제 {percent(p.homework_rate)}</span>
                    <span>과제 A {percent(p.assignment_a_rate)}</span>
                    <span>테스트 {p.test_comparable ? score(p.test_average) : '만점 다름'}</span>
                  </li>
                ))}
              </ul>
              <div className="table-wrap trend-table" style={{ marginTop: 8 }}>
                <table className="data-table">
                  <thead><tr><th>월</th><th className="num">수업일</th><th className="num">출석률</th><th className="num">숙제 완료율</th><th className="num">과제 A 비율</th><th className="num">테스트 평균</th></tr></thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.label}>
                        <td>{p.year}년 {p.label}</td><td className="num">{p.lesson_days}</td><td className="num">{percent(p.attendance_rate)}</td>
                        <td className="num">{percent(p.homework_rate)}</td><td className="num">{percent(p.assignment_a_rate)}</td>
                        <td className="num">{p.test_comparable ? score(p.test_average) : '만점 다름'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        )}
      </Async>
      <section className="card">
        <div className="card-head">
          <h2>학생별 월간 통계 <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>100점 환산</span></h2>
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} style={{ width: 'auto' }} aria-label="월 선택" />
        </div>
        <Async state={monthly}>
          {(s) => s.students.length ? (
            <div className="table-wrap">
              <table className="data-table stack-mobile">
                <thead><tr><th>학생</th><th className="num">출석</th><th className="num">결석</th><th className="num">테스트 평균 (100점)</th><th className="num">과제 A/B/C/D/E/F</th><th className="num">집중도 A/B/C/D</th></tr></thead>
                <tbody>
                  {s.students.map((r) => (
                    <tr key={r.student_id}>
                      <td className="primary"><Link href={`/students/${r.student_id}`}>{r.name}</Link></td>
                      <td data-label="출석" className="num">{r.stats.present_count}</td>
                      <td data-label="결석" className="num">{r.stats.absent_count ? <span className="tag danger">{r.stats.absent_count}</span> : 0}</td>
                      <td data-label="테스트 평균" className="num">{r.stats.test_average_display}</td>
                      <td data-label="과제" className="num">{[r.stats.assignment_A, r.stats.assignment_B, r.stats.assignment_C, r.stats.assignment_D, r.stats.assignment_E, r.stats.assignment_F].join('/')}</td>
                      <td data-label="집중도" className="num">{r.stats.concentration_A}/{r.stats.concentration_B}/{r.stats.concentration_C}/{r.stats.concentration_D}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="primary"><strong>반 전체</strong></td>
                    <td data-label="출석" className="num">{s.present_count}</td>
                    <td data-label="결석" className="num">{s.absent_count}</td>
                    <td data-label="테스트 평균" className="num"><strong>{s.test_average_display}</strong></td>
                    <td className="empty-mobile" /><td className="empty-mobile" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : <EmptyState title="이 달에는 학생이 없습니다" />}
        </Async>
      </section>
    </div>
  );
}
