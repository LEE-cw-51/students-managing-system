'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';

/** Horizontal button row; on narrow screens fades the right edge with › while more is hidden. */
const ScrollRow = forwardRef(function ScrollRow({ className = '', label, children }, outer) {
  const listRef = useRef(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      resize.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  return (
    <nav className={'scroll-row ' + className + (more ? ' has-more' : '')} aria-label={label} ref={outer}>
      <div className="scroll-row-list" ref={listRef}>{children}</div>
      {more ? <span className="scroll-row-more" aria-hidden="true">›</span> : null}
    </nav>
  );
});

export default ScrollRow;
