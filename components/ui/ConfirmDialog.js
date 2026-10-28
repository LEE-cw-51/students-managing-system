'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';

// Outside the provider (e.g. login) fall back to the browser dialog.
const ConfirmContext = createContext(async ({ message }) => window.confirm(message));

/** const confirm = useConfirm(); if (!(await confirm({ message, danger: true }))) return; */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(({ title = '확인', message, confirmLabel = '확인', cancelLabel = '취소', danger = false }) => (
    new Promise((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setReq({ title, message, confirmLabel, cancelLabel, danger });
    })
  ), []);

  const answer = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setReq(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req ? (
        <Modal title={req.title} onClose={() => answer(false)}
          footer={(
            <>
              <button type="button" className="btn secondary" onClick={() => answer(false)}>{req.cancelLabel}</button>
              <button type="button" className={'btn ' + (req.danger ? 'danger' : '')} onClick={() => answer(true)}>{req.confirmLabel}</button>
            </>
          )}>
          <p className="confirm-message">{req.message}</p>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}
