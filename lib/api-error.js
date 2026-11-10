const BUG_TYPES = [TypeError, ReferenceError, RangeError, SyntaxError];

// Errors thrown on purpose with one of these codes keep the code and get this status.
const CODE_STATUS = {
  CONVERSATION_NOT_FOUND: 404,
  AGENT_RATE_LIMITED: 429
};

const HANGUL = /[\uAC00-\uD7A3]/;

/**
 * Errors the teacher was never meant to read: built-in runtime errors (bugs), database and
 * network failures, and any message without Korean (messages for the teacher are Korean).
 */
function isInternal(e) {
  if (BUG_TYPES.some((T) => e instanceof T)) return true;
  if (!e || typeof e !== 'object') return !HANGUL.test(String(e));
  if (e.name === 'PostgresError' || typeof e.errno === 'number' || typeof e.syscall === 'string') return true;
  return !HANGUL.test(String(e.message || ''));
}

/**
 * JSON reply for an error thrown while handling a request.
 * Internal errors (isInternal) are logged and hidden behind a generic 500.
 * Other errors carry a message meant for the teacher and keep the 200 reply,
 * except the coded ones in CODE_STATUS.
 */
export function errorResponse(e) {
  const { error, code, status } = errorDetails(e);
  if (code) return Response.json({ ok: false, error, code }, { status });
  return Response.json({ ok: false, error }, { status });
}

/** The teacher-facing message, code and HTTP status for an error, by the rules above. */
export function errorDetails(e) {
  if (isInternal(e)) {
    console.error(e);
    return { error: '서버 오류가 발생했습니다.', code: '', status: 500 };
  }
  const error = e && e.message ? e.message : String(e);
  const code = e && typeof e.code === 'string' && Object.prototype.hasOwnProperty.call(CODE_STATUS, e.code) ? e.code : '';
  return { error, code, status: code ? CODE_STATUS[code] : 200 };
}
