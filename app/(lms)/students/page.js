'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import Tabs, { useTab } from '@/components/ui/Tabs';
import CounselingLog from '@/components/domain/student/CounselingLog';
import PageHeader from '@/components/ui/PageHeader';
import { Async, EmptyState } from '@/components/ui/Feedback';
import Badges from '@/components/domain/Badges';
import StudentForm from '@/components/domain/student/StudentForm';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { relativeDay, shortDate } from '@/lib/format';
import { dDayLabel } from '@/lib/term';

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
  const [status, setStatus] = useState('재원');
  const [grade, setGrade] = useState('');
  const [classId, setClassId] = useState('');
  const [query, setQuery] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const startCreate = onCreate;
  const deferredQuery = useDeferredValue(query);
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
  const flaggedCount = (state.data || []).filter((r) => r.badges.some((b) => b.tone !== 'muted')).length;

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
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className={'btn sm ' + (onlyFlagged ? '' : 'secondary')} aria-pressed={onlyFlagged} onClick={() => setOnlyFlagged((v) => !v)}>
            ⚠ 주의 학생만{state.data ? ` (${flaggedCount})` : ''}
          </button>
        </div>
        <div className="segmented" role="group" aria-label="재원 상태">
          {[['재원', '재원'], ['휴원', '휴원'], ['퇴원', '퇴원'], ['', '전체']].map(([v, label]) => (
            <button key={label} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</button>
          ))}
        </div>
      </div>
      <Async state={state}>
        {() => rows.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th>이름</th><th>학년 · 학교</th><th>반</th><th>최근 수업</th><th>다음 학교 시험</th><th>학부모 연락처</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.student_id} className="clickable" onClick={() => router.push(`/students/${r.student_id}`)}>
                    <td className="primary">
                      <Link href={`/students/${r.student_id}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                      {r.status !== '재원' ? <span className="tag muted" style={{ marginLeft: 6 }}>{r.status}</span> : null}
                      <div style={{ marginTop: 4 }}><Badges badges={r.badges} quiet /></div>
                    </td>
                    <td data-label="학년 · 학교">{[r.grade, r.school].filter(Boolean).join(' · ') || '-'}{!r.school && r.status === '재원' ? <span className="tag warn" style={{ marginLeft: 4 }}>학교 미입력</span> : null}</td>
                    <td data-label="반">{r.classes.length ? r.classes.map((c) => (
                      <span key={c.rel_id} className={'tag ' + (c.assignment_type === '임시' ? 'amber' : 'muted')} style={{ marginRight: 4 }}>{c.class_name}</span>
                    )) : <span className="muted">없음</span>}</td>
                    <td data-label="최근 수업">{r.last_lesson_date ? `${shortDate(r.last_lesson_date)} · ${relativeDay(r.last_lesson_date, boot.today)}` : <span className="muted">-</span>}</td>
                    <td data-label="다음 시험">{r.next_exam ? <>{shortDate(r.next_exam.date)} <span className={'tag ' + (r.next_exam.d_day <= 7 ? 'danger' : r.next_exam.d_day <= 21 ? 'amber' : '')}>{dDayLabel(r.next_exam.d_day)}</span></> : <span className="muted">-</span>}</td>
                    <td data-label="학부모">{r.parent_phone ? <a href={`tel:${r.parent_phone}`} onClick={(e) => e.stopPropagation()}>{r.parent_phone}</a> : <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
