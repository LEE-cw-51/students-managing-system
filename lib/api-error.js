const BUG_TYPES = [TypeError, ReferenceError, RangeError, SyntaxError];

/**
 * JSON reply for an error thrown while handling a request.
 * Built-in runtime errors are bugs: log them and hide the details behind a generic 500.
 * Other errors carry a message meant for the teacher and keep the 200 reply.
 */
export function errorResponse(e) {
  if (BUG_TYPES.some((T) => e instanceof T)) {
    console.error(e);
    return Response.json({ ok: false, error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
  return Response.json({ ok: false, error: e && e.message ? e.message : String(e) });
}
