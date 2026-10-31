'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, notifyDataChanged } from '@/lib/client-api';
import { useToast } from '@/components/ui/Toast';

const LAST_KEY = 'lms.agent.conversation';
const SUGGESTIONS = [
  '오늘 수업 현황 보여줘',
  '이번 주 숙제 안 한 학생 찾아줘',
  '주의가 필요한 학생 알려줘'
];

function readLast() {
  try { return window.localStorage.getItem(LAST_KEY) || ''; } catch { return ''; }
}
function writeLast(id) {
  try {
    if (id) window.localStorage.setItem(LAST_KEY, id);
    else window.localStorage.removeItem(LAST_KEY);
  } catch { /* storage unavailable */ }
}

async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError('로그인이 필요합니다.');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.');
  if (!data.ok) throw new ApiError(data.error || '요청을 처리하지 못했습니다.');
  return data.data;
}

// ----- Message text: paragraphs, markdown tables, **bold**, [[student:ID]] links -----

function Inline({ text }) {
  const parts = String(text).split(/(\[\[student:[^\]]+\]\]|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const link = p.match(/^\[\[student:([^\]]+)\]\]$/);
    if (link) {
      return <Link key={i} className="agent-student-link" href={`/students/${encodeURIComponent(link[1].trim())}`}>보기</Link>;
    }
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isDivider = (line) => /^\s*\|?\s*:?-{2,}/.test(line) && /^[\s|:-]+$/.test(line);

export function RichText({ text }) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const body = rows.filter((r) => !isDivider(r)).map(cells);
      const [head, ...rest] = body;
      blocks.push(
        <div className="agent-table" key={blocks.length}>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}><Inline text={c} /></th>)}</tr></thead>
            <tbody>{rest.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    const para = [];
    while (i < lines.length && !lines[i].trim().startsWith('|')) para.push(lines[i++]);
    const textBlock = para.join('\n').trim();
    if (textBlock) blocks.push(<p key={blocks.length}><Inline text={textBlock} /></p>);
  }
  return <div className="agent-rich">{blocks}</div>;
}

// ----- Proposal card -----

const STATUS_LABEL = { pending: '승인 대기', applied: '반영됨', rejected: '거절함', failed: '실패' };
const STATUS_TONE = { pending: 'amber', applied: 'ok', rejected: 'muted', failed: 'danger' };

function ProposalCard({ proposal, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const p = proposal;
  const act = async (kind) => {
    setBusy(kind);
    try {
      const next = kind === 'apply'
        ? await postJson('/api/agent/apply', { proposal_id: p.proposal_id })
        : await api('rejectAgentProposal', p.proposal_id);
      onChange(next);
      if (kind === 'apply') {
        toast(next.verification_status === 'verified' ? `${next.calls.length}건 반영하고 확인했습니다.` : '반영했지만 확인 결과가 다릅니다. 내용을 확인해 주세요.', next.verification_status === 'verified' ? 'ok' : 'error');
        notifyDataChanged();
      }
    } catch (e) {
      toast(e.message, 'error');
      // The server recorded the failure on the proposal; show it.
      if (kind === 'apply') onChange({ ...p, status: 'failed', result: { error: e.message } });
    } finally {
      setBusy('');
    }
  };
  const results = Array.isArray(p.result) ? p.result : [];
  return (
    <div className="agent-proposal" data-status={p.status}>
      <div className="agent-proposal-head">
        <strong>변경 제안 {p.calls.length}건</strong>
        <span className={'tag ' + STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] || p.status}</span>
      </div>
      <ul>
        {p.calls.map((c, i) => {
          const r = results[i];
          return (
            <li key={i}>
              <span className="agent-proposal-label">{c.label}</span>
              <span>{c.text}</span>
              {r ? <span className={'tag ' + (r.ok ? 'ok' : 'danger')}>{r.ok ? '확인됨' : '불일치'}</span> : null}
            </li>
          );
        })}
      </ul>
      {p.status === 'failed' && p.result && p.result.error ? (
        <p className="agent-proposal-error" role="alert">반영하지 못했습니다(변경 없음): {p.result.error}</p>
      ) : null}
      {p.status === 'pending' ? (
        <div className="agent-proposal-actions">
          <button type="button" className="btn ok sm" disabled={Boolean(busy)} onClick={() => act('apply')}>
            {busy === 'apply' ? '반영 중…' : '승인하고 반영'}
          </button>
          <button type="button" className="btn secondary sm" disabled={Boolean(busy)} onClick={() => act('reject')}>거절</button>
        </div>
      ) : null}
    </div>
  );
}

// ----- Panel -----

export default function AgentPanel({ open, onClose, aiEnabled }) {
  const [view, setView] = useState('chat');
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const restored = useRef(false);

  const loadConversation = useCallback(async (id) => {
    setError('');
    try {
      const data = await api('getAgentConversation', id);
      setConversationId(id);
      setMessages(data.messages);
      writeLast(id);
      setView('chat');
    } catch (e) {
      writeLast('');
      setConversationId('');
      setMessages([]);
      if (!/찾을 수 없습니다/.test(e.message)) setError(e.message);
    }
  }, []);

  // Reopen the last conversation the first time the panel opens.
  useEffect(() => {
    if (!open) return;
    if (!restored.current) {
      restored.current = true;
      const last = readLast();
      if (last) loadConversation(last);
    }
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    return () => clearTimeout(t);
  }, [open, loadConversation]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const showList = async () => {
    setView('list');
    try { setConversations(await api('listAgentConversations')); } catch (e) { setError(e.message); }
  };

  const newConversation = () => {
    setConversationId('');
    setMessages([]);
    setError('');
    writeLast('');
    setView('chat');
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const send = async (raw) => {
    const text = String(raw ?? input).trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    setInput('');
    const temp = { message_id: 'tmp', role: 'user', content: text, pending: true };
    setMessages((list) => [...list, temp]);
    try {
      const data = await postJson('/api/agent', { conversation_id: conversationId, message: text });
      setConversationId(data.conversation_id);
      writeLast(data.conversation_id);
      setMessages((list) => [...list.filter((m) => m !== temp), data.user_message, data.message]);
    } catch (e) {
      setMessages((list) => list.filter((m) => m !== temp));
      setInput(text);
      setError(e.message);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }
  };

  const updateProposal = (next) => {
    setMessages((list) => list.map((m) => (m.proposal && m.proposal.proposal_id === next.proposal_id ? { ...m, proposal: next } : m)));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="agent-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="agent-panel" role="dialog" aria-modal="false" aria-label="AI 비서">
        <header className="agent-head">
          <div>
            <strong className="display">AI 비서</strong>
            <span>조회는 바로, 변경은 승인 후 반영</span>
          </div>
          <div className="agent-head-actions">
            <button type="button" className="btn ghost sm" onClick={view === 'list' ? () => setView('chat') : showList}>
              {view === 'list' ? '대화로' : '지난 대화'}
            </button>
            <button type="button" className="btn ghost sm" onClick={newConversation}>새 대화</button>
            <button type="button" className="agent-close" onClick={onClose} aria-label="AI 비서 닫기">✕</button>
          </div>
        </header>

        {!aiEnabled ? (
          <div className="agent-empty">
            <p><strong>AI 키가 설정되지 않았습니다.</strong></p>
            <p>서버 환경 변수 <code>AI_API_KEY</code>와 도구 호출을 지원하는 <code>AI_MODEL</code>을 넣으면 사용할 수 있습니다.</p>
          </div>
        ) : view === 'list' ? (
          <div className="agent-convs">
            {conversations === null ? <p className="agent-muted">불러오는 중…</p> : null}
            {conversations && !conversations.length ? <p className="agent-muted">아직 대화가 없습니다.</p> : null}
            {(conversations || []).map((c) => (
              <button type="button" key={c.conversation_id} className="agent-conv" aria-current={c.conversation_id === conversationId ? 'true' : undefined} onClick={() => loadConversation(c.conversation_id)}>
                <strong>{c.title}</strong>
                <span>{c.last_message}</span>
                <small>{String(c.updated_at || '').replace('T', ' ').slice(0, 16)}</small>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="agent-messages" ref={listRef} aria-live="polite">
              {!messages.length ? (
                <div className="agent-empty">
                  <p>학생 관리 업무를 말로 지시해 보세요.</p>
                  <div className="agent-suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button type="button" key={s} className="agent-chip" onClick={() => send(s)} disabled={busy}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.map((m) => (
                <div key={m.message_id} className={'agent-msg ' + (m.role === 'user' ? 'user' : 'assistant')}>
                  {m.role === 'user' ? <p>{m.content}</p> : <RichText text={m.content} />}
                  {m.proposal ? <ProposalCard proposal={m.proposal} onChange={updateProposal} /> : null}
                </div>
              ))}
              {busy ? <div className="agent-msg assistant agent-typing" role="status">확인하는 중…</div> : null}
            </div>
            {error ? <div className="agent-error" role="alert">{error}</div> : null}
            <form className="agent-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <textarea
                ref={inputRef}
                rows={2}
                value={input}
                maxLength={2000}
                placeholder="예: 김민수 최근 성적 보여줘"
                aria-label="AI 비서에게 보낼 메시지"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
              />
              <button type="submit" className="btn" disabled={busy || !input.trim()}>보내기</button>
            </form>
          </>
        )}
      </aside>
    </>
  );
}
