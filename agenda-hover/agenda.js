(() => {
  const agenda = document.querySelector('#agenda');
  if (!agenda) return;
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  const items = [...agenda.querySelectorAll('.agenda-item')];
  const pendingClose = new WeakMap();

  function close(item) {
    clearTimeout(pendingClose.get(item));
    item.classList.remove('venue-open');
    item.querySelector('.agenda-when > [role="button"]')?.setAttribute('aria-expanded', 'false');
  }

  function open(item) {
    clearTimeout(pendingClose.get(item));
    if (item.classList.contains('venue-open')) return;
    // Measure the untouched layout, including translated copy and responsive wrapping.
    const rest = parseFloat(item.style.getPropertyValue('--venue-rest')) || item.getBoundingClientRect().height;
    item.style.setProperty('--venue-rest', `${rest}px`);
    item.style.setProperty('--venue-expanded', `${Math.ceil(rest * 3)}px`);
    item.style.setProperty('--venue-image-top', `${Math.ceil(rest - 8)}px`);
    item.querySelector('.agenda-bg img')?.setAttribute('loading', 'eager');
    item.classList.add('venue-open');
    item.querySelector('.agenda-when > [role="button"]')?.setAttribute('aria-expanded', 'true');
  }

  items.forEach((item, index) => {
    item.classList.add('venue-expandable');
    const date = item.querySelector('.agenda-when > div');
    date.setAttribute('role', 'button');
    date.tabIndex = 0;
    date.setAttribute('aria-expanded', 'false');
    const picture = item.querySelector('.agenda-bg');
    if (picture) {
      picture.id = `venue-preview-${index}`;
      date.setAttribute('aria-controls', picture.id);
    }
    item.addEventListener('pointerenter', event => {
      if (hover.matches && event.pointerType !== 'touch') open(item);
    });
    item.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'touch') {
        // Brief grace period avoids collapse/reopen jitter on moving tile boundaries.
        pendingClose.set(item, setTimeout(() => {
          if (item.contains(document.activeElement) && document.activeElement.matches(':focus-visible')) return;
          close(item);
        }, 90));
      }
    });
    date.addEventListener('focus', () => { if (date.matches(':focus-visible')) open(item); });
    date.addEventListener('click', () => {
      if (hover.matches) open(item);
      else if (item.classList.contains('venue-open')) close(item);
      else open(item);
    });
    date.addEventListener('keydown', event => {
      if (event.key === 'Escape') { close(item); return; }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.classList.contains('venue-open') ? close(item) : open(item);
      }
    });
    item.addEventListener('focusout', event => {
      if (!item.contains(event.relatedTarget) && !item.matches(':hover')) close(item);
    });
  });

  document.addEventListener('pointerdown', event => {
    for (const item of items) if (!item.contains(event.target)) close(item);
  });
  // Re-measure only after a responsive or language change, never during expansion.
  function resetSizes() {
    items.forEach(item => {
      close(item);
      item.style.removeProperty('--venue-rest');
    });
  }
  window.addEventListener('resize', resetSizes, { passive: true });
  new MutationObserver(resetSizes).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})();
