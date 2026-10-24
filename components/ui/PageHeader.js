import Link from 'next/link';

/** Page title row: optional breadcrumbs [{href,label}], subtitle and action buttons. */
export default function PageHeader({ title, crumbs, sub, actions }) {
  return (
    <div className="page-header">
      <div>
        {crumbs && crumbs.length ? (
          <nav className="crumbs" aria-label="위치">
            {crumbs.map((c, i) => (
              <span key={c.href || i}>
                {i ? ' / ' : ''}
                {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
              </span>
            ))}
          </nav>
        ) : null}
        <h1 className="display">{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
