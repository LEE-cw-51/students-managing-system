import { NextResponse } from 'next/server';
import { getSession, serviceFor } from '../../../lib/auth.js';
import { isAgentConfigured } from '../../../lib/ai-client.js';
import { runAgentTurn } from '../../../lib/agent.js';
import { errorDetails, errorResponse } from '../../../lib/api-error.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * One AI assistant chat turn: reads run at once, changes come back as a pending proposal.
 * With `stream: true` the reply is NDJSON: step/text events while the turn runs, then one
 * final `{ type: 'done', data }` or `{ type: 'error', error, code }` line.
 */
export async function POST(req) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  if (!isAgentConfigured()) {
    return NextResponse.json({ ok: false, error: 'AI 키가 설정되지 않았습니다. 서버 환경 변수 ANTHROPIC_API_KEY(또는 AI_API_KEY)를 넣어 주세요.' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: '메시지를 입력해 주세요.' }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ ok: false, error: '메시지는 2000자까지 보낼 수 있습니다.' }, { status: 400 });
  }
  const clientTurnId = String(body.client_turn_id || '');
  const turn = {
    conversationId: String(body.conversation_id || ''),
    message,
    clientTurnId: /^[\w-]{1,64}$/.test(clientTurnId) ? clientTurnId : ''
  };
  const run = serviceFor(session);
  if (body.stream === true) return streamTurn(turn, run, req.signal);
  try {
    const data = await runAgentTurn(turn, run);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}

function streamTurn(turn, run, requestSignal) {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (requestSignal) {
    if (requestSignal.aborted) stop();
    else requestSignal.addEventListener('abort', stop);
  }
  let closed = false;
  const pump = async (out) => {
    const send = (event) => {
      if (closed) return;
      try {
        out.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      } catch {
        closed = true;
      }
    };
    try {
      const data = await runAgentTurn(turn, run, { onEvent: send, signal: controller.signal });
      send({ type: 'done', data });
    } catch (e) {
      if (!controller.signal.aborted) {
        const { error, code } = errorDetails(e);
        send(code ? { type: 'error', error, code } : { type: 'error', error });
      }
    } finally {
      if (requestSignal) requestSignal.removeEventListener('abort', stop);
      if (!closed) {
        closed = true;
        try {
          out.close();
        } catch {
          // Already closed by the client.
        }
      }
    }
  };
  const stream = new ReadableStream({
    // Not awaited, so each line is sent as soon as it is queued.
    start(out) {
      pump(out);
    },
    cancel() {
      closed = true;
      stop();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  });
}
