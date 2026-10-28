'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Checkbox selection over a list of ids. `visibleIds` is what the user can see right now
 * (after search/filter): select-all and its partial state follow that list, and `chosen`
 * is the selected ids among them.
 */
export function useSelection(visibleIds = []) {
  const [selected, setSelected] = useState(() => new Set());
  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setAll = (ids, on) => setSelected((s) => {
    const next = new Set(s);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });
  const clear = () => setSelected(new Set());
  const chosen = visibleIds.filter((id) => selected.has(id));
  const allOn = visibleIds.length > 0 && chosen.length === visibleIds.length;
  const someOn = chosen.length > 0 && !allOn;
  return { selected, toggle, setAll, clear, chosen, allOn, someOn, visibleIds };
}

/** Header checkbox for a `useSelection` list; shows the mixed state when only some are checked. */
export function SelectAllCheckbox({ sel, label = '전체 선택' }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = sel.someOn; }, [sel.someOn]);
  return (
    <input ref={ref} type="checkbox" checked={sel.allOn} disabled={!sel.visibleIds.length} aria-label={label}
      onChange={(e) => sel.setAll(sel.visibleIds, e.target.checked)} onClick={(e) => e.stopPropagation()} />
  );
}
