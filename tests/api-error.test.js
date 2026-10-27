'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { errorResponse } = require('../lib/api-error.js');

describe('errorResponse', () => {
  it('passes a teacher-facing message through with status 200', async () => {
    const res = errorResponse(new Error('학생 정보를 찾을 수 없습니다.'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: false, error: '학생 정보를 찾을 수 없습니다.' });
  });

  it('logs built-in runtime errors and answers 500 with a generic message', async (t) => {
    const logged = [];
    t.mock.method(console, 'error', (e) => logged.push(e));
    for (const e of [new TypeError("Cannot read properties of undefined (reading 'x')"), new ReferenceError('y is not defined'), new RangeError('bad'), new SyntaxError('bad json')]) {
      const res = errorResponse(e);
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { ok: false, error: '서버 오류가 발생했습니다.' });
    }
    assert.equal(logged.length, 4);
  });

  it('handles non-Error throws', async () => {
    const res = errorResponse('문자열 오류');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: false, error: '문자열 오류' });
  });
});
