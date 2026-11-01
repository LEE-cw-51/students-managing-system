'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** URL-driven tabs (?tab=key) so back/refresh/bookmarks keep the tab. */
export function useTab(tabs) {
  const params = useSearchParams();
  const key = params.get('tab');
  return tabs.some((t) => t.key === key) ? key : tabs[0].key;
}

/** `scrollHint` fades the right edge with › while tabs overflow and keeps the current tab in view. */
export default function Tabs({ tabs, current, scrollHint }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const listRef = useRef(null);
  const [more, setMore] = useState(false);
  const hrefFor = (key) => {
    const next = new URLSearchParams(params.toString());
    if (key === tabs[0].key) next.delete('tab');
    else next.set('tab', key);
    const qs = next.toString();
    return pathname + (qs ? '?' + qs : '');
  };

  useEffect(() => {
    const el = listRef.current;
    if (!scrollHint || !el) return undefined;
    const measure = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    const reveal = () => {
      const active = el.querySelector('[aria-selected="true"]');
      if (active) {
        const left = active.offsetLeft - el.offsetLeft;
        if (left < el.scrollLeft) el.scrollLeft = left - 16;
        else if (left + active.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left + active.offsetWidth - el.clientWidth + 32;
      }
      measure();
    };
    reveal();
    const resize = new ResizeObserver(reveal);
    resize.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      resize.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [scrollHint, current]);

  const list = (
    <div className="tabs" role="tablist" ref={listRef}>
      {tabs.map((t) => (
        <Link key={t.key} href={hrefFor(t.key)} role="tab" aria-selected={t.key === current} scroll={false} replace>
          {t.label}{t.count !== undefined && t.count !== null ? <span className="muted"> {t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
  if (!scrollHint) return list;
  return (
    <div className={'tabs-wrap' + (more ? ' has-more' : '')}>
      {list}
      {more ? <span className="tabs-more" aria-hidden="true">›</span> : null}
    </div>
  );
}
