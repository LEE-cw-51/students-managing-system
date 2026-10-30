'use client';

import { useState } from 'react';
import { formatDate, score, shortDate } from '@/lib/format';

/**
 * Two-series line chart on a fixed 0–100 scale.
 * points are oldest first: { date, title, score, average, rank, taken }.
 * score and average are already converted to 100 points; null is a gap.
 */
export default function GradeTrend({ points, height = 168 }) {
  const [hover, setHover] = useState(null);
  const n = Math.max(points.length, 1);
  const col = 100 / n;
  const xAt = (i) => (i + 0.5) * col;
  const top = 8;
  const bottom = height - 10;
  const yAt = (v) => bottom - (Math.min(100, Math.max(0, Number(v))) / 100) * (bottom - top);

  const segments = (key) => {
    const parts = [];
    let seg = [];
    points.forEach((p, i) => {
      const v = p[key];
      if (v === null || v === undefined || !isFinite(Number(v))) {
        if (seg.length) parts.push(seg.join(' '));
        seg = [];
      } else {
        seg.push(`${xAt(i)},${yAt(v)}`);
      }
    });
    if (seg.length) parts.push(seg.join(' '));
    return parts;
  };

  const missing = (v) => v === null || v === undefined;
  const detail = (p) => missing(p.score)
    ? ['미응시', `반 평균 ${score(p.average)}`]
    : [`환산 ${score(p.score)}`, `반 평균 ${score(p.average)}`, missing(p.rank) ? null : `${p.rank}등 / ${p.taken}명`].filter(Boolean);

  const latest = [...points].reverse().find((p) => p.score !== null && p.score !== undefined) || null;
  const labelStep = Math.max(1, Math.ceil(points.length / 8));

  return (
    <figure className="grade-trend">
      <figcaption className="grade-trend-head">
        <span>성적 추이 (100점 환산)</span>
        <span className="grade-trend-legend">
          <span><i className="student" />학생 {latest ? score(latest.score) : '-'}</span>
          <span><i className="avg" />반 평균 {latest && latest.average !== null && latest.average !== undefined ? score(latest.average) : '-'}</span>
        </span>
      </figcaption>
      <div className="grade-trend-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="grade-trend-y" aria-hidden="true">
          {[100, 50, 0].map((tick) => <span key={tick} style={{ top: yAt(tick) }}>{tick}</span>)}
        </div>
        <div className="grade-trend-canvas">
          <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label="100점 환산 성적 추이. 남색은 학생, 주황은 반 평균">
            {[100, 50, 0].map((tick) => (
              <line key={tick} x1="0" x2="100" y1={yAt(tick)} y2={yAt(tick)} className={'grade-trend-grid' + (tick === 0 ? ' is-axis' : '')} />
            ))}
            {segments('average').map((d, i) => <polyline key={'a' + i} points={d} className="grade-trend-line avg" />)}
            {segments('score').map((d, i) => <polyline key={'s' + i} points={d} className="grade-trend-line student" />)}
          </svg>
          {points.map((p, i) => (
            <button key={p.date + (p.title || '') + i} type="button" className="grade-trend-hit"
              style={{ left: `${xAt(i)}%`, width: `${col}%` }}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`${formatDate(p.date)} ${p.title || '테스트'}, ${detail(p).join(', ')}`} />
          ))}
          {points.map((p, i) => (
            p.average === null || p.average === undefined ? null : (
              <span key={'ad' + i} className={'grade-trend-dot avg' + (hover === i ? ' is-hover' : '')} style={{ left: `${xAt(i)}%`, top: yAt(p.average) }} />
            )
          ))}
          {points.map((p, i) => (
            p.score === null || p.score === undefined ? null : (
              <span key={'sd' + i} className={'grade-trend-dot student' + (hover === i ? ' is-hover' : '')} style={{ left: `${xAt(i)}%`, top: yAt(p.score) }} />
            )
          ))}
          {hover !== null ? (
            <div className={'grade-trend-tip' + (points.length > 1 && hover === 0 ? ' is-start' : '') + (points.length > 1 && hover === points.length - 1 ? ' is-end' : '')}
              style={{ left: `${xAt(hover)}%` }}>
              <strong>{formatDate(points[hover].date)}</strong>
              <span>{points[hover].title || '테스트'}</span>
              {detail(points[hover]).map((line) => <span key={line}>{line}</span>)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="grade-trend-x">
        {points.map((p, i) => (
          <span key={p.date + i} style={{ width: `${col}%` }}>{i % labelStep === 0 || i === points.length - 1 ? shortDate(p.date) : ''}</span>
        ))}
      </div>
    </figure>
  );
}
