'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_RESULTS = 8;

function norm(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, '');
}

/** Rank students and classes for the query: name prefix > name contains > school/class/phone. */
export function searchIndex(index, query) {
  const q = norm(query);
  if (!q) return [];
  const digits = q.replace(/\D/g, '');
  const scored = [];
  (index?.students || []).forEach((s) => {
    const name = norm(s.name);
    let score = 0;
    if (name.startsWith(q)) score = 100;
    else if (name.includes(q)) score = 80;
    else if (norm(s.school).includes(q)) score = 40;
    else if (s.classes.some((c) => norm(c).includes(q))) score = 30;
    else if (digits.length >= 3 && s.phones.some((p) => p.includes(digits))) score = 60;
    if (!score) return;
    if (s.status === '퇴원') score -= 15;
    scored.push({
      kind: 'student',
      key: 'S' + s.id,
      href: `/students/${s.id}`,
      title: s.name,
      meta: [s.grade, s.school, s.classes.join(', '), s.status !== '재원' ? s.status : ''].filter(Boolean).join(' · '),
      score
    });
  });
  (index?.classes || []).forEach((c) => {
    const name = norm(c.name);
    let score = 0;
    if (name.startsWith(q)) score = 90;
    else if (name.includes(q)) score = 70;
    if (!score) return;
    if (c.status !== '운영') score -= 15;
    scored.push({
      kind: 'class',
      key: 'C' + c.id,
      href: `/classes/${c.id}`,
      title: c.name,
      meta: [c.class_type === '시험대비' ? '시험대비' : '', c.schedule_label, c.status !== '운영' ? c.status : ''].filter(Boolean).join(' · '),
      score
    });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ko'))
    .slice(0, MAX_RESULTS);
}

export default function GlobalSearch({ index }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchIndex(index, query), [index, query]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const go = (item) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    router.push(item.href);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="gsearch" role="search">
      <span className="gsearch-icon" aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="학생·반 검색 (이름, 학교, 전화 뒷자리)"
        aria-label="학생·반 검색"
        role="combobox"
        aria-expanded={showList}
        aria-controls="gsearch-list"
        aria-activedescendant={showList && results[active] ? 'gs-' + results[active].key : undefined}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {!query ? <kbd>Ctrl K</kbd> : null}
      {showList ? (
        <ul className="gsearch-results" id="gsearch-list" role="listbox">
          {results.length ? results.map((item, i) => (
            <li key={item.key} id={'gs-' + item.key} role="option" aria-selected={i === active}>
              <Link href={item.href} onMouseDown={(e) => { e.preventDefault(); go(item); }} onMouseEnter={() => setActive(i)}>
                <span className={'tag ' + (item.kind === 'class' ? 'amber' : '')}>{item.kind === 'class' ? '반' : '학생'}</span>
                <strong>{item.title}</strong>
                <span className="meta">{item.meta}</span>
              </Link>
            </li>
          )) : <li className="gsearch-empty">‘{query}’와 일치하는 학생이나 반이 없습니다.</li>}
        </ul>
      ) : null}
    </div>
  );
}
