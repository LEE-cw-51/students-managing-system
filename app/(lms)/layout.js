import { redirect } from 'next/navigation';
import { getSession, serviceFor } from '../../lib/auth.js';
import { isAiConfigured, isAgentConfigured } from '../../lib/ai-client.js';
import AppShell from '@/components/shell/AppShell';
import './app.css';

export const dynamic = 'force-dynamic';

export default async function LmsLayout({ children }) {
  const session = await getSession();
  if (!session) redirect('/login');
  let boot;
  try {
    boot = await serviceFor(session)((api) => api.getShellBootstrap());
  } catch (e) {
    boot = { settings: {}, grades: [], today: '', search: { students: [], classes: [] }, error: e.message || String(e) };
  }
  boot = {
    ...boot,
    ai_enabled: isAiConfigured(),
    agent_enabled: isAgentConfigured(),
    user: { email: session.email, name: session.name, role: session.role }
  };
  return (
    <AppShell boot={boot}>
      {boot.error ? <div className="error-box" role="alert">데이터를 불러오지 못했습니다: {boot.error}</div> : null}
      {children}
    </AppShell>
  );
}
