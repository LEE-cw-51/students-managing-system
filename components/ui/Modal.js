'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { useConfirm } from '@/components/ui/ConfirmDialog';

// Open modals, innermost last. Only the top one reacts to Escape and Tab.
const stack = [];
const FOCUSABLE = 'a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CloseContext = createContext(null);

/** Cancel button for a modal's body or footer; goes through the same `dirty` check as ✕. */
export function ModalCancel({ children = '취소', className = 'btn secondary' }) {
  const requestClose = useContext(CloseContext);
  return <button type="button" className={className} onClick={requestClose}>{children}</button>;
}

/** `dirty` asks before Escape, backdrop click, ✕ or <ModalCancel> throws away unsaved input. */
export default function Modal({ title, onClose, children, footer, wide, dirty }) {
  const ref = useRef(null);
  const confirm = useConfirm();
  // Callers pass inline handlers; keep the latest in refs so the mount effect runs once.
  const latest = useRef({});
  latest.current = { onClose, dirty, confirm };

  const requestClose = async () => {
    const { onClose: close, dirty: isDirty, confirm: ask } = latest.current;
    if (isDirty && !(await ask({ message: '저장하지 않은 내용이 있습니다. 닫을까요?', confirmLabel: '닫기', danger: true }))) return;
    close();
  };

  useEffect(() => {
    const el = ref.current;
    const prev = document.activeElement;
    stack.push(el);
    const first = el?.querySelector('input, select, textarea, button:not(.modal-close)');
    (first || el)?.focus();
    const onKey = (e) => {
      if (stack[stack.length - 1] !== el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      } else if (e.key === 'Tab') {
        const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
        if (!items.length) return;
        const head = items[0];
        const tail = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === head || !el.contains(document.activeElement))) {
          e.preventDefault();
          tail.focus();
        } else if (!e.shiftKey && (document.activeElement === tail || !el.contains(document.activeElement))) {
          e.preventDefault();
          head.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(el);
      if (i >= 0) stack.splice(i, 1);
      if (prev && prev.focus) prev.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CloseContext.Provider value={requestClose}>
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}
          style={wide ? { width: 'min(880px, 100%)' } : undefined}>
          <div className="modal-head">
            <h2>{title}</h2>
            <button type="button" className="btn ghost modal-close" onClick={requestClose} aria-label="닫기">✕</button>
          </div>
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </div>
      </div>
    </CloseContext.Provider>
  );
}
