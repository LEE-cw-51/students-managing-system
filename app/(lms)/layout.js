import { redirect } from 'next/navigation';
import { isAuthed } from '../../lib/auth.js';
import { withService } from '../../lib/store.js';
import { isMonthlyAiConfigured } from '../../lib/monthly-ai.js';
import AppShell from '@/components/shell/AppShell';
import './app.css';

export const dynamic = 'force-dynamic';

export default async function LmsLayout({ children }) {
  if (!(await isAuthed())) redirect('/login');
  let boot;
  try {
    boot = await withService((api) => api.getShellBootstrap());
  } catch (e) {
    boot = { settings: {}, grades: [], today: '', search: { students: [], classes: [] }, error: e.message || String(e) };
  }
  boot = { ...boot, ai_enabled: isMonthlyAiConfigured() };
  return (
    <AppShell boot={boot}>
      {boot.error ? <div className="error-box" role="alert">데이터를 불러오지 못했습니다: {boot.error}</div> : null}
      {children}
    </AppShell>
  );
}
