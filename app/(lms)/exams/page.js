'use client';

import Link from 'next/link';
import { Fragment, Suspense, useMemo, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs, { useTab } from '@/components/ui/Tabs';
import Modal, { ModalCancel } from '@/components/ui/Modal';
import { useDirty } from '@/components/ui/useDirty';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import SchoolExamForm from '@/components/domain/exam/SchoolExamForm';
import PeriodForm from '@/components/domain/exam/PeriodForm';
import { useRouter } from 'next/navigation';
import { api, apiBatch, useApi } from '@/lib/client-api';
import { dateRange, formatDate, shortDate } from '@/lib/format';
import { currentTerm, examDDayLabel, mathExamLabel } from '@/lib/term';

const TABS = [
  { key: 'schedule', label: '학교 시험 일정' },
  { key: 'periods', label: '시험대비 기간' }
];

const TYPES = [['중간', '중간고사'], ['기말', '기말고사'], ['기타', '기타']];

const PERIOD_HELP = '시험 기간에 학교·학년별 임시 반을 만들고, 원래 반은 휴강합니다. 학생은 학교 시험이 끝나면 원래 반으로 돌아갑니다.';

/** Midterms run until about mid-May / mid-October; after that the next exam is the final. */
function defaultExamType(today) {
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const midterm = m === 3 || m === 4 || (m === 5 && d <= 15) || m === 8 || m === 9 || (m === 10 && d <= 15);
  return midterm ? '중간' : '기말';
}

function DDay({ d, inProgress }) {
  if (d === null || d === undefined) return null;
  const tone = inProgress ? 'danger' : d < 0 ? 'muted' : d <= 7 ? 'danger' : d <= 21 ? 'amber' : '';
  return <span className={'tag ' + tone}>{examDDayLabel(d, inProgress)}</span>;
}

function MathDay({ x }) {
  const label = mathExamLabel(x.math_exam_date, x.exam_date, x.exam_end_date);
  return label ? <><span className="muted">{label}</span> </> : null;
}

const BULK_COLS = ['exam_date', 'exam_end_date', 'math_exam_date', 'textbook', 'scope'];
const DATE_COLS = new Set(['exam_date', 'exam_end_date', 'math_exam_date']);

/** Enter moves down the same column (phones: to the next field); the last row never submits. */
function onBulkKey(e) {
  if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
  e.preventDefault();
  const fields = [...e.currentTarget.querySelectorAll('input[data-col]')];
  const at = fields.indexOf(e.target);
  if (at < 0) return;
  const stacked = window.matchMedia('(max-width: 640px)').matches;
  const next = stacked ? fields[at + 1] : fields.slice(at + 1).find((el) => el.dataset.col === e.target.dataset.col);
  if (next) next.focus();
}

/** Same date rules as LMS.validateSchoolExamInput, checked per row so the error names the school. */
function bulkRowError(r) {
  const { exam_date: start, exam_end_date: end, math_exam_date: math } = r;
  if (end && !start) return '시험 시작일을 입력해 주세요.';
  if (end && end < start) return '종료일이 시작일보다 빠릅니다.';
  if (math && start && (math < start || math > (end || start))) return '수학 시험일은 시험 기간 안이어야 합니다.';
  return '';
}

/** One editable row per school+grade that has no exam yet; saves all filled rows at once. */
function BulkModal({ groups, term, examType, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => groups.map((g) => ({ ...g, exam_date: '', exam_end_date: '', math_exam_date: '', textbook: '', scope: '' })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = useDirty(rows);
  const mathWithin = (math, start, end) => (math && (!start || math >= start) && (!end || math <= end) ? math : '');
  const patch = (r, key, value) => {
    if (key === 'exam_end_date') return { ...r, exam_end_date: value, math_exam_date: mathWithin(r.math_exam_date, r.exam_date, value) };
    if (key !== 'exam_date') return { ...r, [key]: value };
    const end = !r.exam_end_date || (value && r.exam_end_date < value) ? value : r.exam_end_date;
    return { ...r, exam_date: value, exam_end_date: end, math_exam_date: mathWithin(r.math_exam_date, value, end) };
  };
  const set = (i, key) => (e) => setRows((list) => list.map((r, j) => (j === i ? patch(r, key, e.target.value) : r)));
  const filled = rows.filter((r) => r.exam_date || r.exam_end_date || r.math_exam_date || r.scope || r.textbook);

  const submit = async (e) => {
    e.preventDefault();
    if (!filled.length) return setError('시험 기간이나 범위를 한 곳 이상 입력해 주세요.');
    const bad = filled.find((r) => bulkRowError(r));
    if (bad) return setError(`${bad.school} ${bad.grade}: ${bulkRowError(bad)}`);
    setSaving(true);
    setError('');
    try {
      await api('saveSchoolExamsBatch', filled.map((r) => ({
        school: r.school, grade: r.grade, school_year: term.year, semester: term.semester,
        exam_type: examType, exam_date: r.exam_date, exam_end_date: r.exam_end_date, math_exam_date: r.math_exam_date, textbook: r.textbook, scope: r.scope
      })));
      toast(`${filled.length}개 학교 시험 일정을 저장했습니다.`);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const labels = { exam_date: '시작일', exam_end_date: '종료일', math_exam_date: '수학 시험일', textbook: '교재', scope: '범위' };
  return (
    <Modal title={`${term.year} ${term.semester}학기 ${examType === '기말' ? '기말고사' : '중간고사'} 한 번에 입력`}
      titleMeta={<span className="muted desktop-only">{rows.length}곳</span>}
      onClose={onClose} dirty={dirty} wide className="eb-modal"
      footer={(
        <>
          <span className="save-state">채운 학교 {filled.length}곳</span>
          <span className="cluster eb-buttons">
            <ModalCancel />
            <button type="submit" form="bulk-exam-form" className="btn" disabled={saving}>{saving ? '저장 중…' : `${filled.length}개 저장`}</button>
          </span>
        </>
      )}>
      <form id="bulk-exam-form" className="stack" onSubmit={submit}>
        <p className="hint eb-hint">아는 것만 채우세요. 빈 줄은 저장하지 않습니다.<span className="desktop-only"> Tab은 오른쪽, Enter는 아래 칸으로 갑니다.</span></p>
        <div className="table-wrap eb-wrap">
          <table className="data-table eb-table" onKeyDown={onBulkKey}>
            <thead><tr><th>학교 · 학년</th><th>시작일</th><th>종료일</th><th>수학 시험일</th><th>교재</th><th>범위</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.school_key}>
                  <td className="eb-school"><strong>{r.school} {r.grade}</strong> <span className="muted">· {r.student_count}명</span></td>
                  {BULK_COLS.map((key) => (
                    <td key={key}>
                      <label className="eb-field">
                        <span className="eb-label">{labels[key]}</span>
                        <input type={DATE_COLS.has(key) ? 'date' : 'text'} data-col={key} enterKeyHint="next" value={r[key]} onChange={set(i, key)}
                          min={key !== 'exam_date' && DATE_COLS.has(key) && r.exam_date ? r.exam_date : undefined}
                          max={key === 'math_exam_date' && r.exam_end_date ? r.exam_end_date : undefined}
                          aria-label={`${r.school} ${r.grade} ${labels[key]}`} />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
      </form>
    </Modal>
  );
}

function StudentChips({ students }) {
  return students.length ? (
    <div className="roster-chips">
      {students.map((s) => (
        <Link key={s.student_id} href={`/students/${s.student_id}`}>{s.name}{s.classes.length ? <span className="muted"> · {s.classes.join(', ')}</span> : null}</Link>
      ))}
    </div>
  ) : <span className="muted">이 학교·학년의 재원생이 없습니다.</span>;
}

function ScheduleTab({ tabs }) {
  const { today } = useBoot();
  const initial = currentTerm(today);
  const [year, setYear] = useState(initial.year);
  const [semester, setSemester] = useState(initial.semester);
  const [type, setType] = useState(defaultExamType(today));
  const [editing, setEditing] = useState(null);
  const [bulk, setBulk] = useState(false);
  const [openRow, setOpenRow] = useState(null);
  const state = useApi(
    () => apiBatch([['getSchoolExams', { school_year: year, semester, exam_type: type }], ['getSchoolOptions']])
      .then(([exams, options]) => ({ exams, options })),
    [year, semester, type]
  );
  const years = useMemo(() => {
    const y = Number(initial.year);
    return [y - 1, y, y + 1].map(String);
  }, [initial.year]);

  const newExam = (extra) => setEditing({ school_year: year, semester, exam_type: type, ...extra });
  const missingOf = (d) => {
    const have = new Set(d.exams.map((e) => e.school_key));
    return d.options.groups.filter((g) => !have.has(g.school_key));
  };
  const typeLabel = (TYPES.find(([v]) => v === type) || [])[1] || type;
  const data = state.data;
  const missingCount = data && type !== '기타' ? missingOf(data).length : 0;
  const sub = [`${year} ${semester}학기 ${typeLabel.replace('고사', '')}`]
    .concat(data ? [`일정 ${data.exams.length}곳`] : [])
    .concat(missingCount ? [`미입력 ${missingCount}곳`] : [])
    .join(' · ');
  const toggleRow = (id) => setOpenRow(openRow === id ? null : id);

  return (
    <>
      <PageHeader title="시험" sub={sub} actions={<button type="button" className="btn" onClick={() => newExam({})}>시험 일정 추가</button>} />
      {tabs}
      <div className="stack">
        <div className="ex-filters">
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="학년도">
            {years.map((y) => <option key={y} value={y}>{y}학년도</option>)}
          </select>
          <div className="segmented" role="group" aria-label="학기">
            {['1', '2'].map((s) => <button key={s} type="button" aria-pressed={semester === s} onClick={() => setSemester(s)}>{s}학기</button>)}
          </div>
          <div className="segmented" role="group" aria-label="시험 종류">
            {TYPES.map(([v, label]) => <button key={v} type="button" aria-pressed={type === v} onClick={() => setType(v)}>{label}</button>)}
          </div>
        </div>
        <Async state={state}>
          {({ exams, options }) => {
            const missing = missingOf({ exams, options });
            return (
              <>
                {exams.length && missing.length && type !== '기타' ? (
                  <section className="card ex-missing">
                    <div className="card-head">
                      <h3>아직 일정이 없는 학교 {missing.length}곳</h3>
                      <button type="button" className="btn secondary sm" onClick={() => setBulk(true)}>한 번에 입력</button>
                    </div>
                    <div className="roster-chips">
                      {missing.map((g) => (
                        <button key={g.school_key} type="button" className="tag ex-chip"
                          onClick={() => newExam({ school: g.school, grade: g.grade })}>+ {g.school} {g.grade} ({g.student_count}명)</button>
                      ))}
                    </div>
                  </section>
                ) : null}
                {exams.length ? (
                  <>
                    <div className="table-wrap ex-table">
                      <table className="data-table">
                        <thead><tr><th>학교 · 학년</th><th>시험 기간</th><th>교재</th><th>시험 범위</th><th className="num">학생</th><th /></tr></thead>
                        <tbody>
                          {exams.map((x) => (
                            <Fragment key={x.school_exam_id}>
                              <tr>
                                <td><strong>{x.school}</strong> <span className="muted">{x.grade}</span>{x.exam_type === '기타' ? <div className="muted">{x.title}</div> : null}</td>
                                <td>{x.exam_date ? <>{dateRange(x.exam_date, x.exam_end_date, formatDate)} <MathDay x={x} /><DDay d={x.d_day} inProgress={x.in_progress} /></> : <span className="tag warn">미정</span>}</td>
                                <td>{x.textbook || <span className="muted">-</span>}</td>
                                <td className="prewrap">{x.scope || <span className="muted">미입력</span>}</td>
                                <td className="num">
                                  <button type="button" className="link-btn" aria-expanded={openRow === x.school_exam_id}
                                    onClick={() => toggleRow(x.school_exam_id)}>{x.student_count}명 {openRow === x.school_exam_id ? '▴' : '▾'}</button>
                                </td>
                                <td className="num"><button type="button" className="btn secondary sm" onClick={() => setEditing(x)}>수정</button></td>
                              </tr>
                              {openRow === x.school_exam_id ? (
                                <tr className="ex-roster"><td colSpan={6}><StudentChips students={x.students} /></td></tr>
                              ) : null}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <ul className="ex-cards">
                      {exams.map((x) => (
                        <li key={x.school_exam_id} className="ex-card">
                          <div className="ex-card-head">
                            <strong>{x.school} {x.grade}</strong>
                            {x.exam_date ? <span className="ex-card-date">{dateRange(x.exam_date, x.exam_end_date, shortDate)} <MathDay x={x} /><DDay d={x.d_day} inProgress={x.in_progress} /></span> : <span className="tag warn">미정</span>}
                          </div>
                          {x.exam_type === '기타' && x.title ? <div className="muted">{x.title}</div> : null}
                          <div className="prewrap">
                            {x.textbook ? <>{x.textbook} · </> : null}{x.scope || <span className="muted">범위 미입력</span>}
                          </div>
                          <div className="ex-card-foot">
                            <button type="button" className="link-btn" aria-expanded={openRow === x.school_exam_id}
                              onClick={() => toggleRow(x.school_exam_id)}>학생 {x.student_count}명 {openRow === x.school_exam_id ? '▴' : '▾'}</button>
                            <button type="button" className="btn secondary sm" onClick={() => setEditing(x)}>수정</button>
                          </div>
                          {openRow === x.school_exam_id ? <StudentChips students={x.students} /> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="card">
                    <EmptyState title="등록된 시험 일정이 없습니다"
                      action={missing.length ? <button type="button" className="btn" onClick={() => setBulk(true)}>재원생 학교 {missing.length}곳 한 번에 입력</button> : null}>
                      학교별 수학 시험일과 범위를 기록하면 반·학생 화면에 D-day가 표시됩니다.
                    </EmptyState>
                  </div>
                )}
                {options.missing_school.length ? (
                  <div className="notice-bar">
                    학교가 입력되지 않은 재원생 {options.missing_school.length}명은 시험 일정과 연결되지 않습니다:{' '}
                    {options.missing_school.map((s, i) => (
                      <span key={s.student_id}>{i ? ', ' : ''}<Link href={`/students/${s.student_id}`}>{s.name}</Link></span>
                    ))}
                  </div>
                ) : null}
                {editing ? (
                  <SchoolExamForm initial={editing} schools={options.schools}
                    onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} />
                ) : null}
                {bulk ? (
                  <BulkModal groups={missing} term={{ year, semester }} examType={type === '기타' ? '중간' : type}
                    onClose={() => setBulk(false)} onSaved={() => { setBulk(false); state.reload(); }} />
                ) : null}
              </>
            );
          }}
        </Async>
      </div>
    </>
  );
}

const PERIOD_TONE = { 예정: 'muted', '진행 중': 'ok', 끝남: 'muted', 마감: 'muted' };

function PeriodState({ p }) {
  return (
    <span className="cluster ep-state">
      <span className={'tag ' + (PERIOD_TONE[p.state] || '')}>{p.state}</span>
      {!p.class_count ? <span className="tag warn">편성 전</span> : null}
    </span>
  );
}

function PeriodsTab({ tabs }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const state = useApi(() => api('getExamPeriods'), []);
  const rows = state.data || [];
  const running = rows.filter((p) => p.state === '진행 중').length;
  const planned = rows.filter((p) => p.state === '예정').length;
  const href = (p) => `/exams/periods/${p.exam_period_id}`;
  return (
    <>
      <PageHeader title="시험" sub={state.data ? `진행 중 ${running} · 예정 ${planned}` : null}
        actions={<button type="button" className="btn" onClick={() => setCreating(true)}>새 시험대비 기간</button>} />
      {tabs}
      <Async state={state}>
        {(list) => list.length ? (
          <div className="stack">
            <details className="ex-help">
              <summary>시험대비 기간이란?</summary>
              <p>{PERIOD_HELP}</p>
            </details>
            <div className="table-wrap ep-table">
              <table className="data-table">
                <thead><tr><th>기간</th><th>날짜</th><th>상태</th><th className="num">시험대비 반</th><th className="num">학생</th><th className="num">휴강 반</th></tr></thead>
                <tbody>
                  {list.map((p) => (
                    <tr key={p.exam_period_id}>
                      <td><Link href={href(p)}>{p.title}</Link></td>
                      <td>{formatDate(p.start_date)} ~ {formatDate(p.end_date)}</td>
                      <td><PeriodState p={p} /></td>
                      <td className="num">{p.class_count}</td>
                      <td className="num">{p.student_count}</td>
                      <td className="num">{p.suspended_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="ep-cards">
              {list.map((p) => (
                <li key={p.exam_period_id} className="ep-card">
                  <div className="ep-card-head"><Link className="ep-card-name" href={href(p)}>{p.title}</Link><PeriodState p={p} /></div>
                  <span className="muted">{formatDate(p.start_date)} ~ {formatDate(p.end_date)} · 반 {p.class_count} · 학생 {p.student_count} · 휴강 {p.suspended_count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="card">
            <EmptyState title="시험대비 기간이 없습니다" action={<button type="button" className="btn" onClick={() => setCreating(true)}>새 시험대비 기간</button>}>
              {PERIOD_HELP} 학교 시험 일정을 먼저 입력해 두면 학생별 복귀일이 자동으로 채워집니다.
            </EmptyState>
          </div>
        )}
      </Async>
      {creating ? <PeriodForm onClose={() => setCreating(false)} onSaved={(row) => router.push(`/exams/periods/${row.exam_period_id}`)} /> : null}
    </>
  );
}

function ExamsView() {
  const tab = useTab(TABS);
  const tabs = <Tabs tabs={TABS} current={tab} />;
  return (
    <div className="exams-page">
      {tab === 'schedule' ? <ScheduleTab tabs={tabs} /> : <PeriodsTab tabs={tabs} />}
    </div>
  );
}

export default function ExamsPage() {
  return (
    <Suspense fallback={null}>
      <ExamsView />
    </Suspense>
  );
}
