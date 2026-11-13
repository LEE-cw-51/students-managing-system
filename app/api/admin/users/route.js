import { listUsers, ROLES, INVITE_TTL_HOURS, RESET_TTL_HOURS } from '../../../../lib/accounts.js';
import { adminRoute } from '../../../../lib/admin-api.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every account with its workspaces, plus the admin's own workspace for "invite into my workspace". */
export const GET = adminRoute(async ({ session }) => {
  const users = await listUsers();
  const me = users.find((u) => u.id === session.uid);
  const mine = me && me.workspaces.find((w) => w.id === session.wid);
  return {
    users: users.map(({ session_version, ...u }) => u),
    me: session.uid,
    workspace: { id: session.wid, name: mine ? mine.name : '' },
    roles: ROLES,
    invite_ttl_hours: INVITE_TTL_HOURS,
    reset_ttl_hours: RESET_TTL_HOURS
  };
});
