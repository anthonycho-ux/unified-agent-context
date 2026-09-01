# Three.js Patterns and Pitfalls for Agents (r185)

> Provenance: authored by Sol (Aside) 2026-08-29 23:52 MDT. Each item verified against the threejs.org manual, docs, or r185 source on this date; the debunked-myth section corrects claims that circulate widely but are false.

## The tripwires in priority order

1. **Color-space textures.** A color map (map, emissiveMap) without `texture.colorSpace = THREE.SRGBColorSpace` renders dark or dull because three lights and composites in linear space. GLTFLoader sets this automatically; hand-loaded textures do not. Non-color maps must stay NoColorSpace. This is the single most common cause of wrong-looking output.
2. **Physical light intensities.** PointLight intensity is in candela with default 1, but realistic scenes need much higher values (manual examples: 150). Old tutorials using intensity 1 with decay 2 look almost black. If lights seem to do nothing, raise intensity, do not assume the SSR or code is wrong.
3. **Async loading.** Loaders return immediately and the asset arrives later. Code that reads the geometry right after `load()` sees nothing. Wait on the onLoad callback or a shared LoadingManager before scripting the asset.
4. **Memory leaks from undisposed objects.** three.js never auto-disposes. Rebuilds inside a long loop without dispose accumulate GPU buffers and shader programs. Dispose geometry, material, and texture (and example-class dispose methods) when replacing content.
5. **Resize without projection update.** If you resize the canvas but forget `camera.updateProjectionMatrix()` after changing aspect, the scene stretches or clips. Fold resize into the loop or a resize handler.
6. **fov is in degrees.** PerspectiveCamera takes degrees, the one non-radian in the API. Passing radians makes the view wrong by an order of magnitude.

## Patterns that reliably work

- One render loop, delta-based updates for animations (mixer or tweens), never absolute-time steps inside the loop.
- `renderer.setAnimationLoop` over hand-rolled requestAnimationFrame; it pauses in hidden tabs.
- Reuse geometry and material across meshes. Millions-scale scenes: merge static geometry or use InstancedMesh, never one Mesh per object.
- Render on demand for static content via a change-gated flag; continuous animation loops waste battery when nothing moves.
- Raycast with a cached, reused Raycaster instance (and cached Vector/Matrix temps) to avoid per-frame allocation.
- Feed a shared LoadingManager to every loader when a scene depends on many assets, and gate the reveal on onLoad.

## Debunked myths (verified false, corrected here)

- `THREE.FLAT` does not exist. Real equivalents are `material.flatShading` and a textured `Scene.background`.
- WebGPURenderer does not default to ACESFilmicToneMapping. Both renderers default to toneMapping NoToneMapping and outputColorSpace SRGBColorSpace as of r185.
- There is no `createSceneFromJSON` / manifest API in official three.js. Use `scene.toJSON()` + ObjectLoader.
- `build/three.min.js` and WebGL1 support are gone (removed r161 / r163). ES modules and WebGL2 only.
- `outputEncoding`, `Texture.encoding`, `useLegacyLights`, and `Clock` are deprecated or replaced (outputColorSpace / colorSpace / Timer). Code using the old names fails or warns on r185.

## Version drift watch (recent migrations that break old code)

- Material/color management and lighting defaults (the two tripwires above) come from r146 to r155 era changes. Anything older than ~r155 should be re-read through this doc.
- r161: ES modules only. r163: WebGL1 removed.
- r180 to r185 moved WebGPURenderer methods to `init()` / `setAnimationLoop`, renamed colorBufferType to outputBufferType, PostProcessing to RenderPipeline, Clock to Timer, PI2 to TWO_PI.
- Latest deprecations (r183 to r185): VTKLoader and LWOLoader deprecated, DRACOLoader.setDecoderConfig deprecated, SVGLoader.createShapes deprecated (use shapePaths.toShapes()), Matrix3.scale/rotate/translate deprecated.

Full per-release detail lives in the wiki Migration Guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide
