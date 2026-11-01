'use client';

import Link from 'next/link';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Async, EmptyState } from '@/components/ui/Feedback';
import { useBoot } from '@/components/shell/AppShell';
import { api, useApi } from '@/lib/client-api';
import { formatDate, shortDate } from '@/lib/format';
import { NoteForm, QuickCounsel, addDays, useNoteDelete } from './CounselingTab';

const PERIODS = [30, 90];
const clip = (text) => (text.length > 120 ? text.slice(0, 120) + '…' : text);

function PeriodPicker({ start, end, today, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="cl-period" ref={box}>
      <button type="button" className="btn secondary sm" aria-expanded={open} aria-label={`기간 ${start} ~ ${end}`} onClick={() => setOpen(!open)}>
        {shortDate(start)} ~ {shortDate(end)} <span aria-hidden="true">▾</span>
      </button>
      <div className="segmented" role="group" aria-label="빠른 기간">
        {PERIODS.map((d) => (
          <button key={d} type="button" aria-pressed={end === today && start === addDays(today, -d)} onClick={() => onChange(addDays(today, -d), today)}>{d}일</button>
        ))}
      </div>
      {open ? (
        <div className="cl-period-pop">
          <input type="date" value={start} max={end} onChange={(e) => e.target.value && onChange(e.target.value, end)} aria-label="시작일" />
          <span aria-hidden="true">~</span>
          <input type="date" value={end} min={start} onChange={(e) => e.target.value && onChange(start, e.target.value)} aria-label="종료일" />
        </div>
      ) : null}
    </div>
  );
}

function FollowUp({ n }) {
  return n.follow_up_date ? <>{shortDate(n.follow_up_date)} · {n.follow_up_title}</> : <span className="muted">-</span>;
}

/** Counseling notes of all students, searchable by period, kind and text. */
export default function CounselingLog() {
  const { today } = useBoot();
  const [start, setStart] = useState(addDays(today, -90));
  const [end, setEnd] = useState(today);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const q = useDeferredValue(query);
  const state = useApi(() => api('listCounselingNotes', { start, end, kind, query: q }), [start, end, kind, q]);
  const { pending, remove } = useNoteDelete((stillMounted) => { if (stillMounted) state.reload(); });
  const studentHref = (n) => `/students/${n.student_id}?tab=counseling`;
  const actions = (n) => (
    <>
      <button type="button" className="btn secondary sm" onClick={() => setEditing(n)} aria-label={`${n.student_name} ${formatDate(n.counsel_date)} 상담 수정`}>수정</button>
      <button type="button" className="btn ghost sm" onClick={() => remove(n)} aria-label={`${n.student_name} ${formatDate(n.counsel_date)} 상담 삭제`}>삭제</button>
    </>
  );

  return (
    <div className="stack">
      <QuickCounsel today={today} onSaved={state.reload} />
      <div className="cl-filters">
        <PeriodPicker start={start} end={end} today={today} onChange={(s, e) => { setStart(s); setEnd(e); }} />
        <div className="segmented" role="group" aria-label="상담 대상">
          {[['', '전체'], ['학부모', '학부모'], ['학생', '학생']].map(([v, l]) => <button key={l} type="button" aria-pressed={kind === v} onClick={() => setKind(v)}>{l}</button>)}
        </div>
        <input type="search" className="cl-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="학생 이름 · 내용 검색" aria-label="상담 검색" />
      </div>
      <Async state={state}>
        {(all) => {
          const rows = all.filter((n) => !pending.includes(n.note_id));
          return rows.length ? (
            <>
              <div className="table-wrap cl-table">
                <table className="data-table">
                  <thead><tr><th>날짜</th><th>학생</th><th>대상</th><th>내용</th><th>후속 조치</th><th /></tr></thead>
                  <tbody>
                    {rows.map((n) => (
                      <tr key={n.note_id}>
                        <td className="primary">{formatDate(n.counsel_date)}</td>
                        <td><Link href={studentHref(n)}>{n.student_name}</Link> <span className="muted">{n.grade}</span></td>
                        <td><span className={'tag ' + (n.kind === '학부모' ? '' : 'muted')}>{n.kind}</span></td>
                        <td>{n.title ? <strong>{n.title} </strong> : null}<span className="muted prewrap">{clip(n.content)}</span></td>
                        <td><FollowUp n={n} /></td>
                        <td className="cl-actions">{actions(n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="cl-cards" aria-label="상담 기록">
                {rows.map((n) => (
                  <li key={n.note_id} className="cl-card">
                    <div className="cl-card-head">
                      <Link className="cl-card-name" href={studentHref(n)}>{n.student_name} <span className="muted">{n.grade}</span> <span aria-hidden="true">›</span></Link>
                      <span className="cluster"><span className={'tag ' + (n.kind === '학부모' ? '' : 'muted')}>{n.kind}</span>{shortDate(n.counsel_date)}</span>
                    </div>
                    <div>{n.title ? <strong>{n.title} </strong> : null}<span className="muted prewrap">{clip(n.content)}</span></div>
                    {n.follow_up_date ? <div className="cl-card-follow">후속 <FollowUp n={n} /></div> : null}
                    <div className="cl-card-actions">{actions(n)}</div>
                  </li>
                ))}
              </ul>
            </>
          ) : <div className="card"><EmptyState title="이 조건의 상담 기록이 없습니다">기간을 넓히거나 검색어를 바꿔 보세요.</EmptyState></div>;
        }}
      </Async>
      {editing ? <NoteForm key={editing.note_id} studentId={editing.student_id} note={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} /> : null}
    </div>
  );
}
