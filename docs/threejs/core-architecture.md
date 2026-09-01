# Three.js Core Architecture (r185)

> Provenance: authored by Sol (Aside) 2026-08-29 23:52 MDT. Verified against the threejs.org manual and the r185 source on this date.

## Scene graph

Everything you render hangs off a scene graph. `THREE.Scene` is the root. You add objects (Mesh, Group, Light, Camera) with `scene.add(...)`. A `Mesh` is `geometry + material + transform`. A `Group` is a transform-only container. Children inherit parent transforms, so parent a Group to the camera and add your scene objects to it to make them follow the view.

- World transform is computed by the renderer from the hierarchy on each frame. You do not call `updateMatrix` yourself except for instances.
- `Scene.background` can be a color, a texture, or a cube/environment map. `scene.fog` adds depth haze.

## The two renderers

- `THREE.WebGLRenderer` from `three` is the safe default. WebGL2 only since r163. Good cross-browser behavior.
- `THREE.WebGPURenderer` from `three/webgpu` is current and stable, and auto-falls back to a WebGL2 backend when WebGPU is unavailable. It pairs with NodeMaterial and the TSL shading language from `three/tsl`. Both renderers share a common base in r185 that sets outputColorSpace SRGBColorSpace and toneMapping NoToneMapping by default.
- For most builds, start with `WebGLRenderer` unless you specifically want WebGPU shaders (NodeMaterial/TSL) or know the target browser fully supports WebGPU.

## Cameras

- `THREE.PerspectiveCamera(fovDegrees, aspect, near, far)`. fov is in degrees, the odd one out in a radian API. near/far define the visible slice of depth.
- After any change to fov, aspect, near, or far, call `camera.updateProjectionMatrix()`.
- The renderer matches aspect from the canvas; set `camera.aspect = canvas.clientWidth / canvas.clientHeight` on a real resize and update the projection matrix.

## The render loop

Preferred pattern in r185: `renderer.setAnimationLoop(callback)` instead of a hand-rolled `requestAnimationFrame`. The docs note that setAnimationLoop uses requestAnimationFrame internally and pauses the loop in hidden tabs, which is what you want. The callback receives elapsed milliseconds since load.

```js
renderer.setAnimationLoop( animate );
function animate( time ) {
  // update state
  // mixer.update( delta ) if animating
  renderer.render( scene, camera );
}
```

For frame-rate-independent animation, measure `delta` with a clock:
```js
import { Clock } from 'three';
const clock = new Clock();
// inside the loop:
const delta = clock.getDelta();
```

## Resize (the pattern)

Match the drawing buffer to the CSS display size, and only touch the camera aspect when the size actually changed. Prefer this over `renderer.setPixelRatio(window.devicePixelRatio)`, which the manual explicitly discourages without a pixel-count cap.

```js
function resizeRendererToDisplaySize( renderer ) {
  const canvas = renderer.domElement;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const need = canvas.width !== w || canvas.height !== h;
  if ( need ) renderer.setSize( w, h, false ); // false = keep CSS control
  return need;
}
// per frame or on window resize:
if ( resizeRendererToDisplaySize( renderer ) ) {
  camera.aspect = renderer.domElement.clientWidth / renderer.domElement.clientHeight;
  camera.updateProjectionMatrix();
}
```

## Disposal (mandatory, manual)

three.js cannot know what you still reference, so it never auto-disposes. To free a Mesh cleanly:

```js
scene.remove( mesh );
geometry.dispose();   // frees GPU buffers
material.dispose();   // frees shader programs when the last user is disposed
texture.dispose();    // per texture; textures are shared across materials
```

Example classes (OrbitControls, post-processing passes, LOD) expose their own `dispose()`. ImageBitmap texture sources need `ImageBitmap.close()`. WebGLRenderTarget has its own `dispose()`. Missing disposal is the classic intermittent-memory-leak in long-running scenes.

## Post-processing note

Post-processing in r185 uses EffectComposer plus passes. The r182+ naming change: PostProcessing was renamed RenderPipeline. When you render through post-processing, the final tone mapping and color-space conversion happen in an OutputPass, not in the renderer, because the renderer writes to a render target rather than to screen.
