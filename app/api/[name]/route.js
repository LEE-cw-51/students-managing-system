import { NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth.js';
import { withService, isPublicApi } from '../../../lib/store.js';
import { errorResponse } from '../../../lib/api-error.js';

export const runtime = 'nodejs';

export async function POST(req, ctx) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const { name } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const args = Array.isArray(body.args) ? body.args : [];
  try {
    const data = await withService((api) => {
      if (name === 'apiBatch') {
        const calls = args[0] || [];
        return calls.map((c) => {
          if (!c || !isPublicApi(api, c.name)) {
            throw new Error('알 수 없는 API입니다.');
          }
          return api[c.name].apply(api, c.args || []);
        });
      }
      if (!isPublicApi(api, name)) {
        throw new Error('알 수 없는 API입니다.');
      }
      return api[name].apply(api, args);
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
