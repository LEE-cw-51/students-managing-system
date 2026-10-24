'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, shortDate } from '@/lib/format';

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Counseling notes of all students, searchable by period, kind and text. */
export default function CounselingLog() {
  const { today } = useBoot();
  const [start, setStart] = useState(addDays(today, -90));
  const [end, setEnd] = useState(today);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query);
  const state = useApi(() => api('listCounselingNotes', { start, end, kind, query: q }), [start, end, kind, q]);
  return (
    <div className="stack">
      <div className="cluster">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="시작일" style={{ width: 'auto' }} />
        <span aria-hidden="true">~</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="종료일" style={{ width: 'auto' }} />
        <div className="segmented" role="group" aria-label="상담 대상">
          {[['', '전체'], ['학부모', '학부모'], ['학생', '학생']].map(([v, l]) => <button key={l} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>)}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="학생 이름 · 내용 검색" aria-label="상담 검색" style={{ width: 220 }} />
      </div>
      <Async state={state}>
        {(rows) => rows.length ? (
          <div className="table-wrap">
            <table className="data-table stack-mobile">
              <thead><tr><th>날짜</th><th>학생</th><th>대상</th><th>내용</th><th>후속 조치</th></tr></thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.note_id}>
                    <td className="primary">{formatDate(n.counsel_date)}</td>
                    <td data-label="학생"><Link href={`/students/${n.student_id}?tab=counseling`}>{n.student_name}</Link> <span className="muted">{n.grade}</span></td>
                    <td data-label="대상"><span className={'tag ' + (n.kind === '학부모' ? '' : 'muted')}>{n.kind}</span></td>
                    <td data-label="내용">{n.title ? <strong>{n.title} </strong> : null}<span className="muted prewrap">{n.content.length > 120 ? n.content.slice(0, 120) + '…' : n.content}</span></td>
                    <td data-label="후속 조치">{n.follow_up_date ? `${shortDate(n.follow_up_date)} · ${n.follow_up_title}` : <span className="muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card"><EmptyState title="이 조건의 상담 기록이 없습니다">기간을 넓히거나 검색어를 바꿔 보세요.</EmptyState></div>}
      </Async>
    </div>
  );
}
