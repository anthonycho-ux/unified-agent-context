# Three.js Agent Knowledge Base

> Provenance: authored by Sol (Aside) 2026-08-29 23:52 MDT. Version-sensitive facts verified against three.js r185 (published 2026-07-01), the threejs.org manual, the npm package, and the github.com/mrdoob/three.js wiki Migration Guide on this date. This is a living reference; re-verify version-dependent details before shipping.

## One frame

three.js is an ES-module 3D library for the browser. Current stable is r185 (npm 0.185.1). The legacy single-file builds (build/three.js, three.min.js) were removed in r161; everything is ES modules with import maps or a bundler. The two facts that ruin most first attempts: color-managed textures and physical-unit light intensities. Everything else is pattern.

## Who this is for

An AI agent or engineer building with three.js, especially resuming or extending an existing project such as the Gargantua black-hole simulation, or starting fresh in 2026.

## How to consume (agent path)

Read this index first, then the targeted file. Each pattern lives in one place; the cheatsheet holds the code shapes. Two hops to any answer.

## File map

| File | Covers |
| --- | --- |
| `core-architecture.md` | scene graph, the two renderers, cameras, the render loop, resize, disposal |
| `api-cheatsheet.md` | geometry, materials, lights, textures, loaders, animation, raycasting, performance in code-shaped patterns |
| `shaders.md` | ShaderMaterial vs RawShaderMaterial, uniforms, and the color-space conversion contract |
| `patterns-pitfalls.md` | the agent tripwires: async loads, color management traps, memory leaks, performance, debunked myths |
| `worked-example.md` | the verified r185 hello-cube, plus the path to a custom Gargantua-style build |

## Verified version pin and drift watch

- Current stable: **r185**, published 2026-07-01 (GitHub releases, threejs.org header, npm 0.185.1).
- Release cadence roughly every 2 to 3 months: r184 2026-04-16, r183 2026-02-20.
- Dev is heading to r186. Known upcoming changes (from the Migration Guide r185 to r186): Object3D gains `dispose()`; Source renamed TextureSource; LightProbeGrid renamed LightProbeGridWebGL; PCFSoftShadowMap removed on WebGPURenderer; SimplifyModifier becomes async on meshoptimizer.
- WebGPU is now a first-class renderer with automatic WebGL2 fallback, but the WebGLRenderer path remains the safe default for wide compatibility.

## Debunked claims agents commonly repeat

- `THREE.FLAT` does not exist. No such constant or scene type in the r185 API. The real primitives are `material.flatShading` and `Scene.background` as a texture.
- The WebGPURenderer does NOT default to ACESFilmicToneMapping. As of r185 the shared renderer base sets outputColorSpace SRGBColorSpace and toneMapping NoToneMapping for both renderers.
- There is no official `createSceneFromJSON` / manifest API. The official JSON workflow is `scene.toJSON()` plus ObjectLoader (load, parse, parseAsync); the JSON Object Scene format is version 4.7.
- `three.min.js` and WebGL1 support are gone. ES modules only, and the renderer is WebGL2 minimum.

## Source roots

- Manual: https://threejs.org/manual/en/ (installation, fundamentals, and per-topic pages)
- Docs (JSDoc generated): https://threejs.org/docs/
- Migration Guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide
- Releases: https://github.com/mrdoob/three.js/releases
