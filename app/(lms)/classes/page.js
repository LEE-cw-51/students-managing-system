'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Async, EmptyState } from '@/components/ui/Feedback';
import ClassForm from '@/components/domain/class/ClassForm';
import { api, useApi } from '@/lib/client-api';
import { useBoot } from '@/components/shell/AppShell';
import { relativeDay, shortDate, timeSpan } from '@/lib/format';

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

export default function ClassesPage() {
  const router = useRouter();
  const { today } = useBoot();
  const [status, setStatus] = useState('운영');
  const [creating, setCreating] = useState(false);
  const state = useApi(() => api('getClassList', { class_type: '정규', status }), [status]);

  return (
    <>
      <PageHeader
        title="반"
        sub={<>반을 누르면 진도·숙제·테스트·강의 계획을 한 곳에서 관리합니다. 시험대비 반은 <Link href="/exams?tab=periods">시험 탭</Link>에서 편성합니다.</>}
        actions={<button type="button" className="btn" onClick={() => setCreating(true)}>반 등록</button>}
      />
      <div className="split" style={{ marginBottom: 14 }}>
        <div className="segmented" role="group" aria-label="운영 상태">
          {[['운영', '운영 중'], ['종료', '종료'], ['', '전체']].map(([v, label]) => (
            <button key={label} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>{label}</button>
          ))}
        </div>
      </div>
      <Async state={state}>
        {(rows) => rows.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead>
                <tr><th>반</th><th>요일 · 시간</th><th className="num">학생</th><th>다음 수업</th><th>현재 진도</th><th>교재</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.class_id} className="clickable" onClick={() => router.push(`/classes/${c.class_id}`)}>
                    <td className="primary">
                      <Link href={`/classes/${c.class_id}`} onClick={(e) => e.stopPropagation()}>{c.class_name}</Link>
                      <div className="cluster" style={{ marginTop: 4 }}>
                        {c.grade ? <span className="tag muted">{c.grade}</span> : null}
                        {c.status !== '운영' ? <span className="tag muted">{c.status}</span> : null}
                        <ExamTag exam={c.exam} />
                      </div>
                    </td>
                    <td data-label="요일 · 시간">{c.schedule_label || <span className="tag warn">시간표 없음</span>}</td>
                    <td data-label="학생" className="num">{c.student_count}명</td>
                    <td data-label="다음 수업"><NextCell next={c.next} today={today} /></td>
                    <td data-label="현재 진도">{c.current_progress || <span className="muted">-</span>}</td>
                    <td data-label="교재">{c.textbook || <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <EmptyState title={status === '종료' ? '종료된 반이 없습니다' : '등록된 반이 없습니다'}
              action={status !== '종료' ? <button type="button" className="btn" onClick={() => setCreating(true)}>첫 반 등록하기</button> : null}>
              반을 등록하고 학생을 배정하면 수업 기록을 시작할 수 있습니다.
            </EmptyState>
          </div>
        )}
      </Async>
      {creating ? (
        <ClassForm onClose={() => setCreating(false)} onSaved={(row) => router.push(`/classes/${row.class_id}`)} />
      ) : null}
    </>
  );
}
