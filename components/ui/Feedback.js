'use client';

export function Loading({ label = '불러오는 중…' }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

/** Light Suspense fallback for list/detail pages (uses --skeleton-* tokens). */
export function PageSkeleton({ rows = 4 }) {
  return (
    <div className="page-skeleton" role="status" aria-label="불러오는 중">
      <div className="skeleton page-skeleton-title" />
      <div className="skeleton page-skeleton-sub" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton page-skeleton-row" style={{ width: `${88 - (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      {error.message || String(error)}
      {onRetry ? <> <button type="button" className="link-btn" onClick={onRetry}>다시 시도</button></> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state">
      {title ? <strong>{title}</strong> : null}
      {children ? <div>{children}</div> : null}
      {action || null}
    </div>
  );
}

/** Standard loading / error / content switch for a useApi() result. */
export function Async({ state, children, label }) {
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading label={label} />;
  return (
    <>
      {state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : null}
      {children(state.data)}
    </>
  );
}

export function Kpi({ label, value, note, tone }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {note ? <div className="kpi-note">{note}</div> : null}
    </div>
  );
}

/** Tablet-width hint for tables that scroll horizontally (641–980px). */
export function TableScroll({ children, className }) {
  return (
    <div className={'table-scroll' + (className ? ' ' + className : '')}>
      <p className="table-scroll-hint">좌우로 밀어 보세요</p>
      {children}
    </div>
  );
}
