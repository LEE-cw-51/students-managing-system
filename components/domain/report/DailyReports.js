'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate } from '@/lib/format';

/** Pick a date and class; every student's daily report ready to copy for parents. */
export default function DailyReports({ date, classId, onChange }) {
  const boot = useBoot();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영');
  const meeting = useApi(() => api('getTodayBoard', date), [date]);
  const meetingIds = useMemo(() => new Set(((meeting.data && meeting.data.classes) || []).map((c) => c.class_id)), [meeting.data]);
  const board = useApi(() => (classId ? api('getDailyReportBoard', date, classId) : Promise.resolve(null)), [date, classId]);
  const copy = (text, label) => navigator.clipboard.writeText(text).then(() => toast(`${label} 복사했습니다.`), () => toast('복사하지 못했습니다.', 'error'));

  return (
    <div className="stack">
      <div className="cluster">
        <input type="date" value={date} onChange={(e) => e.target.value && onChange({ date: e.target.value })} aria-label="날짜" style={{ width: 'auto' }} />
        <select value={classId} onChange={(e) => onChange({ class: e.target.value })} aria-label="반" style={{ width: 'auto' }}>
          <option value="">반 선택</option>
          {classes.filter((c) => meetingIds.has(c.id)).length ? (
            <optgroup label="이 날 수업한 반">
              {classes.filter((c) => meetingIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ) : null}
          <optgroup label="다른 반">
            {classes.filter((c) => !meetingIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        </select>
        {!classId && meetingIds.size ? (
          <span className="cluster">
            {classes.filter((c) => meetingIds.has(c.id)).map((c) => (
              <button key={c.id} type="button" className="btn secondary sm" onClick={() => onChange({ class: c.id })}>{c.name}</button>
            ))}
          </span>
        ) : null}
      </div>
      {!classId ? (
        <div className="card"><EmptyState title="반을 고르세요">{formatDate(date)}에 수업한 반이 위에 버튼으로 나옵니다.</EmptyState></div>
      ) : (
        <Async state={board}>
          {(d) => d ? (
            <>
              {d.missing.length ? (
                <div className="notice-bar">
                  수업 기록이 없는 학생 {d.missing.length}명: {d.missing.map((m) => m.name).join(', ')} —{' '}
                  <Link href={`/today?class=${classId}&date=${date}`}>수업 기록하기</Link>
                </div>
              ) : null}
              {d.reports.length ? (
                <div className="report-list">
                  {d.reports.map((r) => (
                    <article key={r.lesson_id} className="card report-card">
                      <div className="card-head">
                        <h3><Link href={`/students/${r.student_id}`}>{r.student_name}</Link></h3>
                        <span className="cluster">
                          <button type="button" className="link-btn" aria-expanded={open === r.lesson_id} onClick={() => setOpen(open === r.lesson_id ? null : r.lesson_id)}>{open === r.lesson_id ? '접기' : '전체 보기'}</button>
                          <button type="button" className="btn sm" onClick={() => copy(r.text, `${r.student_name} 보고서를`)}>복사</button>
                        </span>
                      </div>
                      <pre className={'report-text' + (open === r.lesson_id ? '' : ' is-clamped')}>{r.text}</pre>
                    </article>
                  ))}
                </div>
              ) : <div className="card"><EmptyState title="이 날 이 반의 수업 기록이 없습니다" action={<Link className="btn" href={`/today?class=${classId}&date=${date}`}>수업 기록하기</Link>} /></div>}
            </>
          ) : null}
        </Async>
      )}
    </div>
  );
}
