// Minimal promise-based tween engine driven by the render loop.

const active = new Set();
let speed = 1;

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

export function setTweenSpeed(s) { speed = s; }
export function getTweenSpeed() { return speed; }

// tween(durationSeconds, onUpdate(t), easing) -> Promise
export function tween(duration, onUpdate, easing = ease.inOutCubic) {
  return new Promise((resolve) => {
    if (speed >= 50 || duration <= 0) { onUpdate(1); resolve(); return; }
    active.add({ t: 0, duration, onUpdate, easing, resolve });
  });
}

export function wait(seconds) {
  return tween(seconds, () => {}, ease.linear);
}

export function updateTweens(dt) {
  for (const tw of active) {
    tw.t += (dt * speed) / tw.duration;
    const done = tw.t >= 1;
    tw.onUpdate(tw.easing(Math.min(1, tw.t)));
    if (done) { active.delete(tw); tw.resolve(); }
  }
}

export function finishAllTweens() {
  for (const tw of active) { tw.onUpdate(1); tw.resolve(); }
  active.clear();
}

export function tweenCount() { return active.size; }
