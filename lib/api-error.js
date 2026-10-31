const BUG_TYPES = [TypeError, ReferenceError, RangeError, SyntaxError];

// Errors thrown on purpose with one of these codes keep the code and get this status.
const CODE_STATUS = {
  CONVERSATION_NOT_FOUND: 404,
  AGENT_RATE_LIMITED: 429
};

/**
 * JSON reply for an error thrown while handling a request.
 * Built-in runtime errors are bugs: log them and hide the details behind a generic 500.
 * Other errors carry a message meant for the teacher and keep the 200 reply,
 * except the coded ones in CODE_STATUS.
 */
export function errorResponse(e) {
  if (BUG_TYPES.some((T) => e instanceof T)) {
    console.error(e);
    return Response.json({ ok: false, error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
  const error = e && e.message ? e.message : String(e);
  const code = e && typeof e.code === 'string' && Object.prototype.hasOwnProperty.call(CODE_STATUS, e.code) ? e.code : '';
  if (code) return Response.json({ ok: false, error, code }, { status: CODE_STATUS[code] });
  return Response.json({ ok: false, error });
}
