'use client';

import TimeInput from './TimeInput';

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** Per-weekday schedule editor: value = [{ day, start, end }]. */
export default function WeekdaySchedule({ value, onChange }) {
  const list = value || [];
  const byDay = Object.fromEntries(list.map((s) => [s.day, s]));
  const emit = (next) => onChange(DAYS.map((d) => next[d]).filter(Boolean));

  const toggle = (day) => {
    const next = { ...byDay };
    if (next[day]) delete next[day];
    else {
      const first = list[0];
      next[day] = { day, start: first ? first.start : '', end: first ? first.end : '' };
    }
    emit(next);
  };
  const setTime = (day, key, t) => emit({ ...byDay, [day]: { ...byDay[day], [key]: t } });
  const applyFirst = () => {
    const first = list[0];
    if (!first) return;
    emit(Object.fromEntries(list.map((s) => [s.day, { ...s, start: first.start, end: first.end }])));
  };
  const order = (s) => DAYS.indexOf(s.day);
  const sorted = [...list].sort((a, b) => order(a) - order(b));
  const badEnd = (s) => s.start && s.end && s.end <= s.start;

  return (
    <div>
      <div className="weekday-picker" role="group" aria-label="수업 요일">
        {DAYS.map((d) => (
          <button key={d} type="button" aria-pressed={!!byDay[d]} onClick={() => toggle(d)}>{d}</button>
        ))}
      </div>
      {sorted.length ? (
        <div className="schedule-rows">
          {sorted.map((s) => (
            <div className="schedule-row" key={s.day}>
              <span className="day">{s.day}</span>
              <TimeInput value={s.start} label={`${s.day}요일 시작 시간`} onChange={(t) => setTime(s.day, 'start', t)} />
              <span aria-hidden="true">~</span>
              <TimeInput value={s.end} label={`${s.day}요일 종료 시간`} onChange={(t) => setTime(s.day, 'end', t)} />
              {badEnd(s) ? <span className="error-text">종료가 시작보다 늦어야 합니다</span> : null}
            </div>
          ))}
          {sorted.length > 1 ? (
            <div><button type="button" className="link-btn" onClick={applyFirst}>첫 줄 시간을 전체에 적용</button></div>
          ) : null}
        </div>
      ) : <div className="hint" style={{ marginTop: 8 }}>요일을 눌러 수업 시간을 추가하세요. 시간은 숫자로 입력합니다 (예: 1800).</div>}
    </div>
  );
}
