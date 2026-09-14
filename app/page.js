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
        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-mark">수</div>
            <div>
              <strong id="brand-name">수학의 힘</strong>
              <span>학습관리 시스템</span>
            </div>
          </div>
          <nav id="nav"></nav>
        </aside>
        <div className="shell">
          <header className="topbar">
            <button className="icon-btn" id="menu-btn" type="button" aria-label="메뉴">☰</button>
            <h1 id="page-title">대시보드</h1>
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
