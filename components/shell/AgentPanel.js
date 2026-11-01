'use client';

import Link from 'next/link';
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, notifyDataChanged } from '@/lib/client-api';
import { useToast } from '@/components/ui/Toast';

const LAST_KEY = 'lms.agent.conversation';
const DAYS = '일월화수목금토';
const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
// About eight lines of the composer; past this it scrolls inside.
const INPUT_MAX = 200;

// Below this width the panel floats over the page with a scrim; at or above it, it pushes the page.
export const AGENT_MODAL_QUERY = '(max-width: 1199px)';
export const AGENT_WIDTH = 440;
const MIN_WIDTH = 360;
const MAX_WIDTH = 720;
const RESIZE_STEP = 16;

/** Widest the panel may be while leaving the sidebar and at least 480px of page. */
function maxAgentWidth(sidebarWidth) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - sidebarWidth - 480));
}
export function clampAgentWidth(w, sidebarWidth) {
  return Math.round(Math.min(maxAgentWidth(sidebarWidth), Math.max(MIN_WIDTH, Number(w) || AGENT_WIDTH)));
}

function readLast() {
  try { return window.localStorage.getItem(LAST_KEY) || ''; } catch { return ''; }
}
function writeLast(id) {
  try {
    if (id) window.localStorage.setItem(LAST_KEY, id);
    else window.localStorage.removeItem(LAST_KEY);
  } catch { /* storage unavailable */ }
}

async function readJson(res) {
  const data = await res.json().catch(() => null);
  if (!data) throw new ApiError('서버 응답을 읽을 수 없습니다.');
  if (!data.ok) throw new ApiError(data.error || '요청을 처리하지 못했습니다.', data.code);
  return data.data;
}

async function post(url, body, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError('로그인이 필요합니다.');
  }
  return res;
}

async function postJson(url, body) {
  return readJson(await post(url, body));
}

/**
 * One agent turn over NDJSON. step/text/text_reset lines go to onEvent; resolves with the `done` data.
 * Failures before the turn starts come back as a plain JSON body instead of a stream.
 */
async function streamAgent(body, signal, onEvent) {
  const res = await post('/api/agent', { ...body, stream: true }, signal);
  if (!(res.headers.get('content-type') || '').includes('application/x-ndjson') || !res.body) return readJson(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line) => {
    if (!line.trim()) return undefined;
    let ev;
    try { ev = JSON.parse(line); } catch { return undefined; }
    if (ev.type === 'done') return ev.data;
    if (ev.type === 'error') throw new ApiError(ev.error || '요청을 처리하지 못했습니다.', ev.code);
    onEvent(ev);
    return undefined;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop();
    for (const line of lines) {
      const data = handle(line);
      if (data) {
        reader.cancel().catch(() => {});
        return data;
      }
    }
    if (done) break;
  }
  throw new ApiError('응답이 중간에 끊겼습니다. 다시 시도해 주세요.');
}

/** Suggested prompts for the empty chat, from today's weekday, the hour and the classes in boot. */
function pickSuggestions(today, classes, hour) {
  const [y, m, d] = String(today || '').split('-').map(Number);
  const day = y ? DAYS[new Date(y, m - 1, d).getDay()] : '';
  const todays = day ? (classes || []).filter((c) => c.status !== '종료' && String(c.schedule_label || '').includes(day)) : [];
  if (!todays.length) {
    return { count: 0, list: ['이번 주 숙제 안 한 학생 찾아줘', '주의가 필요한 학생 알려줘', '최근 상담 기록 요약해줘'] };
  }
  const list = hour < 14
    ? ['오늘 수업 현황 보여줘', `${todays[0].name} 학생 명단 보여줘`, '이번 주 숙제 안 한 학생 찾아줘']
    : ['오늘 수업 현황 보여줘', '오늘 결석한 학생 알려줘', '오늘 숙제 안 한 학생 찾아줘'];
  return { count: todays.length, list };
}

// ----- Message text: paragraphs, markdown tables, **bold**, [[student:ID|이름]] links -----

// Student id → name from the boot search index, for old [[student:ID]] links without a name.
const StudentNames = createContext(null);

const TOKEN_RE = /(\[\[student:[^\]]+\]\]|\*\*[^*]+\*\*)/g;
const NAME_BOUNDARY = /(^|[\s([{"'“‘,·:])$/;

function tokenize(text, names) {
  const out = [];
  for (const p of String(text).split(TOKEN_RE)) {
    const link = p.match(/^\[\[student:([^\]|]+)(?:\|([^\]]*))?\]\]$/);
    if (link) {
      const id = link[1].trim();
      const name = (link[2] || '').trim() || (names && names.get(id)) || '';
      // The model writes "김민수 [[student:ID|김민수]]"; show the name once, as the link.
      const prev = out[out.length - 1];
      if (name && prev && prev.type === 'text') {
        const t = prev.text.replace(/\s+$/, '');
        const before = t.slice(0, t.length - name.length);
        if (t.endsWith(name) && NAME_BOUNDARY.test(before)) prev.text = before;
      }
      out.push({ type: 'student', id, name });
      continue;
    }
    const bold = p.match(/^\*\*([^*]+)\*\*$/);
    if (bold) out.push({ type: 'bold', text: bold[1] });
    else if (p) out.push({ type: 'text', text: p });
  }
  return out;
}

function Inline({ text }) {
  const names = useContext(StudentNames);
  return tokenize(text, names).map((t, i) => {
    if (t.type === 'student') {
      return (
        <Link key={i} className="agent-student-link" href={`/students/${encodeURIComponent(t.id)}`} aria-label={t.name ? undefined : '학생 정보 보기'}>
          {t.name || '보기'}
        </Link>
      );
    }
    if (t.type === 'bold') return <strong key={i}>{t.text}</strong>;
    return <Fragment key={i}>{t.text}</Fragment>;
  });
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isDivider = (line) => /^\s*\|?\s*:?-{2,}/.test(line) && /^[\s|:-]+$/.test(line);

/** Message text without markup, for copying and for the screen reader announcement. */
function plainText(text, names) {
  return String(text || '').split('\n')
    .filter((line) => !isDivider(line))
    .map((line) => (line.trim().startsWith('|') ? cells(line).join('\t') : line))
    .map((line) => tokenize(line, names).map((t) => (t.type === 'student' ? t.name : t.text)).join(''))
    .join('\n')
    .trim();
}

export function RichText({ text }) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const body = rows.filter((r) => !isDivider(r)).map(cells);
      // Only divider lines: nothing to show as a table.
      if (!body.length) continue;
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

function CopyButton({ text }) {
  const toast = useToast();
  const names = useContext(StudentNames);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText(text, names));
      setCopied(true);
    } catch {
      toast('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.', 'error');
    }
  };
  return <button type="button" className="agent-copy" onClick={copy}>{copied ? '복사됨' : '복사'}</button>;
}

// ----- In-progress turn: tool steps and the streamed answer -----

/** "출결 확인 중" while running, "출결 확인" once finished. */
function stepLabel(s) {
  const label = s.label || s.tool || '';
  return s.state === 'running' ? label : label.replace(/\s*중$/, '');
}

function StepList({ steps }) {
  if (!steps.length) return null;
  return (
    <ol className="agent-steps">
      {steps.map((s) => {
        const state = s.state === 'running' ? 'running' : s.ok === false ? 'fail' : 'done';
        return (
          <li key={s.id} data-state={state}>
            <span className="agent-step-icon" aria-hidden="true">
              {state === 'running' ? <span className="agent-spinner" /> : state === 'fail' ? '!' : '✓'}
            </span>
            <span>{stepLabel(s)}</span>
            {state === 'fail' ? <span className="agent-step-fail">실패</span> : <span className="agent-sr">{state === 'running' ? '진행 중' : '완료'}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function LiveBubble({ live, elapsed }) {
  // Hide a half-received [[student:… token until its closing brackets arrive.
  const text = live.text.replace(/\[\[[^\]]*\]?$/, '');
  return (
    <div className="agent-msg assistant agent-live" aria-busy="true">
      <StepList steps={live.steps} />
      {text ? <RichText text={text} /> : (
        <p className="agent-typing">
          확인하는 중…{elapsed >= 3 ? <span className="agent-elapsed"> {elapsed}초</span> : null}
        </p>
      )}
    </div>
  );
}

// ----- Proposal card -----

const STATUS_LABEL = { pending: '승인 대기', applied: '반영됨', rejected: '거절함', failed: '실패' };
const STATUS_TONE = { pending: 'amber', applied: 'ok', rejected: 'muted', failed: 'danger' };

function ResultTag({ result }) {
  if (!result) return null;
  if (result.skipped) return <span className="tag muted">건너뜀</span>;
  return <span className={'tag ' + (result.ok ? 'ok' : 'danger')}>{result.ok ? '확인됨' : '불일치'}</span>;
}

function ProposalCard({ proposal, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState(() => proposal.calls.map((_, i) => i));
  const p = proposal;
  const pending = p.status === 'pending';
  const toggle = (i) => setSelected((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i].sort((a, b) => a - b)));
  const act = async (kind) => {
    setBusy(kind);
    try {
      const next = kind === 'apply'
        ? await postJson('/api/agent/apply', { proposal_id: p.proposal_id, selected })
        : await api('rejectAgentProposal', p.proposal_id);
      onChange(next);
      if (kind === 'apply') {
        const count = Array.isArray(next.result) ? next.result.filter((r) => r && !r.skipped).length : selected.length;
        toast(next.verification_status === 'verified' ? `${count}건 반영하고 확인했습니다.` : '반영했지만 확인 결과가 다릅니다. 내용을 확인해 주세요.', next.verification_status === 'verified' ? 'ok' : 'error');
        notifyDataChanged();
      }
    } catch (e) {
      toast(e.message, 'error');
      // The request can fail after the server applied the proposal, or before it recorded the
      // failure; show what the server has now.
      if (kind === 'apply') {
        const stored = await api('getAgentConversation', p.conversation_id)
          .then((c) => c.messages.map((m) => m.proposal).find((x) => x && x.proposal_id === p.proposal_id))
          .catch(() => null);
        if (stored) {
          onChange(stored);
          if (stored.status === 'applied') notifyDataChanged();
        }
      }
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
        {p.calls.map((c, i) => (
          <li key={i}>
            {pending ? (
              <label className="agent-proposal-item">
                <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} disabled={Boolean(busy)} />
                <span className="agent-proposal-label">{c.label}</span>
                <span>{c.text}</span>
              </label>
            ) : (
              <>
                <span className="agent-proposal-label">{c.label}</span>
                <span>{c.text}</span>
              </>
            )}
            <ResultTag result={results[i]} />
          </li>
        ))}
      </ul>
      {p.status === 'failed' && p.result && p.result.error ? (
        <p className="agent-proposal-error" role="alert">반영하지 못했습니다(변경 없음): {p.result.error}</p>
      ) : null}
      {pending ? (
        <div className="agent-proposal-actions">
          <button type="button" className="btn ok sm" disabled={Boolean(busy) || !selected.length} onClick={() => act('apply')}>
            {busy === 'apply' ? '반영 중…' : `선택한 ${selected.length}건 반영`}
          </button>
          <button type="button" className="btn secondary sm" disabled={Boolean(busy)} onClick={() => act('reject')}>거절</button>
        </div>
      ) : null}
    </div>
  );
}

// ----- Panel -----

/** Drag handle on the panel's left edge (push mode only); onResize(width, 'move' | 'end'). */
function Resizer({ width, sidebarWidth, onResize }) {
  const dragging = useRef(false);
  const at = (e) => document.documentElement.clientWidth - e.clientX;
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (e) => {
    if (dragging.current) onResize(at(e), 'move');
  };
  const onPointerUp = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    onResize(e.type === 'pointercancel' ? width : at(e), 'end');
  };
  const onKeyDown = (e) => {
    const step = e.key === 'ArrowLeft' ? RESIZE_STEP : e.key === 'ArrowRight' ? -RESIZE_STEP : 0;
    if (!step) return;
    e.preventDefault();
    onResize(width + step, 'end');
  };
  return (
    <div
      className="agent-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="AI 비서 폭 조절"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxAgentWidth(sidebarWidth)}
      tabIndex={0}
      title="끌어서 폭 조절 · 더블클릭하면 기본 폭"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(AGENT_WIDTH, 'end')}
      onKeyDown={onKeyDown}
    />
  );
}

export default function AgentPanel({ open, onClose, aiEnabled, today, classes, students, width, sidebarWidth, onResize }) {
  const toast = useToast();
  const [view, setView] = useState('chat');
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [retryText, setRetryText] = useState('');
  const [stepNote, setStepNote] = useState('');
  const [doneNote, setDoneNote] = useState('');
  // The scrim (and so modal behaviour) only shows on narrow screens; see .agent-scrim in app.css.
  const [modal, setModal] = useState(false);
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const stickRef = useRef(true);
  const restored = useRef(false);

  const names = useMemo(() => new Map((students || []).map((s) => [String(s.id), s.name])), [students]);

  const loadConversation = useCallback(async (id) => {
    setError('');
    setRetryText('');
    try {
      const data = await api('getAgentConversation', id);
      setConversationId(id);
      setMessages(data.messages);
      writeLast(id);
      setView('chat');
      stickRef.current = true;
    } catch (e) {
      writeLast('');
      setConversationId('');
      setMessages([]);
      if (e.code !== 'CONVERSATION_NOT_FOUND') setError(e.message);
    }
  }, []);

  // Give focus back to whatever opened the panel when it closes.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    return () => {
      const now = document.activeElement;
      if (opener && opener.isConnected && (!now || now === document.body)) opener.focus();
    };
  }, [open]);

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
    const mq = window.matchMedia(AGENT_MODAL_QUERY);
    const sync = () => setModal(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // While the scrim covers the page, focus that leaves the panel is pulled back in.
  useEffect(() => {
    if (!open || !modal) return undefined;
    const onFocus = (e) => {
      const panel = panelRef.current;
      if (panel && !panel.contains(e.target)) (inputRef.current || panel.querySelector(FOCUSABLE) || panel).focus();
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [open, modal]);

  useEffect(() => {
    if (!busy) return undefined;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Follow new content unless the user has scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, live]);

  // Grow the input with its text (also when it is cleared or refilled), then scroll inside it.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, INPUT_MAX) + 'px';
    el.style.overflowY = el.scrollHeight > INPUT_MAX ? 'auto' : 'hidden';
  }, [input, open, view, width]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const trapTab = (e) => {
    if (!modal || e.key !== 'Tab') return;
    const items = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const showList = async () => {
    setView('list');
    try { setConversations(await api('listAgentConversations')); } catch (e) { setError(e.message); }
  };

  const newConversation = () => {
    setConversationId('');
    setMessages([]);
    setError('');
    setRetryText('');
    writeLast('');
    setView('chat');
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const onEvent = (ev) => {
    if (ev.type === 'text') {
      setLive((l) => (l ? { ...l, text: l.text + (ev.delta || '') } : l));
    } else if (ev.type === 'text_reset') {
      setLive((l) => (l ? { ...l, text: '' } : l));
    } else if (ev.type === 'step') {
      setLive((l) => {
        if (!l) return l;
        const found = l.steps.some((s) => s.id === ev.id);
        const steps = found ? l.steps.map((s) => (s.id === ev.id ? { ...s, ...ev } : s)) : [...l.steps, ev];
        return { ...l, steps };
      });
      const label = stepLabel(ev);
      if (ev.state === 'running') setStepNote(label);
      else if (ev.ok === false) setStepNote(`${label} 실패`);
    }
  };

  const send = async (raw) => {
    const text = String(raw ?? input).trim();
    if (!text || busy) return;
    setError('');
    setRetryText('');
    setStepNote('');
    setDoneNote('');
    setBusy(true);
    setElapsed(0);
    setInput('');
    setLive({ steps: [], text: '' });
    stickRef.current = true;
    const temp = { message_id: 'tmp', role: 'user', content: text, pending: true };
    setMessages((list) => [...list, temp]);
    const controller = new AbortController();
    abortRef.current = controller;
    const ask = (id) => streamAgent({ conversation_id: id, message: text }, controller.signal, onEvent);
    try {
      let data;
      try {
        data = await ask(conversationId);
      } catch (e) {
        if (e.code !== 'CONVERSATION_NOT_FOUND' || !conversationId) throw e;
        // The conversation is gone (e.g. removed after 90 days unused): start a new one.
        setConversationId('');
        writeLast('');
        setMessages([temp]);
        setLive({ steps: [], text: '' });
        data = await ask('');
      }
      setConversationId(data.conversation_id);
      writeLast(data.conversation_id);
      setMessages((list) => [...list.filter((m) => m !== temp), data.user_message, data.message]);
      setStepNote('');
      setDoneNote(plainText(data.message && data.message.content, names).replace(/\t/g, ' '));
    } catch (e) {
      setMessages((list) => list.filter((m) => m !== temp));
      setInput(text);
      setStepNote('');
      if (controller.signal.aborted) {
        // Stopped by the user: the text is back in the input, nothing else to say.
      } else if (e.code === 'AGENT_RATE_LIMITED') {
        toast(e.message, 'error');
      } else {
        setError(e.message);
        setRetryText(text);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setLive(null);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }
  };

  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
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

  const suggestions = !messages.length ? pickSuggestions(today, classes, new Date().getHours()) : null;

  return (
    <StudentNames.Provider value={names}>
      <div className="agent-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="agent-panel" role="dialog" aria-modal={modal ? 'true' : 'false'} aria-label="AI 비서" onKeyDown={trapTab}>
        {modal ? null : <Resizer width={width} sidebarWidth={sidebarWidth} onResize={onResize} />}
        <header className="agent-head">
          <div>
            <strong className="display">AI 비서</strong>
            <span>조회는 바로, 변경은 승인 후 반영</span>
          </div>
          <div className="agent-head-actions">
            <button type="button" className="btn ghost sm" onClick={view === 'list' ? () => setView('chat') : showList}>
              {view === 'list' ? '대화로' : '지난 대화'}
            </button>
            <button type="button" className="btn ghost sm" onClick={newConversation} disabled={busy}>새 대화</button>
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
              <button type="button" key={c.conversation_id} className="agent-conv" aria-current={c.conversation_id === conversationId ? 'true' : undefined} onClick={() => loadConversation(c.conversation_id)} disabled={busy}>
                <strong>{c.title}</strong>
                <span>{c.last_message}</span>
                <small>{String(c.updated_at || '').replace('T', ' ').slice(0, 16)}</small>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="agent-messages" ref={listRef} onScroll={onScroll}>
              {suggestions ? (
                <div className="agent-empty">
                  <p>학생 관리 업무를 말로 지시해 보세요.</p>
                  {suggestions.count ? <p className="agent-context">오늘 수업 {suggestions.count}개가 있습니다.</p> : null}
                  <div className="agent-suggestions">
                    {suggestions.list.map((s) => (
                      <button type="button" key={s} className="agent-chip" onClick={() => send(s)} disabled={busy}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {messages.map((m) => (
                <div key={m.message_id} className={'agent-msg ' + (m.role === 'user' ? 'user' : 'assistant')}>
                  {m.role === 'user' ? <p>{m.content}</p> : <RichText text={m.content} />}
                  {m.proposal ? <ProposalCard proposal={m.proposal} onChange={updateProposal} /> : null}
                  {m.role !== 'user' && m.content ? <div className="agent-msg-tools"><CopyButton text={m.content} /></div> : null}
                </div>
              ))}
              {live ? <LiveBubble live={live} elapsed={elapsed} /> : null}
            </div>
            <p className="agent-sr" role="status">{stepNote}</p>
            <p className="agent-sr" aria-live="polite">{doneNote}</p>
            {error ? (
              <div className="agent-error" role="alert">
                <span>{error}</span>
                {retryText && !busy ? <button type="button" className="agent-retry" onClick={() => send(retryText)}>다시 시도</button> : null}
              </div>
            ) : null}
            <form className="agent-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <div className="agent-composer">
                <textarea
                  ref={inputRef}
                  rows={1}
                  name="agent-message"
                  autoComplete="off"
                  value={input}
                  maxLength={2000}
                  placeholder="예: 김민수 최근 성적 보여줘…"
                  aria-label="AI 비서에게 보낼 메시지"
                  aria-describedby="agent-input-hint"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  readOnly={busy}
                />
                {busy ? (
                  <button type="button" className="btn secondary sm" onClick={stop}>중지</button>
                ) : (
                  <button type="submit" className="btn sm" disabled={!input.trim()}>보내기</button>
                )}
              </div>
              <p className="agent-hint" id="agent-input-hint">Enter 보내기 · Shift+Enter 줄바꿈</p>
            </form>
          </>
        )}
      </aside>
    </StudentNames.Provider>
  );
}
