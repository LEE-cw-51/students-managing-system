import Link from 'next/link';

/** Page title row: optional back link, crumbs, subtitle, badges slot, and action buttons. */
export default function PageHeader({ title, back, crumbs, sub, badges, actions, className }) {
  return (
    <div className={'page-header' + (className ? ' ' + className : '')}>
      <div className="page-header-title">
        {back ? <Link className="rec-back" href={back.href}>{back.label}</Link> : null}
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
        {sub ? <span className="sub">{sub}</span> : null}
        {badges || null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
