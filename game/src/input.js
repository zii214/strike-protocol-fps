// Keyboard and mouse, gathered in one place. The simulation reads key state
// and consumes the mouse-look deltas once a frame; nothing else touches DOM
// events. Edge-triggered actions (buy keys, plant key, weapon slots) are
// exposed as a pressed-set the match drains each step, so a key held down
// does not repeat.

export function createInput(canvas, onLockChange) {
  const keys = new Set(); // codes currently down: KeyW, Digit1, ...
  const pressed = new Set(); // codes that went down since the last drain
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false; // right mouse held: aim down sights
  let locked = false;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    firing = false;
    aiming = false;
  });

  canvas.addEventListener('mousedown', (event) => {
    if (!locked) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      firing = false;
      aiming = false;
    }
    onLockChange(locked);
  });
  document.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  });

  return {
    state: {
      get keys() { return keys; },
      get firing() { return firing; },
      get aiming() { return aiming; },
      get locked() { return locked; },
    },
    // Mouse deltas since the last call, in pixels.
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // Key codes pressed since the last call; drains the set.
    takePressed() {
      const out = new Set(pressed);
      pressed.clear();
      return out;
    },
    requestLock() {
      canvas.requestPointerLock();
    },
  };
}
