import { createPasswordReset } from '../../../../../../lib/accounts.js';
import { adminRoute } from '../../../../../../lib/admin-api.js';

export const runtime = 'nodejs';

/** One-time password reset link for the user -> { path, expires_at }. Earlier reset links stop working. */
export const POST = adminRoute(async ({ params, session }) => {
  const { path, expiresAt } = await createPasswordReset({ userId: params.id, createdBy: session.uid });
  return { path, expires_at: expiresAt };
});
