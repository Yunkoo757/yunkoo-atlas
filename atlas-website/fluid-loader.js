// The decorative WebGL effect must not compete with the first content paint.
export function observeLiquidEther(host, getOptions, load = () => import('./vendor/liquid-ether.js')) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(pointer: fine)');
  let painted = false, ready = document.readyState === 'complete';
  let paintObserver = null;
  const anchor = window.location?.hash;
  let target = null;
  try { target = anchor ? document.getElementById?.(decodeURIComponent(anchor.slice(1))) : null; } catch { /* Keep the static fragment harmless. */ }
  let awaitingAnchorExit = Boolean(target && !host.parentElement?.contains(target));
  let visible = false, pageActive = true, disposed = false, failed = false;
  let generation = 0, loading = null, disposeEffect = null;
  let frame = null, idle = null;
  const canLoad = () => {
    if (disposed || awaitingAnchorExit || !ready || !painted || !pageActive || !visible || document.hidden || reducedMotion.matches || !finePointer.matches) return false;
    const bounds = host.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < innerHeight && bounds.width > 0;
  };
  function cancelScheduled() {
    if (frame !== null) cancelAnimationFrame(frame);
    if (idle !== null) {
      if ('cancelIdleCallback' in window) cancelIdleCallback(idle);
      else clearTimeout(idle);
    }
    frame = idle = null;
  }
  function releaseEffect() {
    disposeEffect?.();
    disposeEffect = null;
    host.replaceChildren();
  }
  async function mount() {
    idle = null;
    if (!canLoad() || disposeEffect || loading !== null || failed) return;
    const owner = ++generation;
    loading = owner;
    try {
      const {mountLiquidEther} = await load();
      if (owner !== generation || !canLoad()) return;
      disposeEffect = mountLiquidEther(host, getOptions());
    } catch (error) {
      if (owner === generation) {
        failed = true;
        releaseEffect();
        console.warn('背景流体不可用，保留静态背景。', error);
      }
    } finally {
      if (loading === owner) loading = null;
      // Eligibility may have changed while the module was loading.
      if (owner !== generation) sync();
    }
  }
  function sync() {
    if (!canLoad()) {
      generation++;
      cancelScheduled();
      // The effect already pauses itself offscreen and in background tabs.
      if (!pageActive || reducedMotion.matches || !finePointer.matches) releaseEffect();
      return;
    }
    if (disposeEffect || loading !== null || frame !== null || idle !== null || failed) return;
    // Leave the content a frame to paint, then initialize only during idle time.
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!canLoad()) return;
      idle = 'requestIdleCallback' in window
        ? requestIdleCallback(mount, {timeout: 1500})
        : setTimeout(mount, 0);
    });
  }
  const markPainted = () => { painted = true; paintObserver?.disconnect(); sync(); };
  if (window.PerformanceObserver?.supportedEntryTypes?.includes('paint')) {
    paintObserver = new PerformanceObserver(list => {
      if (list.getEntries().some(entry => entry.name === 'first-contentful-paint')) markPainted();
    });
    paintObserver.observe({type: 'paint', buffered: true});
  } else {
    // Desktop engines without Paint Timing still get a content/font paint opportunity.
    Promise.resolve(document.fonts?.ready).then(() => requestAnimationFrame(() => requestAnimationFrame(markPainted)));
  }
  const loaded = () => { ready = true; sync(); };
  window.addEventListener('load', loaded, {once: true});
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio > 0;
    if (!visible) awaitingAnchorExit = false;
    sync();
  });
  observer.observe(host);
  const interact = () => { if (awaitingAnchorExit) { awaitingAnchorExit = false; sync(); } };
  const interactionEvents = ['pointerdown', 'wheel', 'keydown'];
  if (awaitingAnchorExit) for (const name of interactionEvents) window.addEventListener(name, interact, {passive: true});
  const hide = () => { pageActive = false; sync(); };
  const show = () => { pageActive = true; sync(); };
  reducedMotion.addEventListener('change', sync);
  finePointer.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  return () => {
    disposed = true;
    generation++;
    cancelScheduled();
    observer.disconnect();
    paintObserver?.disconnect();
    window.removeEventListener('load', loaded);
    for (const name of interactionEvents) window.removeEventListener(name, interact);
    reducedMotion.removeEventListener('change', sync);
    finePointer.removeEventListener('change', sync);
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    releaseEffect();
  };
}
