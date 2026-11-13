'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toast';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { addDays, formatDate } from '@/lib/format';

/** Pick a date and class; every student's daily report ready to copy for parents. */
export default function DailyReports({ date, classId, onChange, head }) {
  const boot = useBoot();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const meeting = useApi(() => api('getDailyReportClasses', date), [date]);
  const meetingIds = useMemo(() => new Set((meeting.data && meeting.data.class_ids) || []), [meeting.data]);
  const classes = (boot.search.classes || []).filter((c) => c.status === '운영' || meetingIds.has(c.id) || c.id === classId);
  const met = classes.filter((c) => meetingIds.has(c.id));
  const board = useApi(() => (classId ? api('getDailyReportBoard', date, classId) : Promise.resolve(null)), [date, classId]);
  const copy = (text, label) => navigator.clipboard.writeText(text).then(() => toast(`${label} 복사했습니다.`), () => toast('복사하지 못했습니다.', 'error'));
  const shown = classId && board.data ? board.data : null;
  const reports = shown ? shown.reports : [];
  const copyAll = () => {
    const text = [...reports].sort((a, b) => a.student_name.localeCompare(b.student_name, 'ko')).map((r) => r.text).join('\n\n' + '─'.repeat(20) + '\n\n');
    copy(text, `${reports.length}명 보고서를`);
  };
  const className = shown ? shown.class.class_name : (classes.find((c) => c.id === classId) || {}).name;

  return (
    <>
      {head(
        [formatDate(date), className, shown ? `${reports.length}명` : ''].filter(Boolean).join(' · '),
        reports.length ? <button type="button" className="btn" onClick={copyAll}>전체 복사 ({reports.length}명)</button> : null
      )}
      <div className="stack">
        <div className="rp-filters">
          <span className="rp-pick">
            <button type="button" className="btn secondary sm rp-step" aria-label="하루 전" onClick={() => onChange({ date: addDays(date, -1) })}>◀</button>
            <input type="date" value={date} onChange={(e) => e.target.value && onChange({ date: e.target.value })} aria-label="날짜" />
            <button type="button" className="btn secondary sm rp-step" aria-label="하루 뒤" onClick={() => onChange({ date: addDays(date, 1) })}>▶</button>
            <select value={classId} onChange={(e) => onChange({ class: e.target.value })} aria-label="반">
              <option value="">반 선택</option>
              {met.length ? (
                <optgroup label="이 날 수업한 반">
                  {met.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ) : null}
              <optgroup label="다른 반">
                {classes.filter((c) => !meetingIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            </select>
          </span>
          {met.length ? (
            <span className="rp-chips" role="group" aria-label="이 날 수업한 반">
              <span className="muted">이 날 수업한 반</span>
              {met.map((c) => (
                <button key={c.id} type="button" className={'btn sm' + (c.id === classId ? '' : ' secondary')} aria-pressed={c.id === classId} onClick={() => onChange({ class: c.id })}>{c.name}</button>
              ))}
            </span>
          ) : null}
        </div>
        {!classId ? (
          <div className="card"><EmptyState title="반을 고르세요">{met.length ? `${formatDate(date)}에 수업한 반이 위에 버튼으로 나옵니다.` : `${formatDate(date)}에 수업한 반이 없습니다. 날짜를 바꾸거나 반을 직접 고르세요.`}</EmptyState></div>
        ) : (
          <Async state={board}>
            {(d) => d ? (
              <>
                {d.missing.length ? (
                  <div className="notice-bar rp-missing">
                    <span>수업 기록이 없는 학생 {d.missing.length}명: {d.missing.map((m) => m.name).join(', ')}</span>
                    <Link href={`/today?class=${classId}&date=${date}`}>수업 기록하기 →</Link>
                  </div>
                ) : null}
                {d.reports.length ? (
                  <div className="report-list">
                    {d.reports.map((r) => (
                      <article key={r.lesson_id} className="card report-card">
                        <div className="card-head">
                          <h3><Link href={`/students/${r.student_id}`}>{r.student_name}</Link></h3>
                          <span className="cluster">
                            <button type="button" className="btn ghost sm" aria-expanded={open === r.lesson_id} onClick={() => setOpen(open === r.lesson_id ? null : r.lesson_id)}>{open === r.lesson_id ? '접기' : '전체 보기'}</button>
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
    </>
  );
}
