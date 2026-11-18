(() => {
  const strip = document.querySelector('.marquee');
  const track = strip?.querySelector('.marquee-track');
  if (!track) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const items = [...track.children];
  items.slice(items.length / 2).forEach(item => item.setAttribute('aria-hidden', 'true'));
  let span = 0, offset = 0, hoverSpeed = null, drag = null;
  let visible = false, frame = 0, last = 0;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function paint() {
    if (!span) return;
    offset = ((offset % span) + span) % span;
    track.style.transform = `translate3d(${-offset}px, 0, 0)`;
  }
  function measure() {
    const next = track.scrollWidth / 2;
    if (span) offset = offset / span * next;
    span = next;
    paint();
  }
  function tick(time) {
    frame = 0;
    if (!visible || document.hidden) { last = 0; return; }
    const dt = last ? Math.min((time - last) / 1000, 0.05) : 0;
    last = time;
    if (!drag && !reducedMotion.matches) {
      offset += (hoverSpeed ?? span / 130) * dt;
      paint();
    }
    if (!drag && !reducedMotion.matches) frame = requestAnimationFrame(tick);
  }
  function resume() {
    if (!frame) { last = 0; frame = requestAnimationFrame(tick); }
  }
  function hover(event) {
    if (event.pointerType !== 'mouse') return;
    const rect = strip.getBoundingClientRect();
    const position = clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1);
    hoverSpeed = Math.abs(position) < 0.12 ? 0 : position * 180;
    resume();
  }
  strip.addEventListener('pointerenter', hover);
  strip.addEventListener('pointermove', event => {
    if (drag && event.pointerId === drag.id) {
      offset -= event.clientX - drag.x;
      drag.x = event.clientX;
      paint();
    } else hover(event);
  });
  strip.addEventListener('pointerleave', () => { hoverSpeed = null; });
  strip.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    drag = { id: event.pointerId, x: event.clientX };
    strip.setPointerCapture(event.pointerId);
    strip.classList.add('is-dragging');
  });
  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    strip.classList.remove('is-dragging');
    if (strip.hasPointerCapture(event.pointerId)) strip.releasePointerCapture(event.pointerId);
    hoverSpeed = null;
    if (event.type === 'pointerup' && strip.matches(':hover')) hover(event);
    resume();
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => strip.addEventListener(type, endDrag));
  // Wheel and trackpad scrolling belong to the page, including diagonal gestures.
  // The strip is controlled by hover, dragging and the left/right arrow keys.
  strip.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    offset += (event.key === 'ArrowRight' ? 1 : -1) * strip.clientWidth * 0.3;
    paint();
  });
  strip.classList.add('is-interactive');
  measure();
  new ResizeObserver(measure).observe(track);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) resume(); }).observe(strip);
  document.addEventListener('visibilitychange', resume);
  reducedMotion.addEventListener('change', resume);
})();
