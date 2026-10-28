'use client';

import { useMemo } from 'react';
import { useUrlState } from '@/components/ui/useUrlState';

const collator = new Intl.Collator('ko', { numeric: true });
const blank = (v) => v === null || v === undefined || v === '';

/**
 * Click-to-sort table columns, kept in the URL as ?sort=name or ?sort=-name.
 * `getters` maps a column key to a function returning the row's sort value; empty values go last.
 * No sort key keeps the server's order.
 */
export function useSort(rows, getters) {
  const [sort, setSort] = useUrlState('sort', '');
  const desc = sort.startsWith('-');
  const key = getters[desc ? sort.slice(1) : sort] ? (desc ? sort.slice(1) : sort) : '';
  const sorted = useMemo(() => {
    if (!key) return rows;
    const get = getters[key];
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (blank(x) || blank(y)) return blank(x) - blank(y);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
      return desc ? -c : c;
    });
    // getters is recreated each render; key/desc capture the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, desc]);
  // Ascending → descending → off.
  const toggle = (k) => setSort(k !== key ? k : desc ? '' : '-' + k);
  return { rows: sorted, key, desc, toggle };
}

/** <SortTh sort={sort} col="name">이름</SortTh> */
export function SortTh({ sort, col, className, children }) {
  const active = sort.key === col;
  return (
    <th className={className} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" className="sort-btn" onClick={() => sort.toggle(col)}>
        {children}
        <span className="sort-arrow" aria-hidden="true">{active ? (sort.desc ? '▼' : '▲') : '↕'}</span>
      </button>
    </th>
  );
}
