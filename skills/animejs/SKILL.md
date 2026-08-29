---
name: animejs
description: Author web animations with Anime.js v4 using the exact v4 API surface: animate(), createTimeline(), createTimer(), createAnimatable(), createDraggable(), createLayout(), createScope(), waapi, engine, easings, utils, svg and text modules. Use when writing or debugging Anime.js animations, timelines, staggered effects, SVG morphing/path/draw animations, text splitting, drag interactions, scroll-driven effects, WAAPI-powered lightweight tweens, or custom target adapters (Three.js meshes, canvas). Verified against the official v4.5.0 documentation.
---

# Anime.js v4

Anime.js is a lightweight JavaScript animation engine for the DOM, SVG, and arbitrary JavaScript objects. v4 has a module-based API: every feature is a named import, most imports are tree-shakeable through subpaths, and animations are handled by the engine's own synchronized loop.

## When to use

Reach for Anime.js when the task is web animation and the API needs to stay small: UI micro-interactions, staggered reveals, SVG line drawing and morphing, text split/scramble effects, scroll-linked animation, drag physics, or animating objects that are not plain DOM (a Three.js mesh, a canvas context). The v4 API is compact and readable: one `animate()` call with a targets value and a plain parameters object.

Do not use it when a plain CSS transition or keyframe animation already solves the problem (no JS needed, no timeline control needed), or as the primary sequencing engine inside HyperFrames compositions, where GSAP is the default authoring path and Anime.js is a secondary seek-driven adapter (see the HyperFrames notes at the end). Do not use the WAAPI build when you need the full feature set: `waapi.animate()` is a smaller 3KB feature subset of the 10KB full `animate()`.

## Install and import

```js
// npm
npm install animejs
```

```js
import { animate } from 'animejs';            // main module
import { animate } from 'animejs/animation';  // tree-shaken subpath
import { createTimeline } from 'animejs/timeline';
import { createTimer } from 'animejs/timer';
import { createAnimatable } from 'animejs/animatable';
import { createDraggable } from 'animejs/draggable';
import { createLayout } from 'animejs/layout';
import { createScope } from 'animejs/scope';
import { waapi } from 'animejs/waapi';
import { stagger, utils } from 'animejs/utils';
import { easings, eases, cubicBezier, spring } from 'animejs/easings';
import { morphTo, createMotionPath, createDrawable } from 'animejs/svg';
import { splitText, scrambleText } from 'animejs/text';
import { onScroll } from 'animejs/events';
import { registerAdapter } from 'animejs/adapters';
import 'animejs/adapters/three';               // built-in Three.js adapter
```

For vanilla JS without a bundler, load the IIFE build from a CDN (`lib/anime.iife.min.js`), which exposes the engine on `window.anime`. Note: v4's API is `animate(targets, parameters)`; the v3-style single-object call (`anime({ targets, ... })`) is the old API. Check the v3 to v4 migration guide when porting older code.

## Minimal animation

```js
import { animate } from 'animejs';

animate('.square', {
  translateX: 100,
  scale: 2,
  opacity: .5,
  duration: 400,
  delay: 250,
  ease: 'out(3)',
});
```

The returned object is a `JSAnimation` with playback methods:

`play()`, `reverse()`, `pause()`, `restart()`, `alternate()`, `resume()`, `complete()`, `cancel()`, `revert()`, `reset()`, `seek()`, `stretch()`, `refresh()`.

The v4 parameter name is `ease`, not the v3 `easing`.

## Parameters

Parameters can be set globally (applied to every animated property) or locally per property with an object:

```js
animate('.square', {
  x: {
    to: 100,
    delay: 0,
    ease: 'inOut(4)',     // local tween parameters
  },
  scale: 1,
  opacity: .5,
  duration: 400,          // global tween parameters
  delay: 250,
  ease: 'out(3)',
  loop: 3,
  alternate: true,
});
```

### Tween parameters (per property)

| Parameter | Purpose |
| --- | --- |
| `to` | Target value for the property |
| `from` | Starting value (`rotate: { from: '-1turn' }`) |
| `delay` | Delay before this tween starts |
| `duration` | Tween duration |
| `ease` | Easing function or name |
| `composition` | How the property composes with the current value |
| `modifier` | Function transforming the interpolated value before it is applied |

### Playback settings (animation level)

`delay`, `duration`, `loop`, `loopDelay`, `alternate`, `reversed`, `autoplay`, `frameRate`, `playbackRate`, `playbackEase`, `persist`.

```js
animate('.square', {
  x: 100,
  loop: 3,
  alternate: true,   // ping-pong each loop
  autoplay: false,   // control playback manually
});
```

Minimal default: `loopDelay` offsets the pause between loops, `alternate` reverses direction each iteration, `reversed` plays from the end, `persist` keeps the final values applied after completion, `frameRate` throttles updates per second.

### Callbacks

`onBegin()`, `onComplete()`, `onBeforeUpdate()`, `onUpdate()`, `onRender()`, `onLoop()`, `onPause()`, and `then()` for chaining completion work.

```js
animate('.square', {
  x: 100,
  duration: 400,
  onBegin: () => {},
  onLoop: () => {},
  onUpdate: () => {},
});
```

### Keyframes

Four forms, all valid.

```js
// Property value keyframes: array of raw values
animate('.square', { x: [0, 100, 200], y: [0, 100, 200], duration: 3000 });

// Property tween-parameter keyframes: array of { to } objects with per-step ease/duration
animate('.square', {
  x: [{ to: 100 }, { to: 200 }],
  y: [{ to: 100 }, { to: 200 }],
  duration: 3000,
});

// Animation-level keyframes: sequence of frames, duration-split
animate('.square', {
  keyframes: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
  duration: 3000,
});

// Animation-level keyframes: percentage-split
animate('.square', {
  keyframes: {
    '0%':  { x: 0,   y: 0 },
    '50%': { x: 100, y: 100 },
    '100%':{ x: 200, y: 200 },
  },
  duration: 3000,
});
```

### Target value forms

Numbers, unit strings (`'15rem'`, `'-40vh'`, `'2.75rem'`), keyframes arrays, `from`/`to` objects, CSS variables, and function-based values (`stagger(...)`, custom functions receiving the target and index).

## Timeline

`createTimeline()` synchronizes animations, timers, and callbacks.

```js
import { createTimeline } from 'animejs';

const tl = createTimeline({ defaults: { duration: 750 } });

tl.label('start')
  .add('.square', { x: '15rem' }, 500)
  .add('.circle', { x: '15rem' }, 'start')
  .add('.triangle', { x: '15rem', rotate: '1turn' }, '<-=500');
```

| Method | Purpose |
| --- | --- |
| `tl.add(target, animationParameters, position)` | Add an animation at a position |
| `tl.add(timerParameters, position)` | Add a bare timer |
| `tl.sync(timelineB, position)` | Sync another timeline (or WAAPI animation) |
| `tl.call(callbackFunction, position)` | Fire a function at a position |
| `tl.label(labelName, position)` | Name a position for reference |

Position accepts an absolute number (ms from timeline start), `'labelName'`, `'<'` (end of previous), `'<='`, `'<-=500'` (before previous end), `'start'`, `'+=500'`, and the same forms with labels.

## Easing

```js
import { animate, cubicBezier, spring } from 'animejs';

animate(target, { x: 100, ease: 'inOut(3)' });                    // built-in ease string
animate(target, { x: 100, ease: cubicBezier(.7, .1, .5, .9) });   // custom cubic-bezier
animate(target, { x: 100, ease: spring({ bounce: .35 }) });       // spring physics
```

Built-in ease strings follow `inQuad`, `outQuad`, `inOutQuad`, `inExpo`, `outExpo`, `outBounce`, `inCirc`, `outCirc`, and the power shorthand `inOut(3)` / `out(3)` where the number is the exponent. Low-level generators: `eases.inOut(3)`, `easings.cubicBezier(...)`, `easings.spring(...)`. Also available: `linear()` and steps easing. Use the official Easing Functions Editor at animejs.com/easing-editor to design and export custom curves. `ease` also works as `playbackEase` for animation-level playback timing.

## Utilities

All utilities import from `utils` or as named exports, and most double as `modifier` functions.

Core helpers: `$()` (selector, returns matching elements), `get()`, `set()` (set values instantly), `cleanInlineStyles()`, `remove()`, `sync()`.

Interpolation/mapping: `clamp(v, min, max)`, `snap(v, step)`, `wrap(v, min, max)`, `mapRange(inputStart, inputEnd, outputStart, outputEnd, value)`, `lerp(a, b, t)`, `damp(current, target, lambda, deltaTime)` (frame-rate independent smoothing), `round(n)`, `roundPad(n, decimals)`, `padStart`, `padEnd`.

Random: `random(min, max)`, `createSeededRandom()` (deterministic, good for reproducible render pipelines), `randomPick(array)`, `shuffle(array)`.

Units: `degToRad(deg)`, `radToDeg(rad)`.

Timing: `keepTime()` creates a time keeper for custom frame-rate-independent logic.

### stagger()

`stagger(value, parameters)` returns a function-based value distributing values or delays across multiple targets.

```js
import { animate, stagger } from 'animejs';

animate('.square', {
  x: '17rem',
  scale: stagger([1, .1]),   // distribute values across targets
  delay: stagger(100),       // classic sequential delay
});
```

Stagger supports time staggering, value staggering, and position staggering inside timelines (`tl.add(..., stagger(-250))`). Use the grid option to stagger across 2D grids with `from` anchoring (e.g. from the center outward). Check the stagger reference for grid and axis options before hand-writing offsets.

## SVG

```js
import { morphTo, createMotionPath, createDrawable } from 'animejs';

// Morph one path shape into another
animate('.path', {
  d: morphTo('.other-path'),
});

// Drive an element along a path
const path = createMotionPath('.route');
animate('.dot', {
  x: path,
  y: path,
  rotate: path,
});

// Line drawing (stroke reveal)
animate('.stroke', {
  draw: createDrawable('.stroke'),
});
```

`morphTo()` animates the `d` attribute between compatible paths, `createMotionPath()` samples a path into x/y/rotate function values, `createDrawable()` enables stroke-draw animations. SVG line drawing and path following are the two most common uses.

## Text

```js
import { splitText, scrambleText } from 'animejs';

const { chars, words } = splitText('h2', { words: true, chars: true });

animate(chars, {
  y: [{ to: '-2.75rem', ease: 'outExpo', duration: 600 },
       { to: 0, ease: 'outBounce', duration: 800, delay: 100 }],
  delay: stagger(50),
  loop: true,
});
```

`splitText()` wraps target text into `words` / `chars` collections for per-character or per-word animation. `scrambleText()` animates text content with a scrambling effect. Split the text once and animate the returned collections.

## Draggable

`createDraggable(target, parameters)` adds drag physics to a DOM element:

```js
import { createDraggable } from 'animejs';

const draggable = createDraggable('.square', {
  // axes parameters: constrain to x / y / both
  // settings: container bounds, grid snapping, throw/inertia, elastic release
  // callbacks: drag start/move/end hooks
});
```

Axes parameters, settings (container, grid, release behavior), callbacks, and methods are documented in separate sections. Common use: constraint boxes, snap-to-grid, and throw-with-inertia interactions.

## Animatable

`createAnimatable(targets, parameters)` creates an object whose per-property functions animate or read values. It is optimized for frequently changing values (cursor events, loops) where `animate()` and `set()` would be wasteful:

```js
import { createAnimatable, utils } from 'animejs';

const animatable = createAnimatable('.square', {
  x: 500,   // x duration 500ms
  y: 500,   // y duration 500ms
  ease: 'out(3)',
});

animatable.x(200);   // animate x to 200 over 500ms
animatable.x();      // get current x value
```

Only `Number` or `Array<Number>` values are allowed for performance.

## Layout

`createLayout(root, parameters)` animates between two HTML layout states, covering properties CSS cannot tween (display, flex direction, grid settings, DOM order):

```js
import { createLayout, stagger } from 'animejs';

const layout = createLayout('.layout-container');

layout.update(({ root }) => root.classList.toggle('grid'), {
  duration: 1000,
  delay: stagger(150),
  onComplete: () => {},
});
```

Or explicitly: `layout.record()`, mutate the layout, then `layout.animate()`. Returns an `AutoLayout` instance.

## Scope

`createScope({ mediaQueries })` wraps animations in a reactive scope: media query matches, custom root element for selector scoping, shared default parameters, and batch revert:

```js
import { animate, createScope } from 'animejs';

createScope({
  mediaQueries: {
    isSmall: '(max-width: 200px)',
    reduceMotion: '(prefers-reduced-motion)',
  },
})
.add(self => {
  const { isSmall, reduceMotion } = self.matches;

  animate('.square', {
    x: isSmall ? 0 : ['-35vw', '35vw'],
    duration: reduceMotion ? 0 : isSmall ? 750 : 1250,
  });
});
```

This is the correct tool for responsive and component-based setups and for honoring `prefers-reduced-motion`.

## Timer and events

`createTimer({ duration, loop, frameRate, onUpdate, onLoop })` is an engine-synchronized alternative to `setTimeout`/`setInterval`; the state object exposes `currentTime` and iteration counters.

`events.onScroll()` creates scroll-linked animation controls when scroll-drive feedback is needed. Use scope + media queries for responsiveness and reduced-motion handling.

## Engine

The engine drives and synchronizes every Animation, Timer, and Timeline instance.

- Execution order is insertion order; control it with the `priority` parameter (lower runs first, default `1`).
- Methods: `engine.update()`, `engine.pause()`, `engine.resume()`.
- `engine.pauseOnDocumentHidden` controls behavior when the tab is hidden. Engine defaults live under the engine section of the docs; check them before tuning frame behavior.

## WAAPI mode

```js
import { waapi, stagger } from 'animejs';

const animation = waapi.animate('.square', {
  translate: '0 -2rem',
  delay: stagger(100),
  duration: 600,
  loop: true,
  alternate: true,
  ease: 'inOut(2)',
});
```

`waapi.animate()` is a 3KB subset of the 10KB full `animate()`, powered by the native Web Animations API (`Element.animate()`), with hardware acceleration and Anime.js improvements (better stagger, ease handling, `convertEase()`). Use it for basic tweens on DOM when bundle size or native WAAPI integration matters; use full `animate()` when you need the advanced modules (SVG, text, custom adapters, engine-level control).

## Custom adapters

`registerAdapter()` extends `animate()`, `createTimeline()`, and `utils.set()` to objects that do not expose plain properties (Three.js meshes, canvas contexts, widgets).

```js
import { registerAdapter } from 'animejs/adapters';

const myAdapter = registerAdapter();

// Fixed property set per target type
const widget = myAdapter.registerTargetAdapter(target => target instanceof MyClass);
widget.registerProperty('foo',
  target => target.getFoo(),               // getter
  (target, value, tween) => target.setFoo(value), // setter
  target => target.fooEnabled,             // optional gate
);

// Dynamic property names (offsetX, offsetY, ...)
myAdapter.registerPropertyResolver((target, name) => {
  if (target instanceof MyClass && name.startsWith('foo_')) {
    const key = name.slice(4);
    return {
      get: t => t.getFoo(key),
      set: (t, value, tween) => t.setFoo(key, value),
    };
  }
  return null;  // defer to the next resolver
});
```

Resolution order: adapters in registration order; target adapters first (first match wins), then property resolvers (first non-null wins). Names no adapter claims are set directly with `target[name] = value`. For color and complex tweens, the setter receives `undefined` as value; read channels from the live tween's `_numbers` array. A built-in Three.js adapter ships as `import 'animejs/adapters/three'`.

## HyperFrames interplay

Inside HyperFrames compositions, Anime.js runs through the `animejs` runtime adapter as a secondary engine behind the GSAP default. The adapter contract (from the HyperFrames adapter reference):

- Create animations synchronously during composition initialization.
- Set `autoplay: false` so Anime.js does not advance on its own clock.
- Register every returned animation or timeline on `window.__hfAnime`.
- Use finite durations and loop counts, and avoid wall-clock, network, or unseeded-randomness callbacks.
- HyperFrames drives every registered instance with `instance.seek(timeMs)`.

Prefers GSAP for complex scene sequencing unless Anime.js is explicitly requested. Full pattern: the HyperFrames `hyperframes-animation` skill, `adapters/animejs.md`.

## Gotchas

- v4 renamed the main factory: use `animate(targets, params)`, not v3's `anime({ targets, ... })`.
- The parameter is `ease` (v3 used `easing`).
- In full `animate()`, transforms are individual properties (`translateX`, `rotate`, `scale`). The WAAPI build uses the `translate`/`rotate`/`scale` shorthand forms.
- `Animatable` property functions accept only numbers.
- For reproducible renders (video pipelines, deterministic demos), use `createSeededRandom()`; anything seeded with wall-clock randomness will not reproduce frame-for-frame.
- Autoplay defaults on: set `autoplay: false` whenever you take manual control (play/seek) or integrate into an external clock.

## Verification

- Confirm the animation runs and ends in the expected state: check `onComplete` fired, or inspect the final computed style/attribute.
- For seek-driven integration, verify `seek(t)` reproduces identical renders at the same time across runs.
- In HyperFrames compositions, run `npx hyperframes lint` and `npx hyperframes validate` after editing.
- When porting v3 code, diff against the migration guide (github.com/juliangarnier/anime/wiki/Migrating-from-v3-to-v4).

## Credits

Measured from the official Anime.js v4.5.0 documentation (animejs.com, fetched 2026-08-28) by Sol (Aside) and posted to UAC for fleet use. Verify APIs against the live docs when behavior seems off; the engine evolves fast.
