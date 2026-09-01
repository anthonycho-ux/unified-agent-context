# Three.js API Cheatsheet (r185)

> Provenance: authored by Sol (Aside) 2026-08-29 23:52 MDT. Every snippet shape below was verified against the threejs.org manual, docs, and example code on this date. Sources are inline per section.

## Geometry

BufferGeometry is a bag of named parallel-array attributes. Names are significant: `position`, `normal`, `uv`, `color`. A vertex is the full tuple, so a cube corner that needs different normals or UVs per face is duplicated as separate vertices.

```js
const geometry = new THREE.BufferGeometry();
geometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( positions ), 3 ) );
geometry.setAttribute( 'normal',   new THREE.BufferAttribute( new Float32Array( normals ), 3 ) );
geometry.setAttribute( 'uv',       new THREE.BufferAttribute( new Float32Array( uvs ), 2 ) );
geometry.setIndex( [0,1,2, 2,1,3, ...] ); // indexed: 24 shared vertices instead of 36 for a cube
```

- `computeVertexNormals()` produces seams on closed shapes because seam vertices carry different UVs and cannot be shared. Supply normals yourself when smoothness matters. (https://threejs.org/manual/en/custom-buffergeometry.html)
- Dynamic updates: mark once with `attribute.setUsage( THREE.DynamicDrawUsage )`, mutate the TypedArray in place, then `attribute.needsUpdate = true` each frame.

## Instancing (thousands of movable objects)

```js
const mesh = new THREE.InstancedMesh( geo, mat, count );
const dummy = new THREE.Object3D();
dummy.position.set( x, y, z );
dummy.updateMatrix();
mesh.setMatrixAt( i, dummy.matrix );
mesh.instanceMatrix.needsUpdate = true; // required after setMatrixAt/setColorAt
mesh.computeBoundingSphere();           // not automatic; recompute after transforms move
```

(https://threejs.org/manual/en/optimize-lots-of-objects.html, https://threejs.org/docs/pages/InstancedMesh.html)

## Materials: pick the cheapest that does the job

Speed ladder: MeshBasicMaterial (unlit, no lights needed) < MeshLambertMaterial (vertex lighting) < MeshPhongMaterial (per-pixel + specular) < MeshStandardMaterial (PBR, roughness + metalness 0..1) < MeshPhysicalMaterial (adds clearcoat).

- `side` defaults to FrontSide; set `THREE.DoubleSide` for open planes.
- After changing `flatShading` or adding/removing a texture on an already-rendered material, set `material.needsUpdate = true`.
- `emissive` on a standard material is a self-lit color, not a light. Use `emissive` + `emissiveIntensity`; an emissiveMap needs a non-black emissive color to show. (https://threejs.org/manual/en/materials.html)

## Lights: physical units

- PointLight intensity is in candela with default 1; decay default is 2 and should stay for physically correct falloff. distance 0 means infinite inverse-square. Manual examples use intensity 150 for point/spot lights and 5 for RectAreaLight.
- Directional and spot lights have a `target` Object3D that must be added to the scene.
- RectAreaLight only affects MeshStandard/Physical and needs `RectAreaLightUniformsLib.init()` plus the addon import.
- Fewer lights = fewer draw costs. (https://threejs.org/docs/pages/PointLight.html, https://threejs.org/manual/en/lights.html)

## Textures: the color-space rule

```js
const texture = new THREE.TextureLoader().load( url );
texture.colorSpace = THREE.SRGBColorSpace; // REQUIRED for .map and .emissiveMap
```

- Color maps (map, emissiveMap) get SRGBColorSpace. Non-color maps (normalMap, roughnessMap, aoMap) keep the default NoColorSpace. Env/light maps are LinearSRGBColorSpace. GLTFLoader sets the correct color space on color textures automatically.
- `THREE.ColorManagement.enabled = true` is the default and auto-converts hex/CSS color inputs. Rendering works in linear space; the renderer converts output.
- Loaders are async. To wait on many textures, pass a shared LoadingManager and hook `onLoad`/`onProgress`.
- Mipmaps: default minFilter LinearMipmapLinearFilter handles minification. Changing wrapS/wrapT requires `texture.needsUpdate = true`.
- GPU memory roughly width times height times 4 times 1.33 bytes uncompressed; shrink dimensions, not just file size. (https://threejs.org/manual/en/textures.html, https://threejs.org/manual/en/color-management.html)

## Loaders: GLTF is the asset format

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const loader = new GLTFLoader(); // optional: pass a LoadingManager
loader.load( url, ( gltf ) => {
  scene.add( gltf.scene );        // gltf.scene is a Group
  const clips = gltf.animations;  // AnimationClip[]
}, onProgress, onError );
```

Addons import path is always `three/addons/...`, e.g. OrbitControls from `three/addons/controls/OrbitControls.js`. Keep all imports on the same three version and same CDN. (https://threejs.org/manual/en/installation.html, https://threejs.org/docs/pages/GLTFLoader.html)

- DRACO compression: `setDRACOLoader( dracoLoader )` before load; DRACOLoader itself needs `setDecoderPath` before decoding. KTX2 and meshopt use `setKTX2Loader` / `setMeshoptDecoder`.
- Shadows: enable `renderer.shadowMap.enabled = true`, then set `castShadow`/`receiveShadow` per mesh via `scene.traverse`, then make the shadow camera frustum big enough. Tune `light.shadow.bias` and `light.shadow.mapSize`.
- Dump the loaded scene graph via `traverse` before scripting nodes; baked scale/rotation/offset in assets breaks runtime manipulation. (https://threejs.org/manual/en/load-gltf.html)

## Animation (mixer + clips)

```js
const mixer = new THREE.AnimationMixer( root );          // root targets the clip's object
const action = mixer.clipAction( gltf.animations[ 0 ] );
action.play();
// in the render loop:
const delta = clock.getDelta();
mixer.update( delta );
```

`clipAction` returns a cached action (same object per clip/root). Actions crossfade via `weight`; `timeScale = 0` pauses; deallocation is explicit: `stopAllAction()` then `uncacheAction`, `uncacheClip`, `uncacheRoot`. (https://threejs.org/manual/en/animation-system.html)

## Raycasting (clicks)

```js
const raycaster = new THREE.Raycaster();   // reuse one instance
const ndc = new THREE.Vector2();
ndc.x = ( clientX / width )  * 2 - 1;       // Y is flipped:
ndc.y = ( clientY / height ) * -2 + 1;
raycaster.setFromCamera( ndc, camera );
const hits = raycaster.intersectObjects( scene.children );
if ( hits.length ) { const obj = hits[ 0 ].object; }
```

CPU-based: slow on heavy geometry, wrong for displaced/morphed/skinned geometry, ignores transparent holes. For robust picking on complex scenes, use GPU picking (unique-color render to a small target, read pixels). (https://threejs.org/manual/en/picking.html)

## Performance

- One loop, frame-rate independent (use delta, not absolute time).
- Reuse geometry and material across many meshes.
- Static thousands: merge with `BufferGeometryUtils.mergeGeometries`. Movable thousands: InstancedMesh.
- LOD: `new THREE.LOD()` + `addLevel( object, distance )`; set `hysteresis` to avoid boundary flicker.
- Render on demand for non-animated content: render once, then re-render on change events gated by a flag; with OrbitControls enableDamping you must call `controls.update()` each frame, which forces the loop.
- Avoid per-frame allocation: cache raycaster, Vector3, and Matrix4 temps outside the loop (as official examples do). (https://threejs.org/manual/en/fundamentals.html, https://threejs.org/manual/en/rendering-on-demand.html)

## Camera

`PerspectiveCamera( fovDegrees, aspect, near, far )`. fov in degrees. Change fov/aspect/near/far then `camera.updateProjectionMatrix()`. Cap devicePixelRatio scaling with a max-pixel-count limit to protect the GPU rather than calling `setPixelRatio` blindly. (https://threejs.org/manual/en/responsive.html)
