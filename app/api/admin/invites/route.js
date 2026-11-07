import { createInvite } from '../../../../lib/accounts.js';
import { adminError, adminRoute, jsonBody } from '../../../../lib/admin-api.js';

export const runtime = 'nodejs';

/**
 * { email, name, role, workspace: 'new' | 'mine' } -> { path, expires_at, email }.
 * 'new' gives the invitee a workspace of their own; 'mine' adds them to the admin's current workspace.
 */
export const POST = adminRoute(async ({ req, session }) => {
  const body = await jsonBody(req);
  const target = body.workspace === undefined ? 'new' : body.workspace;
  if (target !== 'new' && target !== 'mine') throw adminError('작업공간 선택이 올바르지 않습니다.');
  const email = String(body.email || '').trim();
  const { path, expiresAt } = await createInvite({
    email,
    name: String(body.name || ''),
    role: String(body.role || 'teacher'),
    createdBy: session.uid,
    workspaceId: target === 'mine' ? session.wid : null
  });
  return { path, expires_at: expiresAt, email: email.toLowerCase() };
});
