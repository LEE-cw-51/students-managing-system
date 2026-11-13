'use client';

export const RANGES = [
  { key: '1m', label: '최근 1개월', days: 31 },
  { key: '3m', label: '3개월', days: 92 },
  { key: '6m', label: '6개월', days: 183 }
];

/** 1 / 3 / 6 month switch for record lists; value is a RANGES key. */
export default function RangePicker({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="기간">
      {RANGES.map((r) => <button key={r.key} type="button" aria-pressed={value === r.key} onClick={() => onChange(r.key)}>{r.label}</button>)}
    </div>
  );
}
