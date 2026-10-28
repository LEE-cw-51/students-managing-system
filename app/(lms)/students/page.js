'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import Tabs, { useTab } from '@/components/ui/Tabs';
import CounselingLog from '@/components/domain/student/CounselingLog';
import PageHeader from '@/components/ui/PageHeader';
import { Async, EmptyState } from '@/components/ui/Feedback';
import Badges from '@/components/domain/Badges';
import StudentForm from '@/components/domain/student/StudentForm';
import { openRegularClasses } from '@/components/domain/student/ClassChangeDialog';
import { SelectAllCheckbox, useSelection } from '@/components/ui/useSelection';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { relativeDay, shortDate } from '@/lib/format';
import { dDayLabel } from '@/lib/term';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useUrlState } from '@/components/ui/useUrlState';
import { SortTh, useSort } from '@/components/ui/useSort';

const QUERY_KEY = 'students.q';

const TABS = [
  { key: 'list', label: '학생 목록' },
  { key: 'counseling', label: '상담 기록' }
];

export default function StudentsPage() {
  return (
    <Suspense fallback={null}>
      <StudentsView />
    </Suspense>
  );
}

function StudentsView() {
  const tab = useTab(TABS);
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="학생"
        sub={tab === 'list' ? '학생을 누르면 출결·수업 기록·숙제·성적·상담을 한 곳에서 봅니다.' : '모든 학생의 학부모·학생 상담 기록입니다.'}
        actions={<button type="button" className="btn" onClick={() => setCreating(true)}>학생 등록</button>}
      />
      <Tabs tabs={TABS} current={tab} />
      {tab === 'list' ? <StudentList onCreate={() => setCreating(true)} /> : <CounselingLog />}
      {creating ? <StudentForm onClose={() => setCreating(false)} onSaved={(row) => router.push(`/students/${row.student_id}`)} /> : null}
    </>
  );
}

function StudentList({ onCreate }) {
  const router = useRouter();
  const boot = useBoot();
  // Filters live in the URL so coming back from a student keeps them.
  const [status, setStatus] = useUrlState('status', '재원');
  const [grade, setGrade] = useUrlState('grade', '');
  // ?class=__none__ opens the 미배정 list (linked from the today screen).
  const [classId, setClassId] = useUrlState('class', '');
  const [flagged, setFlagged] = useUrlState('flagged', '');
  const onlyFlagged = flagged === '1';
  // The search can hold names or parent-phone digits, so it stays out of the URL and browser history.
  const [query, setQuery] = useState('');
  const startCreate = onCreate;
  const deferredQuery = useDeferredValue(query);
  useEffect(() => { setQuery(sessionStorage.getItem(QUERY_KEY) || ''); }, []);
  useEffect(() => {
    const q = deferredQuery.trim();
    if (q) sessionStorage.setItem(QUERY_KEY, q);
    else sessionStorage.removeItem(QUERY_KEY);
  }, [deferredQuery]);
  const state = useApi(() => api('getStudentList', { status, grade, class_id: classId }), [status, grade, classId]);
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영');

  const rows = useMemo(() => {
    const q = deferredQuery.trim().replace(/\s+/g, '').toLowerCase();
    return (state.data || []).filter((r) => {
      if (onlyFlagged && !r.badges.some((b) => b.tone !== 'muted')) return false;
      if (!q) return true;
      return (r.name + r.school + (r.parent_phone || '').replace(/\D/g, '')).toLowerCase().includes(q);
    });
  }, [state.data, deferredQuery, onlyFlagged]);
  const gradeOrder = boot.grades || [];
  const sort = useSort(rows, {
    name: (r) => r.name,
    grade: (r) => (gradeOrder.includes(r.grade) ? String(gradeOrder.indexOf(r.grade)).padStart(2, '0') + (r.school || '') : null),
    last: (r) => r.last_lesson_date,
    exam: (r) => r.next_exam && r.next_exam.date
  });
  const flaggedCount = (state.data || []).filter((r) => r.badges.some((b) => b.tone !== 'muted')).length;
  const sel = useSelection(rows.map((r) => r.student_id));
  const bulkDone = () => { sel.clear(); state.reload(); boot.refresh(); };

  return (
    <>
      <div className="split" style={{ marginBottom: 14 }}>
        <div className="cluster">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 학교 · 연락처" aria-label="학생 검색" style={{ width: 200 }} />
          <select value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="학년" style={{ width: 'auto' }}>
            <option value="">전체 학년</option>
            {(boot.grades || []).map((g) => <option key={g}>{g}</option>)}
          </select>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="반" style={{ width: 'auto' }}>
            <option value="">전체 반</option>
            <option value="__none__">미배정 (반 없는 재원생)</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className={'btn sm ' + (onlyFlagged ? '' : 'secondary')} aria-pressed={onlyFlagged} onClick={() => setFlagged(onlyFlagged ? '' : '1')}>
            ⚠ 주의 학생만{state.data ? ` (${flaggedCount})` : ''}
          </button>
        </div>
        <div className="segmented" role="group" aria-label="재원 상태">
          {[['재원', '재원'], ['휴원', '휴원'], ['퇴원', '퇴원'], ['', '전체']].map(([v, label]) => (
            <button key={label} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</button>
          ))}
        </div>
      </div>
      {sel.chosen.length ? <StudentBulkBar ids={sel.chosen} onDone={bulkDone} onClear={sel.clear} /> : null}
      <Async state={state}>
        {() => rows.length ? (
          <>
          <label className="check-label mobile-only" style={{ marginBottom: 8 }}><SelectAllCheckbox sel={sel} label="보이는 학생 전체 선택" /> 전체 선택</label>
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th className="check-col"><SelectAllCheckbox sel={sel} label="보이는 학생 전체 선택" /></th><SortTh sort={sort} col="name">이름</SortTh><SortTh sort={sort} col="grade">학년 · 학교</SortTh><th>반</th><SortTh sort={sort} col="last">최근 수업</SortTh><SortTh sort={sort} col="exam">다음 학교 시험</SortTh><th>학부모 연락처</th></tr></thead>
              <tbody>
                {sort.rows.map((r) => (
                  <tr key={r.student_id} className="clickable" onClick={() => router.push(`/students/${r.student_id}`)}>
                    <td className="check-col" data-label="선택" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={sel.selected.has(r.student_id)} onChange={() => sel.toggle(r.student_id)} aria-label={`${r.name} 선택`} />
                    </td>
                    <td className="primary">
                      <Link href={`/students/${r.student_id}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                      {r.status !== '재원' ? <span className="tag muted" style={{ marginLeft: 6 }}>{r.status}</span> : null}
                      <div style={{ marginTop: 4 }}><Badges badges={r.badges} quiet /></div>
                    </td>
                    <td data-label="학년 · 학교">{[r.grade, r.school].filter(Boolean).join(' · ') || '-'}{!r.school && r.status === '재원' ? <span className="tag warn" style={{ marginLeft: 4 }}>학교 미입력</span> : null}</td>
                    <td data-label="반">{r.classes.length ? r.classes.map((c) => (
                      <span key={c.rel_id} className={'tag ' + (c.assignment_type === '임시' ? 'amber' : 'muted')} style={{ marginRight: 4 }}>{c.class_name}</span>
                    )) : null}
                    {r.upcoming && r.upcoming.length ? r.upcoming.map((u) => (
                      <span key={u.rel_id} className="tag" style={{ marginRight: 4 }}>{u.class_name} {shortDate(u.start_date)}부터</span>
                    )) : null}
                    {r.unassigned ? <span className="tag warn">미배정</span> : !r.classes.length && !(r.upcoming || []).length ? <span className="muted">없음</span> : null}</td>
                    <td data-label="최근 수업">{r.last_lesson_date ? `${shortDate(r.last_lesson_date)} · ${relativeDay(r.last_lesson_date, boot.today)}` : <span className="muted">-</span>}</td>
                    <td data-label="다음 시험">{r.next_exam ? <>{shortDate(r.next_exam.date)} <span className={'tag ' + (r.next_exam.d_day <= 7 ? 'danger' : r.next_exam.d_day <= 21 ? 'amber' : '')}>{dDayLabel(r.next_exam.d_day)}</span></> : <span className="muted">-</span>}</td>
                    <td data-label="학부모">{r.parent_phone ? <a href={`tel:${r.parent_phone}`} onClick={(e) => e.stopPropagation()}>{r.parent_phone}</a> : <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="card">
            {(state.data || []).length ? (
              <EmptyState title="조건에 맞는 학생이 없습니다">검색어나 필터를 바꿔 보세요.</EmptyState>
            ) : (
              <EmptyState title={status === '재원' ? '등록된 재원생이 없습니다' : `${status || ''} 학생이 없습니다`}
                action={status === '재원' ? <button type="button" className="btn" onClick={startCreate}>첫 학생 등록하기</button> : null} />
            )}
          </div>
        )}
      </Async>
    </>
  );
}

const STATUSES = ['재원', '휴원', '퇴원'];

/** "선택한 N명 → 반 배정 | 상태 변경" for the checked students. */
function StudentBulkBar({ ids, onDone, onClear }) {
  const confirm = useConfirm();
  const boot = useBoot();
  const toast = useToast();
  const [action, setAction] = useState('assign');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState(boot.today);
  const [status, setStatus] = useState('휴원');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const targets = openRegularClasses(boot);

  const run = async () => {
    setError('');
    if (action === 'assign' && !target) return setError('배정할 반을 골라 주세요.');
    if (action === 'status' && status === '퇴원' && !(await confirm({ message: `선택한 ${ids.length}명을 퇴원 처리할까요? 다니는 반 배정이 모두 종료됩니다.`, confirmLabel: '퇴원 처리', danger: true }))) return;
    setSaving(true);
    try {
      if (action === 'assign') {
        const res = await api('assignStudentsToClass', { class_id: target, student_ids: ids, start_date: date, mode: 'add' });
        toast(`${res.count}명을 ${targets.find((c) => c.id === target).name}에 배정했습니다.`);
      } else {
        const res = await api('setStudentsStatus', { student_ids: ids, status });
        toast(`${res.count}명을 ${status}(으)로 바꿨습니다.`);
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card bulk-bar" style={{ marginBottom: 14 }}>
      <div className="cluster">
        <strong>선택한 {ids.length}명</strong>
        <div className="segmented" role="group" aria-label="할 일">
          <button type="button" aria-pressed={action === 'assign'} onClick={() => { setAction('assign'); setError(''); }}>반 배정</button>
          <button type="button" aria-pressed={action === 'status'} onClick={() => { setAction('status'); setError(''); }}>상태 변경</button>
        </div>
        <span className="muted">→</span>
        {action === 'assign' ? (
          <>
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="배정할 반" style={{ width: 'auto' }}>
              <option value="">배정할 반</option>
              {targets.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="시작일" style={{ width: 'auto' }} />
            <button type="button" className="btn sm" onClick={run} disabled={saving}>{saving ? '배정 중…' : '배정'}</button>
          </>
        ) : (
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="바꿀 상태" style={{ width: 'auto' }}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button type="button" className={'btn sm' + (status === '퇴원' ? ' danger' : '')} onClick={run} disabled={saving}>{saving ? '바꾸는 중…' : '상태 변경'}</button>
          </>
        )}
        <button type="button" className="btn ghost sm" onClick={onClear}>선택 해제</button>
      </div>
      {action === 'assign' ? <div className="hint" style={{ marginTop: 6 }}>다니던 반은 그대로 두고 추가 수강으로 배정합니다.</div> : null}
      {error ? <div className="error-box prewrap" role="alert" style={{ marginTop: 8 }}>{error}</div> : null}
    </div>
  );
}
