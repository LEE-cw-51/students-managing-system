'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(() => {});

/** toast('저장했습니다.') / toast(err.message, 'error') */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const toast = useCallback((message, tone = 'ok') => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, message: String(message || ''), tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'toast-item ' + t.tone}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
