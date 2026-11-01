/*
 * lofi.js — screen switching for multi-screen UI Preflight wireframes.
 *
 * Navigation only: it shows one [data-screen-id] at a time, follows
 * [data-action-target] clicks, and adds a "Screens" bar so reviewers can
 * jump anywhere. It must never grow animations or real behavior; that
 * belongs to production code.
 */
(() => {
  const screens = () => [...document.querySelectorAll('[data-screen-id]')];

  function show(id) {
    const all = screens();
    if (!all.length) return;
    const target = all.find(s => s.dataset.screenId === id)
      || all.find(s => s.hasAttribute('data-start-screen'))
      || all[0];
    all.forEach(s => s.toggleAttribute('hidden', s !== target));
    document.querySelectorAll('.wf-screens [data-go]').forEach(b =>
      b.toggleAttribute('data-current', b.dataset.go === target.dataset.screenId));
    const hash = '#' + target.dataset.screenId;
    if (all.length > 1 && location.hash !== hash) history.replaceState(null, '', hash);
    window.scrollTo(0, 0);
  }

  function toolbar() {
    const all = screens();
    if (all.length < 2) return;
    const bar = document.createElement('nav');
    bar.className = 'wf-screens';
    bar.setAttribute('aria-label', 'Wireframe screens');
    bar.append('Screens:');
    for (const s of all) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.go = s.dataset.screenId;
      b.textContent = s.dataset.screenId;
      bar.append(b);
    }
    document.body.prepend(bar);
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action-target], [data-go]');
    if (!t) return;
    e.preventDefault();
    show(t.dataset.actionTarget || t.dataset.go);
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  document.addEventListener('DOMContentLoaded', () => { toolbar(); show(location.hash.slice(1)); });

  window.lofi = { show };
})();
