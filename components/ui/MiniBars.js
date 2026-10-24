'use client';

import { useState } from 'react';

/**
 * Single-series vertical bar chart (one measure, one hue) with hover tooltip and
 * a label on the latest value. points: [{ label, value, display }], null values show as gaps.
 */
export default function MiniBars({ title, points, max, format = (v) => v, height = 120 }) {
  const [hover, setHover] = useState(null);
  const values = points.map((p) => p.value).filter((v) => v !== null && v !== undefined);
  const top = max || Math.max(1, ...values);
  const w = 100 / Math.max(points.length, 1);
  const lastIdx = points.map((p) => p.value !== null && p.value !== undefined).lastIndexOf(true);
  return (
    <figure className="minibars">
      <figcaption>{title}</figcaption>
      <div className="minibars-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={title}>
          <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} className="minibars-axis" />
          {points.map((p, i) => {
            if (p.value === null || p.value === undefined) return null;
            const h = Math.max(2, (p.value / top) * (height - 18));
            return (
              <rect key={i} x={i * w + w * 0.22} width={w * 0.56} y={height - h} height={h} rx="1.2"
                className={'minibars-bar' + (hover === i ? ' is-hover' : '')} />
            );
          })}
        </svg>
        {points.map((p, i) => (
          <button key={i} type="button" className="minibars-hit" style={{ left: `${i * w}%`, width: `${w}%` }}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            aria-label={`${p.label} ${p.value === null || p.value === undefined ? '기록 없음' : format(p.value)}`} />
        ))}
        {lastIdx >= 0 && hover === null ? (
          <span className="minibars-label" style={{ left: `${lastIdx * w + w / 2}%`, bottom: `${(points[lastIdx].value / top) * (height - 18) + 4}px` }}>
            {format(points[lastIdx].value)}
          </span>
        ) : null}
        {hover !== null ? (
          <div className="minibars-tip" style={{ left: `${hover * w + w / 2}%` }}>
            <strong>{points[hover].label}</strong>
            <span>{points[hover].value === null || points[hover].value === undefined ? '기록 없음' : format(points[hover].value)}</span>
          </div>
        ) : null}
      </div>
      <div className="minibars-x">
        {points.map((p, i) => <span key={i} style={{ width: `${w}%` }}>{p.label}</span>)}
      </div>
    </figure>
  );
}
