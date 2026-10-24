'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/** URL-driven tabs (?tab=key) so back/refresh/bookmarks keep the tab. */
export function useTab(tabs) {
  const params = useSearchParams();
  const key = params.get('tab');
  return tabs.some((t) => t.key === key) ? key : tabs[0].key;
}

export default function Tabs({ tabs, current }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const hrefFor = (key) => {
    const next = new URLSearchParams(params.toString());
    if (key === tabs[0].key) next.delete('tab');
    else next.set('tab', key);
    const qs = next.toString();
    return pathname + (qs ? '?' + qs : '');
  };
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <Link key={t.key} href={hrefFor(t.key)} role="tab" aria-selected={t.key === current} scroll={false} replace>
          {t.label}{t.count !== undefined && t.count !== null ? <span className="muted"> {t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
