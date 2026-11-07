import { setUserDisabled } from '../../../../../../lib/accounts.js';
import { adminError, adminRoute, jsonBody } from '../../../../../../lib/admin-api.js';

export const runtime = 'nodejs';

/** { disabled: boolean } -> the updated user. Disabling signs the user out at once. */
export const POST = adminRoute(async ({ req, params, session }) => {
  const body = await jsonBody(req);
  if (typeof body.disabled !== 'boolean') throw adminError('요청이 올바르지 않습니다.');
  if (body.disabled && params.id === session.uid) throw adminError('지금 로그인한 내 계정은 비활성화할 수 없습니다.');
  const { session_version, ...user } = await setUserDisabled(params.id, body.disabled);
  return user;
});
