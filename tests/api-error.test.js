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

  it('keeps known error codes with their status and ignores others', async () => {
    const coded = (message, code) => Object.assign(new Error(message), { code });
    const gone = errorResponse(coded('대화를 찾을 수 없습니다.', 'CONVERSATION_NOT_FOUND'));
    assert.equal(gone.status, 404);
    assert.deepEqual(await gone.json(), { ok: false, error: '대화를 찾을 수 없습니다.', code: 'CONVERSATION_NOT_FOUND' });
    const busy = errorResponse(coded('잠시 뒤에 다시 시도해 주세요.', 'AGENT_RATE_LIMITED'));
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).code, 'AGENT_RATE_LIMITED');
    const other = errorResponse(coded('연결 오류', 'ECONNREFUSED'));
    assert.equal(other.status, 200);
    assert.deepEqual(await other.json(), { ok: false, error: '연결 오류' });
  });

  it('hides database, network and other non-Korean messages behind a generic 500', async (t) => {
    const logged = [];
    t.mock.method(console, 'error', (e) => logged.push(e));
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "kv_pkey"'), { name: 'PostgresError', code: '23505' });
    const net = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED', errno: -111, syscall: 'connect' });
    const closed = Object.assign(new Error('write CONNECTION_CLOSED db.example:5432'), { code: 'CONNECTION_CLOSED' });
    const koreanPg = Object.assign(new Error('관계 "lms.kv"가 없습니다'), { name: 'PostgresError', code: '42P01' });
    for (const e of [pg, net, closed, koreanPg, new Error('Unexpected token < in JSON')]) {
      const res = errorResponse(e);
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { ok: false, error: '서버 오류가 발생했습니다.' });
    }
    assert.deepEqual(logged, [pg, net, closed, koreanPg, logged[4]]);
  });

  it('handles non-Error throws', async () => {
    const res = errorResponse('문자열 오류');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: false, error: '문자열 오류' });
  });
});
