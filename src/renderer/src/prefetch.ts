const inflight = new Set<string>();
const done = new Set<string>();
const MAX_DONE = 5000;

function loadOne(url: string): void {
  if (inflight.has(url) || done.has(url)) return;
  if (done.size > MAX_DONE) done.clear();
  inflight.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    inflight.delete(url);
    done.add(url);
  };
  img.onerror = () => {
    inflight.delete(url);
    done.add(url);
  };
  img.src = url;
}

type IdleScheduler = (cb: () => void) => void;
const idleScheduler: IdleScheduler =
  typeof (window as unknown as { requestIdleCallback?: IdleScheduler }).requestIdleCallback === 'function'
    ? (window as unknown as { requestIdleCallback: IdleScheduler }).requestIdleCallback
    : (cb) => setTimeout(cb, 200);

export function prefetchFrame0(url: string): void {
  loadOne(url);
}

export function prefetchFrameIdle(url: string): void {
  idleScheduler(() => loadOne(url));
}

export function isPrefetched(url: string): boolean {
  return done.has(url);
}
