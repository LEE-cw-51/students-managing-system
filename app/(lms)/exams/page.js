'use client';

import Link from 'next/link';
import { Fragment, Suspense, useMemo, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs, { useTab } from '@/components/ui/Tabs';
import Modal from '@/components/ui/Modal';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import SchoolExamForm from '@/components/domain/exam/SchoolExamForm';
import PeriodForm from '@/components/domain/exam/PeriodForm';
import { useRouter } from 'next/navigation';
import { api, apiBatch, useApi } from '@/lib/client-api';
import { formatDate } from '@/lib/format';
import { currentTerm, dDayLabel } from '@/lib/term';

const TABS = [
  { key: 'schedule', label: '학교 시험 일정' },
  { key: 'periods', label: '시험대비 기간' }
];

const TYPES = [['중간', '중간고사'], ['기말', '기말고사'], ['기타', '기타']];

/** Midterms run until about mid-May / mid-October; after that the next exam is the final. */
function defaultExamType(today) {
  const m = Number(today.slice(5, 7));
  const d = Number(today.slice(8, 10));
  const midterm = m === 3 || m === 4 || (m === 5 && d <= 15) || m === 8 || m === 9 || (m === 10 && d <= 15);
  return midterm ? '중간' : '기말';
}

function DDay({ d }) {
  if (d === null || d === undefined) return null;
  const tone = d < 0 ? 'muted' : d <= 7 ? 'danger' : d <= 21 ? 'amber' : '';
  return <span className={'tag ' + tone}>{dDayLabel(d)}</span>;
}

/** One editable row per school+grade that has no exam yet; saves all filled rows at once. */
function BulkModal({ groups, term, examType, onClose, onSaved }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => groups.map((g) => ({ ...g, exam_date: '', textbook: '', scope: '' })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (i, key) => (e) => setRows((list) => list.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r)));
  const filled = rows.filter((r) => r.exam_date || r.scope || r.textbook);

  const submit = async (e) => {
    e.preventDefault();
    if (!filled.length) return setError('시험일이나 범위를 한 곳 이상 입력해 주세요.');
    setSaving(true);
    setError('');
    try {
      await api('saveSchoolExamsBatch', filled.map((r) => ({
        school: r.school, grade: r.grade, school_year: term.year, semester: term.semester,
        exam_type: examType, exam_date: r.exam_date, textbook: r.textbook, scope: r.scope
      })));
      toast(`${filled.length}개 학교 시험 일정을 저장했습니다.`);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`${term.year}년 ${term.semester}학기 ${examType === '기말' ? '기말고사' : '중간고사'} 한 번에 입력`} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>재원생의 학교·학년으로 만든 목록입니다. 아는 것만 채우고 저장하세요. 빈 줄은 저장하지 않습니다.</p>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>학교 · 학년</th><th>시험일</th><th>교재</th><th>범위</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.school_key}>
                  <td><strong>{r.school}</strong> <span className="muted">{r.grade} · {r.student_count}명</span></td>
                  <td><input type="date" value={r.exam_date} onChange={set(i, 'exam_date')} aria-label={`${r.school} ${r.grade} 시험일`} /></td>
                  <td><input value={r.textbook} onChange={set(i, 'textbook')} aria-label={`${r.school} ${r.grade} 교재`} /></td>
                  <td><input value={r.scope} onChange={set(i, 'scope')} aria-label={`${r.school} ${r.grade} 범위`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn" disabled={saving}>{saving ? '저장 중…' : `${filled.length}개 저장`}</button>
        </div>
      </form>
    </Modal>
  );
}

function ScheduleTab() {
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

  return (
    <div className="stack">
      <div className="split">
        <div className="cluster">
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="학년도" style={{ width: 'auto' }}>
            {years.map((y) => <option key={y} value={y}>{y}학년도</option>)}
          </select>
          <div className="segmented" role="group" aria-label="학기">
            {['1', '2'].map((s) => <button key={s} type="button" aria-pressed={semester === s} onClick={() => setSemester(s)}>{s}학기</button>)}
          </div>
          <div className="segmented" role="group" aria-label="시험 종류">
            {TYPES.map(([v, label]) => <button key={v} type="button" aria-pressed={type === v} onClick={() => setType(v)}>{label}</button>)}
          </div>
        </div>
        <button type="button" className="btn" onClick={() => newExam({})}>시험 일정 추가</button>
      </div>
      <Async state={state}>
        {({ exams, options }) => {
          const have = new Set(exams.map((e) => e.school_key));
          const missing = options.groups.filter((g) => !have.has(g.school_key));
          return (
            <>
              {exams.length ? (
                <div className="table-wrap">
                  <table className="data-table stack-mobile">
                    <thead><tr><th>학교 · 학년</th><th>수학 시험일</th><th>교재</th><th>시험 범위</th><th className="num">학생</th><th /></tr></thead>
                    <tbody>
                      {exams.map((x) => (
                        <Fragment key={x.school_exam_id}>
                          <tr>
                            <td className="primary"><strong>{x.school}</strong> <span className="muted">{x.grade}</span>{x.exam_type === '기타' ? <div className="muted">{x.title}</div> : null}</td>
                            <td data-label="시험일">{x.exam_date ? <>{formatDate(x.exam_date)} <DDay d={x.d_day} /></> : <span className="tag warn">미정</span>}</td>
                            <td data-label="교재">{x.textbook || <span className="muted">-</span>}</td>
                            <td data-label="범위" className="prewrap">{x.scope || <span className="muted">미입력</span>}</td>
                            <td data-label="학생" className="num">
                              <button type="button" className="link-btn" aria-expanded={openRow === x.school_exam_id}
                                onClick={() => setOpenRow(openRow === x.school_exam_id ? null : x.school_exam_id)}>{x.student_count}명</button>
                            </td>
                            <td><button type="button" className="btn secondary sm" onClick={() => setEditing(x)}>수정</button></td>
                          </tr>
                          {openRow === x.school_exam_id ? (
                            <tr>
                              <td colSpan={6} style={{ background: '#fbf8f2' }}>
                                {x.students.length ? (
                                  <div className="roster-chips">
                                    {x.students.map((s) => (
                                      <Link key={s.student_id} href={`/students/${s.student_id}`}>{s.name}{s.classes.length ? <span className="muted"> · {s.classes.join(', ')}</span> : null}</Link>
                                    ))}
                                  </div>
                                ) : <span className="muted">이 학교·학년의 재원생이 없습니다.</span>}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="card">
                  <EmptyState title="등록된 시험 일정이 없습니다"
                    action={missing.length ? <button type="button" className="btn" onClick={() => setBulk(true)}>재원생 학교 {missing.length}곳 한 번에 입력</button> : null}>
                    학교별 수학 시험일과 범위를 기록하면 반·학생 화면에 D-day가 표시됩니다.
                  </EmptyState>
                </div>
              )}
              {exams.length && missing.length && type !== '기타' ? (
                <section className="card">
                  <div className="card-head">
                    <h3>아직 일정이 없는 학교 {missing.length}곳</h3>
                    <button type="button" className="btn secondary sm" onClick={() => setBulk(true)}>한 번에 입력</button>
                  </div>
                  <div className="roster-chips">
                    {missing.map((g) => (
                      <button key={g.school_key} type="button" className="tag" style={{ padding: '6px 10px' }}
                        onClick={() => newExam({ school: g.school, grade: g.grade })}>+ {g.school} {g.grade} ({g.student_count}명)</button>
                    ))}
                  </div>
                </section>
              ) : null}
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
  );
}

const PERIOD_TONE = { 예정: 'muted', '진행 중': 'ok', 끝남: 'muted', 마감: 'muted' };

function PeriodsTab() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const state = useApi(() => api('getExamPeriods'), []);
  return (
    <div className="stack">
      <div className="split">
        <span className="muted">시험 기간에 학교·학년별 임시 반을 만들고, 원래 반은 휴강합니다. 학생은 학교 시험이 끝나면 원래 반으로 돌아갑니다.</span>
        <button type="button" className="btn" onClick={() => setCreating(true)}>새 시험대비 기간</button>
      </div>
      <Async state={state}>
        {(rows) => rows.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th>기간</th><th>날짜</th><th>상태</th><th className="num">시험대비 반</th><th className="num">학생</th><th className="num">휴강 반</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.exam_period_id} className="clickable" onClick={() => router.push(`/exams/periods/${p.exam_period_id}`)}>
                    <td className="primary"><Link href={`/exams/periods/${p.exam_period_id}`} onClick={(e) => e.stopPropagation()}>{p.title}</Link></td>
                    <td data-label="날짜">{formatDate(p.start_date)} ~ {formatDate(p.end_date)}</td>
                    <td data-label="상태"><span className={'tag ' + (PERIOD_TONE[p.state] || '')}>{p.state}</span>{!p.class_count ? <span className="tag warn" style={{ marginLeft: 4 }}>편성 전</span> : null}</td>
                    <td data-label="시험대비 반" className="num">{p.class_count}</td>
                    <td data-label="학생" className="num">{p.student_count}</td>
                    <td data-label="휴강 반" className="num">{p.suspended_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <EmptyState title="시험대비 기간이 없습니다" action={<button type="button" className="btn" onClick={() => setCreating(true)}>새 시험대비 기간</button>}>
              학교 시험 일정을 먼저 입력해 두면 학생별 복귀일이 자동으로 채워집니다.
            </EmptyState>
          </div>
        )}
      </Async>
      {creating ? <PeriodForm onClose={() => setCreating(false)} onSaved={(row) => router.push(`/exams/periods/${row.exam_period_id}`)} /> : null}
    </div>
  );
}

function ExamsView() {
  const tab = useTab(TABS);
  return (
    <>
      <PageHeader title="시험" sub="학교별 수학 시험 일정과 범위, 시험대비 기간을 관리합니다." />
      <Tabs tabs={TABS} current={tab} />
      {tab === 'schedule' ? <ScheduleTab /> : <PeriodsTab />}
    </>
  );
}

export default function ExamsPage() {
  return (
    <Suspense fallback={null}>
      <ExamsView />
    </Suspense>
  );
}
