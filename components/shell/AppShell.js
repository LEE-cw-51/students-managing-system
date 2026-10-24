'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import { ToastProvider } from '@/components/ui/Toast';
import GlobalSearch from './GlobalSearch';

const BootContext = createContext(null);

/** Settings, today and the search index loaded by the layout; refresh() re-reads them. */
export function useBoot() {
  return useContext(BootContext);
}

const NAV = [
  { href: '/today', label: '오늘', icon: '◷' },
  { href: '/students', label: '학생', icon: '◉' },
  { href: '/classes', label: '반', icon: '▦' },
  { href: '/exams', label: '시험', icon: '✓' },
  { href: '/reports', label: '보고서', icon: '✎' },
  { href: '/settings', label: '설정', icon: '⚙' }
];

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(href + '/');
}

function formatToday(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const day = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  return `${y}년 ${m}월 ${d}일 (${day})`;
}

export default function AppShell({ boot: initialBoot, children }) {
  const pathname = usePathname();
  const [boot, setBoot] = useState(initialBoot);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => api('getShellBootstrap').then(setBoot).catch(() => {}), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const logout = () => {
    fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .finally(() => { window.location.href = '/login'; });
  };

  const academy = (boot.settings && boot.settings.academy_name) || '학생 관리 시스템';

  return (
    <BootContext.Provider value={{ ...boot, refresh }}>
      <ToastProvider>
        <div className="app">
          {open ? <div className="app-scrim" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
          <aside className="app-sidebar" id="app-sidebar" data-open={open ? 'true' : 'false'}>
            <div className="brand">
              <div className="brand-mark" aria-hidden="true">학</div>
              <div>
                <strong className="display">{academy}</strong>
                <span>수업 · 성적 · 상담</span>
              </div>
            </div>
            <nav className="app-nav" aria-label="주요 메뉴">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="app-sidebar-foot">
              <a href="/legacy">이전 화면 열기</a>
              <button type="button" onClick={logout}>로그아웃</button>
            </div>
          </aside>
          <div className="app-main">
            <header className="app-topbar">
              <button
                type="button"
                className="menu-toggle"
                aria-label="메뉴 열기"
                aria-expanded={open}
                aria-controls="app-sidebar"
                onClick={() => setOpen((v) => !v)}
              >☰</button>
              <GlobalSearch index={boot.search} />
              <span className="today">{formatToday(boot.today)}</span>
            </header>
            <main className="app-content" id="main">{children}</main>
          </div>
        </div>
      </ToastProvider>
    </BootContext.Provider>
  );
}
