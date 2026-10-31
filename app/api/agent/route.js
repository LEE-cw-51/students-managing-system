import { NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth.js';
import { withService } from '../../../lib/store.js';
import { isAiConfigured } from '../../../lib/ai-client.js';
import { runAgentTurn } from '../../../lib/agent.js';
import { errorResponse } from '../../../lib/api-error.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** One AI assistant chat turn: reads run at once, changes come back as a pending proposal. */
export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ ok: false, error: 'AI 키가 설정되지 않았습니다. 서버 환경 변수 AI_API_KEY를 넣어 주세요.' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: '메시지를 입력해 주세요.' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ ok: false, error: '메시지는 2000자까지 보낼 수 있습니다.' }, { status: 400 });
  }
  try {
    const data = await runAgentTurn({ conversationId: String(body.conversation_id || ''), message }, withService);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
