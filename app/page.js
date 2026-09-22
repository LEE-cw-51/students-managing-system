import { redirect } from 'next/navigation';
import Script from 'next/script';
import { isAuthed } from '../lib/auth.js';
import { withService } from '../lib/store.js';

export const dynamic = 'force-dynamic';

export default async function Page() {
  if (!(await isAuthed())) redirect('/login');

  let boot = null;
  try {
    boot = await withService((api) => api.getBootstrap());
  } catch (e) {
    boot = { error: e.message || String(e) };
  }
  const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');

  return (
    <>
      <div id="app">
        <div id="nav-backdrop" className="nav-backdrop" hidden></div>
        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-mark">학</div>
            <div>
              <strong id="brand-name" className="display">학생 관리 시스템</strong>
              <span>수업 · 성적 · 상담</span>
            </div>
          </div>
          <nav id="nav" aria-label="주요 메뉴"></nav>
          <div className="sidebar-foot">
            <button className="nav-logout" id="logout-btn" type="button">로그아웃</button>
          </div>
        </aside>
        <div className="shell">
          <header className="topbar">
            <button className="icon-btn" id="menu-btn" type="button" aria-label="메뉴" aria-expanded="false" aria-controls="sidebar">☰</button>
            <h1 id="page-title" className="display">대시보드</h1>
            <span id="top-date" className="muted"></span>
          </header>
          <main id="main" className="main"><div className="card empty">불러오는 중...</div></main>
        </div>
      </div>
      <div id="toast" className="toast hidden"></div>
      <Script id="lms-boot" strategy="beforeInteractive">
        {`window.__LMS_BOOT__ = ${bootJson};`}
      </Script>
      <Script src="/lms-client.js" strategy="afterInteractive" />
    </>
  );
}
