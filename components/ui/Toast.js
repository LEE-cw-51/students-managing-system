'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(() => {});

/**
 * toast('저장했습니다.') / toast(err.message, 'error')
 * toast('삭제했습니다.', 'ok', { action: { label: '되돌리기', onClick }, duration: 5000 })
 * Errors stay until closed so they can be read.
 */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((message, tone = 'ok', { action, duration } = {}) => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, message: String(message || ''), tone, action }]);
    const ms = duration || (tone === 'error' ? 0 : action ? 5000 : 2800);
    if (ms) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-region">
        {items.map((t) => (
          <div key={t.id} className={'toast-item ' + t.tone} role={t.tone === 'error' ? 'alert' : 'status'}>
            <span className="toast-message">{t.message}</span>
            {t.action ? (
              <button type="button" className="toast-action" onClick={() => { dismiss(t.id); t.action.onClick(); }}>{t.action.label}</button>
            ) : null}
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="알림 닫기">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
