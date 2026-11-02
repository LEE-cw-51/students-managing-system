'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Async, EmptyState } from '@/components/ui/Feedback';
import ClassForm from '@/components/domain/class/ClassForm';
import { api, useApi } from '@/lib/client-api';
import { useBoot } from '@/components/shell/AppShell';
import { relativeDay, shortDate, timeSpan } from '@/lib/format';
import { useUrlState } from '@/components/ui/useUrlState';
import { SortTh, useSort } from '@/components/ui/useSort';

function NextCell({ next, today }) {
  if (!next) return <span className="muted">-</span>;
  const rel = relativeDay(next.date, today);
  return (
    <span>
      {rel === '오늘' ? <span className="tag ok">오늘</span> : shortDate(next.date)} {timeSpan(next.time)}
    </span>
  );
}

function ExamTag({ exam }) {
  if (!exam || !exam.period) return null;
  if (exam.kind === 'suspended') return <span className="tag amber">시험대비 휴강</span>;
  if (exam.kind === 'upcoming') return <span className="tag muted">휴강 예정 {shortDate(exam.period.start_date)}~</span>;
  return null;
}

function ClassTags({ c }) {
  return (
    <>
      {c.grade ? <span className="tag muted">{c.grade}</span> : null}
      {c.status !== '운영' ? <span className="tag muted">{c.status}</span> : null}
      <ExamTag exam={c.exam} />
    </>
  );
}

const isSuspended = (c) => !!(c.exam && c.exam.period && c.exam.kind === 'suspended');

const SORT = {
  name: (c) => c.class_name,
  students: (c) => c.student_count,
  next: (c) => (c.next ? `${c.next.date} ${c.next.time || ''}` : null)
};

function ClassTable({ rows, today }) {
  const sort = useSort(rows, SORT);
  return (
    <div className="table-wrap cls-table">
      <table className="data-table">
        <thead>
          <tr><SortTh sort={sort} col="name">반</SortTh><th>요일 · 시간</th><SortTh sort={sort} col="students" className="num">학생</SortTh><SortTh sort={sort} col="next">다음 수업</SortTh><th>현재 진도</th><th>교재</th></tr>
        </thead>
        <tbody>
          {sort.rows.map((c) => (
            <tr key={c.class_id}>
              <td className="primary">
                <span className="cls-name">
                  <Link href={`/classes/${c.class_id}`}>{c.class_name}</Link>
                  <ClassTags c={c} />
                </span>
              </td>
              <td>{c.schedule_label || <span className="tag warn">시간표 없음</span>}</td>
              <td className="num">{c.student_count}명</td>
              <td><NextCell next={c.next} today={today} /></td>
              <td>{c.current_progress || <span className="muted">-</span>}</td>
              <td>{c.textbook || <span className="muted">-</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassCards({ rows, today }) {
  return (
    <ul className="cls-cards" aria-label="반">
      {rows.map((c) => (
        <li key={c.class_id} className="cls-card">
          <div className="cls-card-head">
            <Link className="cls-card-name" href={`/classes/${c.class_id}`}>{c.class_name} <span aria-hidden="true">›</span></Link>
            <ClassTags c={c} />
            {c.next ? <span className="cls-card-next"><NextCell next={c.next} today={today} /></span> : null}
          </div>
          <div className="cls-card-line">
            {c.schedule_label || <span className="tag warn">시간표 없음</span>} <span className="cls-count-line">· {c.student_count}명</span>
          </div>
          <div className="cls-card-line muted">
            {[`진도 ${c.current_progress || '-'}`, c.textbook].filter(Boolean).join(' · ')}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ClassesPage() {
  return (
    <Suspense fallback={null}>
      <ClassesView />
    </Suspense>
  );
}

function ClassesView() {
  const router = useRouter();
  const { today, search } = useBoot();
  const [status, setStatus] = useUrlState('status', '운영');
  const [exam, setExam] = useUrlState('exam', '');
  const examOnly = exam === '1';
  const [creating, setCreating] = useState(false);
  const state = useApi(() => api('getClassList', { class_type: '정규' }), []);

  const regular = (search.classes || []).filter((c) => c.class_type === '정규');
  const count = (s) => regular.filter((c) => c.status === s).length;
  const students = (search.students || []).filter((s) => s.status === '재원' && (s.class_ids || []).length).length;
  const byStatus = (state.data || []).filter((c) => !status || c.status === status);
  const rows = examOnly ? byStatus.filter(isSuspended) : byStatus;
  const suspendedCount = byStatus.filter(isSuspended).length;

  return (
    <div className="classes-page">
      <PageHeader
        title="반"
        sub={`운영 ${count('운영')}개 · 학생 ${students}명`}
        actions={<button type="button" className="btn" onClick={() => setCreating(true)}>반 등록</button>}
      />
      <div className="cls-filters">
        <div className="segmented" role="group" aria-label="운영 상태">
          {[['운영', '운영 중', count('운영')], ['종료', '종료', count('종료')], ['', '전체']].map(([v, label, n]) => (
            <button key={label} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>
              {label}{n !== undefined ? <span className="cls-count"> {n}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className={'btn sm ' + (examOnly ? '' : 'secondary')} aria-pressed={examOnly} onClick={() => setExam(examOnly ? '' : '1')}>
          시험대비 휴강만{state.data ? ` (${suspendedCount})` : ''}
        </button>
        <Link className="cls-exam-link" href="/exams?tab=periods">시험대비 반 편성은 시험 탭 →</Link>
      </div>
      <Async state={state}>
        {() => rows.length ? (
          <>
            <ClassTable rows={rows} today={today} />
            <ClassCards rows={rows} today={today} />
          </>
        ) : (
          <div className="card">
            {examOnly && byStatus.length ? (
              <EmptyState title="시험대비 휴강 중인 반이 없습니다">‘시험대비 휴강만’을 끄면 모든 반이 보입니다.</EmptyState>
            ) : (
              <EmptyState title={status === '종료' ? '종료된 반이 없습니다' : '등록된 반이 없습니다'}
                action={status !== '종료' ? <button type="button" className="btn" onClick={() => setCreating(true)}>첫 반 등록하기</button> : null}>
                반을 등록하고 학생을 배정하면 수업 기록을 시작할 수 있습니다.
              </EmptyState>
            )}
          </div>
        )}
      </Async>
      {creating ? (
        <ClassForm onClose={() => setCreating(false)} onSaved={(row) => router.push(`/classes/${row.class_id}`)} />
      ) : null}
    </div>
  );
}
