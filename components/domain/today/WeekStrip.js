'use client';

import { addDays } from '@/lib/format';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

/**
 * Mon–Sun strip of the selected week with class/makeup/open-task counts; the page's only date navigation.
 * `week` is getTodayBoard's `week`; until the board for a date in that week loads, the seven days show as placeholders.
 */
export default function WeekStrip({ date, today, week, onPick }) {
  const loaded = Boolean(week && week.some((w) => w.date === date));
  return (
    <nav className="week-nav" aria-label="날짜 이동">
      <button type="button" className="btn secondary week-step" aria-label="지난주" onClick={() => onPick(addDays(date, -7))}>◀<span className="week-step-label"> 지난주</span></button>
      <div className="week-strip" aria-busy={!loaded}>
        {!loaded ? DAYS.map((name) => (
          <span key={name} className="week-day" style={{ cursor: 'default' }} aria-hidden="true">
            <span className="wd-name">{name}</span>
            <span className="wd-date">·</span>
            <span className="wd-count">–</span>
            <span className="wd-dots">–</span>
          </span>
        )) : week.map((w) => {
          const d = w.date;
          const classes = Number(w.class_count) || 0;
          const makeups = Number(w.makeup_count) || 0;
          const tasks = Number(w.task_count) || 0;
          const summary = [classes ? `수업 ${classes}` : '', makeups ? `보강 ${makeups}` : '', tasks ? `할 일 ${tasks}` : ''].filter(Boolean).join(' · ');
          return (
            <button key={d} type="button" className={'week-day' + (d === date ? ' is-selected' : '') + (d === today ? ' is-today' : '')}
              aria-current={d === date ? 'date' : undefined} onClick={() => onPick(d)}>
              <span className="wd-name">{w.weekday}</span>
              <span className="wd-date">{Number(d.slice(8))}</span>
              <span className="wd-count">{summary || '–'}</span>
              <span className="wd-dots" aria-hidden="true">{classes || makeups ? '•'.repeat(Math.min(classes, 4)) + '◦'.repeat(Math.min(makeups, 2)) : '–'}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="btn secondary week-step" aria-label="다음 주" onClick={() => onPick(addDays(date, 7))}><span className="week-step-label">다음 주 </span>▶</button>
      <input type="date" className="week-pick" value={date} aria-label="날짜 선택" onChange={(e) => e.target.value && onPick(e.target.value)} />
    </nav>
  );
}
