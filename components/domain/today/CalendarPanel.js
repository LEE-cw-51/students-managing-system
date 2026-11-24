'use client';

import { useMemo } from 'react';
import { api, useApi } from '@/lib/client-api';
import { addDays } from '@/lib/format';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const MONTH_CHIP_LIMIT = 3;
const TYPE_LABEL = { class: '수업', makeup: '보강', task: '할 일', exam: '시험' };
const TYPE_DOT = { class: '•', makeup: '◦', task: '▪', exam: '★' };

function iso(y, m, d) {
  const dt = new Date(y, m, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m: m - 1, d };
}

/** Monday of the week containing `date`. */
function mondayOf(date) {
  const { y, m, d } = parse(date);
  const dow = new Date(y, m, d).getDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** Same day-of-month `delta` months away, clamped to that month's last day. */
function addMonths(date, delta) {
  const { y, m, d } = parse(date);
  const last = new Date(y, m + delta + 1, 0).getDate();
  return iso(y, m + delta, Math.min(d, last));
}

/** The days the panel shows and loads: one Mon–Sun week, or whole weeks covering the month (4–6 rows). */
export function calendarDays(date, view) {
  if (view === 'month') {
    const { y, m } = parse(date);
    const first = iso(y, m, 1);
    const last = iso(y, m + 1, 0);
    const start = mondayOf(first);
    const end = addDays(mondayOf(last), 6);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
    return days;
  }
  const start = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function periodLabel(date, view, days) {
  if (view === 'month') {
    const { y, m } = parse(date);
    return `${y}년 ${m + 1}월`;
  }
  const short = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8))}`;
  return `${short(days[0])} ~ ${short(days[days.length - 1])}`;
}

function chipText(ev) {
  if (ev.type === 'task') return `${ev.done ? '✓ ' : ''}${ev.title}`;
  if (ev.type === 'exam') {
    const badge = ev.d_day_label || ev.day_label;
    return `${badge ? `${badge} ` : ''}${ev.title}`;
  }
  const time = ev.start_time ? `${ev.start_time} ` : '';
  return `${ev.type === 'makeup' ? '보강 ' : ''}${time}${ev.title}`;
}

function Chip({ ev }) {
  const cls = `cal-chip cal-${ev.type}${ev.done ? ' is-done' : ''}${ev.type === 'exam' && ev.d_day_tone ? ' tone-' + ev.d_day_tone : ''}`;
  const text = chipText(ev);
  return <span className={cls} title={text}>{text}</span>;
}

function counts(events) {
  const c = { class: 0, makeup: 0, task: 0, exam: 0 };
  events.forEach((ev) => { c[ev.type] += 1; });
  return c;
}

function summaryOf(c) {
  return Object.keys(TYPE_LABEL).filter((k) => c[k]).map((k) => `${TYPE_LABEL[k]} ${c[k]}`).join(', ');
}

function dotsOf(c) {
  return Object.keys(TYPE_DOT).map((k) => TYPE_DOT[k].repeat(Math.min(c[k], 3))).join('');
}

/**
 * Home calendar: a Mon–Sun week or a month grid of classes, makeups, tasks and school exams.
 * Picking a day (or stepping with 이전/다음/오늘로) calls `onPick(date)`; `onView` switches 주간/월간.
 * `refresh` is any value that changes when the board below was reloaded, so edits there show here too.
 */
export default function CalendarPanel({ date, today, view, refresh, onPick, onView }) {
  const days = useMemo(() => calendarDays(date, view), [date, view]);
  const start = days[0];
  const end = days[days.length - 1];
  const cal = useApi(() => api('getCalendarView', start, end), [start, end, refresh]);

  // useApi keeps the previous result while the next range loads (or fails); only data for this exact range may be drawn.
  const current = cal.data && cal.data.start === start && cal.data.end === end ? cal.data : null;
  const byDate = useMemo(() => {
    const map = {};
    ((current && current.events) || []).forEach((ev) => { (map[ev.date] = map[ev.date] || []).push(ev); });
    return map;
  }, [current]);
  const loaded = Boolean(current);
  const step = (dir) => onPick(view === 'month' ? addMonths(date, dir) : addDays(date, 7 * dir));
  const unit = view === 'month' ? '달' : '주';

  return (
    <section className="cal" aria-label="달력">
      <div className="cal-bar">
        <div className="cal-nav">
          <button type="button" className="btn secondary cal-step" aria-label={`지난${unit}`} onClick={() => step(-1)}>◀<span className="cal-step-label"> 이전</span></button>
          <strong className="cal-period" aria-live="polite">{periodLabel(date, view, days)}</strong>
          <button type="button" className="btn secondary cal-step" aria-label={`다음 ${unit}`} onClick={() => step(1)}><span className="cal-step-label">다음 </span>▶</button>
        </div>
        <div className="cal-tools">
          <button type="button" className="btn secondary cal-today" onClick={() => onPick(today)} disabled={date === today}>오늘로</button>
          <input type="date" className="cal-pick" value={date} aria-label="날짜 선택" onChange={(e) => e.target.value && onPick(e.target.value)} />
          <div className="cal-toggle" role="group" aria-label="보기 방식">
            <button type="button" className={'cal-toggle-btn' + (view === 'week' ? ' is-on' : '')} aria-pressed={view === 'week'} onClick={() => onView('week')}>주간</button>
            <button type="button" className={'cal-toggle-btn' + (view === 'month' ? ' is-on' : '')} aria-pressed={view === 'month'} onClick={() => onView('month')}>월간</button>
          </div>
        </div>
      </div>
      {cal.error ? (
        <p className="hint cal-error" role="alert">
          달력을 불러오지 못했습니다. {cal.error.message}{' '}
          <button type="button" className="btn secondary sm" onClick={() => cal.reload()}>다시 시도</button>
        </p>
      ) : null}
      <div className="cal-head" aria-hidden="true">
        {DAYS.map((name) => <span key={name} className={name === '토' || name === '일' ? 'is-weekend' : ''}>{name}</span>)}
      </div>
      <div className={`cal-grid is-${view}`} aria-busy={cal.loading}>
        {days.map((d) => {
          const events = byDate[d] || [];
          const c = counts(events);
          const summary = summaryOf(c);
          const dim = view === 'month' && d.slice(0, 7) !== date.slice(0, 7);
          const shown = view === 'month' ? events.slice(0, MONTH_CHIP_LIMIT) : events;
          const more = events.length - shown.length;
          const cls = 'cal-day' + (d === date ? ' is-selected' : '') + (d === today ? ' is-today' : '') + (dim ? ' is-dim' : '');
          return (
            <button key={d} type="button" className={cls} aria-current={d === date ? 'date' : undefined}
              aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일${summary ? ', ' + summary : ''}`} onClick={() => onPick(d)}>
              <span className="cal-num">{Number(d.slice(8))}</span>
              {loaded ? (
                <>
                  <span className="cal-chips">
                    {shown.map((ev, i) => <Chip key={i} ev={ev} />)}
                    {more > 0 ? <span className="cal-more">+{more}개</span> : null}
                  </span>
                  <span className="cal-dots" aria-hidden="true">{dotsOf(c)}</span>
                </>
              ) : <span className="cal-chips cal-placeholder" aria-hidden="true">·</span>}
            </button>
          );
        })}
      </div>
      <p className="cal-legend hint" aria-hidden="true">• 수업 ◦ 보강 ▪ 할 일 ★ 시험</p>
    </section>
  );
}
