'use client';

import { useState } from 'react';

/** "단원 / 횟수" per line → rows. Lines without a count get 1 meeting. */
export function parseCurriculumText(text, textbook) {
  return String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const m = /^(.*?)\s*[/|,\t]\s*(\d+)\s*(회)?$/.exec(line);
    return { unit_id: '', textbook: textbook || '', title: (m ? m[1] : line).trim(), sessions: m ? Number(m[2]) : 1 };
  }).filter((u) => u.title);
}

/**
 * Ordered unit list for the class. unit_id stays on each row through edits and moves so the
 * plans that already point at a unit stay linked. "지금" marks where the class is when the list is
 * entered: every unit before it is stored as completed, so the first draft starts there.
 */
export default function CurriculumEditor({ value, onChange, textbook }) {
  const rows = value || [];
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const update = (i, key, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => {
    if (rows[i].unit_id && !window.confirm(`‘${rows[i].title}’ 단원을 뺄까요? 이 단원으로 잡힌 계획은 단원 연결만 끊기고 남아 있습니다.`)) return;
    onChange(rows.filter((_, j) => j !== i));
  };
  const total = rows.reduce((n, r) => n + (Number(r.sessions) || 0), 0);
  const currentIndex = rows.some((r) => r.completed) ? rows.findIndex((r) => !r.completed) : 0;
  const setCurrent = (i) => onChange(rows.map((r, j) => ({ ...r, completed: j < i })));

  return (
    <div className="stack-sm">
      {rows.length ? (
        <ol className="curriculum-rows">
          {rows.map((r, i) => (
            <li key={r.unit_id || `new-${i}`}>
              <input aria-label={`${i + 1}번째 단원 이름`} value={r.title} onChange={(e) => update(i, 'title', e.target.value)} placeholder="단원 이름" />
              <input aria-label={`${i + 1}번째 단원 수업 횟수`} inputMode="numeric" className="curriculum-sessions" value={r.sessions}
                onChange={(e) => update(i, 'sessions', e.target.value.replace(/\D/g, ''))} />
              <span className="muted">회</span>
              <label className="check-label curriculum-done" title="지금 나가는 단원 (앞 단원은 끝난 것으로 봅니다)">
                <input type="radio" name="curriculum-current" checked={i === currentIndex} onChange={() => setCurrent(i)} /> 지금
              </label>
              <span className="cluster">
                <button type="button" className="btn ghost sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">▲</button>
                <button type="button" className="btn ghost sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="아래로">▼</button>
                <button type="button" className="btn ghost sm" onClick={() => remove(i)} aria-label="빼기">✕</button>
              </span>
            </li>
          ))}
        </ol>
      ) : <span className="hint">단원을 순서대로 넣으면 강의 계획 초안을 실제 수업일에 맞춰 만들 수 있습니다.</span>}
      {rows.length ? <span className="hint">‘지금’은 지금 나가는 단원입니다. 그 앞 단원은 끝난 것으로 보고 다음 초안을 이 단원부터 짭니다.</span> : null}
      <div className="cluster">
        <button type="button" className="btn secondary sm" onClick={() => onChange([...rows, { unit_id: '', textbook: textbook || '', title: '', sessions: 1 }])}>단원 추가</button>
        <button type="button" className="btn ghost sm" onClick={() => setPasting((v) => !v)}>여러 줄 붙여넣기</button>
        {rows.length ? <span className="muted">총 {rows.length}단원 · {total}회</span> : null}
      </div>
      {pasting ? (
        <div className="stack-sm">
          <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="단원 목록 붙여넣기"
            placeholder={'한 줄에 한 단원, 수업 횟수는 / 뒤에\n1. 다항식의 연산 / 3\n2. 나머지정리 / 2'} />
          <div className="cluster">
            <button type="button" className="btn sm" disabled={!paste.trim()} onClick={() => { onChange([...rows, ...parseCurriculumText(paste, textbook)]); setPaste(''); setPasting(false); }}>목록에 추가</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
