'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/client-api';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import GlobalSearch from './GlobalSearch';
import AgentPanel, { AGENT_MODAL_QUERY, AGENT_WIDTH, clampAgentWidth } from './AgentPanel';

const BootContext = createContext(null);
const AGENT_OPEN_KEY = 'lms.agent.open';
const AGENT_WIDTH_KEY = 'lms.agent.width';
const NAV_COLLAPSED_KEY = 'lms.nav.collapsed';
// Must match .app-sidebar widths in app.css.
const SIDEBAR_WIDTH = 184;
const SIDEBAR_RAIL_WIDTH = 56;

function readPref(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writePref(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

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
const ADMIN_NAV = [{ href: '/admin/users', label: '계정 관리', icon: '⚿' }];

function isActive(pathname, href) {
  return pathname === href || pathname.startsWith(href + '/');
}

export default function AppShell({ boot: initialBoot, children }) {
  const pathname = usePathname();
  const [boot, setBoot] = useState(initialBoot);
  const [open, setOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const sidebarWidth = navCollapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH;
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentWidth, setAgentWidth] = useState(AGENT_WIDTH);
  const [agentResizing, setAgentResizing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // No push transition or slide-in until the user first opens or closes the panel, so a
  // panel restored on load appears in place.
  const [instant, setInstant] = useState(true);
  const toggleAgent = useCallback(() => { setInstant(false); setAgentOpen((v) => !v); }, []);
  const closeAgent = useCallback(() => { setInstant(false); setAgentOpen(false); }, []);
  const resizeAgent = useCallback((w, phase) => {
    const next = clampAgentWidth(w, sidebarWidth);
    setAgentWidth(next);
    setAgentResizing(phase === 'move');
    if (phase === 'end') writePref(AGENT_WIDTH_KEY, String(next));
  }, [sidebarWidth]);
  const toggleNav = () => {
    setNavCollapsed(!navCollapsed);
    writePref(NAV_COLLAPSED_KEY, String(!navCollapsed));
  };

  // Restored after mount so the server render stays the same; reopening only where it pushes the page.
  useEffect(() => {
    const saved = Number(readPref(AGENT_WIDTH_KEY));
    if (saved) setAgentWidth(saved);
    if (readPref(AGENT_OPEN_KEY) === 'true' && !window.matchMedia(AGENT_MODAL_QUERY).matches) setAgentOpen(true);
    if (readPref(NAV_COLLAPSED_KEY) === 'true') setNavCollapsed(true);
    setPrefsLoaded(true);
  }, []);

  // Only the user's own open/close is saved, so a visit on a narrow screen keeps the preference.
  useEffect(() => {
    if (!instant) writePref(AGENT_OPEN_KEY, String(agentOpen));
  }, [instant, agentOpen]);

  // A smaller window shows the panel narrower; the chosen width comes back when it grows again.
  const [, setViewport] = useState(0);
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const shownWidth = prefsLoaded ? clampAgentWidth(agentWidth, sidebarWidth) : agentWidth;

  // Server-only fields (ai_enabled, agent_enabled, user) come from the layout and survive a refresh.
  const refresh = useCallback(() => api('getShellBootstrap').then((next) => setBoot((prev) => ({ ...next, ai_enabled: prev.ai_enabled, agent_enabled: prev.agent_enabled, user: prev.user }))).catch(() => {}), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Ctrl+J (⌘J) opens or closes the AI assistant from any screen.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleAgent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAgent]);

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

  // The sidebar shows who is using it; the academy name stays for reports and PDFs.
  const teacher = ((boot.settings && boot.settings.teacher_name) || '').trim();
  const brand = teacher ? `${teacher} 선생님` : '학생 관리 시스템';

  return (
    <BootContext.Provider value={{ ...boot, refresh }}>
      <ToastProvider>
      <ConfirmProvider>
        <a className="skip-link" href="#main">본문으로 건너뛰기</a>
        <div
          className="app"
          data-agent-open={agentOpen ? 'true' : 'false'}
          data-nav-collapsed={navCollapsed ? 'true' : 'false'}
          data-instant={instant ? '' : undefined}
          data-resizing={agentResizing ? '' : undefined}
          style={{ '--agent-w': shownWidth + 'px' }}
        >
          {open ? <div className="app-scrim" onClick={() => setOpen(false)} aria-hidden="true" /> : null}
          <aside className="app-sidebar" id="app-sidebar" data-open={open ? 'true' : 'false'}>
            <div className="brand" title={navCollapsed ? brand : undefined}>
              <div className="brand-mark" aria-hidden="true">{teacher ? teacher.slice(0, 1) : '학'}</div>
              <strong className="display nav-label">{brand}</strong>
            </div>
            <nav className="app-nav" aria-label="주요 메뉴">
              {(boot.user && boot.user.role === 'admin' ? NAV.concat(ADMIN_NAV) : NAV).map((item) => (
                <Link key={item.href} href={item.href} title={navCollapsed ? item.label : undefined} aria-current={isActive(pathname, item.href) ? 'page' : undefined}>
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              ))}
            </nav>
            <div className="app-sidebar-foot">
              <button
                type="button"
                className="nav-collapse"
                aria-label={navCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                title={navCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
                onClick={toggleNav}
              >
                <span aria-hidden="true">{navCollapsed ? '»' : '«'}</span>
                <span className="nav-label">접기</span>
              </button>
              <button type="button" className="nav-logout" title={navCollapsed ? '로그아웃' : undefined} onClick={logout}>
                <span className="nav-icon" aria-hidden="true">⎋</span>
                <span className="nav-label">로그아웃</span>
              </button>
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
              <button
                type="button"
                className="agent-toggle"
                aria-expanded={agentOpen}
                aria-keyshortcuts="Control+J"
                title="AI 비서 (Ctrl+J)"
                onClick={toggleAgent}
              >
                <span aria-hidden="true">✦</span> AI 비서
              </button>
            </header>
            <main className="app-content" id="main" tabIndex={-1}>{children}</main>
          </div>
          <AgentPanel
            open={agentOpen}
            onClose={closeAgent}
            aiEnabled={Boolean(boot.agent_enabled)}
            today={boot.today}
            classes={boot.search && boot.search.classes}
            students={boot.search && boot.search.students}
            width={shownWidth}
            sidebarWidth={sidebarWidth}
            onResize={resizeAgent}
          />
        </div>
      </ConfirmProvider>
      </ToastProvider>
    </BootContext.Provider>
  );
}
