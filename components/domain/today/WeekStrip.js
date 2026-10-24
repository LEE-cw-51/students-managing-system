'use client';

import { api, useApi } from '@/lib/client-api';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

function weekDates(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  const monday = new Date(y, m - 1, d - ((base.getDay() + 6) % 7));
  return DAYS.map((_, i) => {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  });
}

/** Mon–Sun strip of the selected week with class/makeup counts; click a day to open it. */
export default function WeekStrip({ date, today, onPick }) {
  const dates = weekDates(date);
  const state = useApi(() => api('getCalendar', dates[0], dates[6]), [dates[0]]);
  const counts = {};
  ((state.data && state.data.events) || []).forEach((ev) => {
    counts[ev.date] = counts[ev.date] || { classes: 0, makeups: 0 };
    if (ev.event_type === '정규' || ev.event_type === '시험대비') counts[ev.date].classes += 1;
    else counts[ev.date].makeups += 1;
  });
  return (
    <nav className="week-strip" aria-label="이번 주">
      {dates.map((d, i) => {
        const c = counts[d] || { classes: 0, makeups: 0 };
        return (
          <button key={d} type="button" className={'week-day' + (d === date ? ' is-selected' : '') + (d === today ? ' is-today' : '')}
            aria-current={d === date ? 'date' : undefined} onClick={() => onPick(d)}>
            <span className="wd-name">{DAYS[i]}</span>
            <span className="wd-date">{Number(d.slice(8))}</span>
            <span className="wd-count">{c.classes ? `수업 ${c.classes}` : '–'}{c.makeups ? ` · 보강 ${c.makeups}` : ''}</span>
          </button>
        );
      })}
    </nav>
  );
}
