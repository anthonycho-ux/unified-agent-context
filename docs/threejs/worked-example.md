# Three.js Worked Example: Verified Hello Cube + Path to a Custom Build (r185)

> Provenance: authored by Sol (Aside) 2026-08-29 23:52 MDT. The starter code below is reproduced verbatim from the official threejs.org manual page to create a scene (https://threejs.org/manual/en/creating-a-scene.html), which is the r185-corrected pattern using `renderer.setAnimationLoop`.

## The verified hello cube

index.html:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My first three.js app</title>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <script type="module" src="/main.js"></script>
  </body>
</html>
```

main.js:

```js
import * as THREE from 'three';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );

const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
const cube = new THREE.Mesh( geometry, material );
scene.add( cube );

camera.position.z = 5;

function animate( time ) {
  cube.rotation.x = time / 2000;
  cube.rotation.y = time / 1000;
  renderer.render( scene, camera );
}
```

Notes specific to r185: the loop uses setAnimationLoop; the animate callback receives elapsed milliseconds; MeshBasicMaterial needs no lights (it is unlit); body margin 0 gives a fullscreen canvas.

## From hello cube to a real project (Gargantua-flavored pattern)

The hello cube proves the pipeline. A custom build such as the black-hole simulation deviates along four axes, each covered elsewhere in this knowledge base:

1. Geometry and materials become custom. Replace BoxGeometry with procedural geometry built from BufferGeometry, or a ShaderMaterial for per-pixel effects like an accretion-disk gradient or lensing distortion. See api-cheatsheet geometry and shaders files.
2. Lights become physical. If you switch to StandardMaterial or PhysicalMaterial, you need lights and correct physical intensities, and emissive materials for self-lit surfaces. See api-cheatsheet lights.
3. Loading becomes async. Any model or texture asset needs a loader or LoadingManager and an onLoad gate before you script it. See api-cheatsheet loaders and patterns-pitfalls.
4. Interaction and performance climb. Clicks route through a cached Raycaster; rolling cameras through OrbitControls or a custom rig; thousands of particles or star points via InstancedMesh or a custom particle shader. See api-cheatsheet raycasting and performance.

The recommended build order for an agent extending an existing three.js project: read index, confirm the project pinned three version (the version decides whether colorSpace, physical lights, and setAnimationLoop rules apply), then apply the cheatsheet sections for the parts you touch. If the project is older than r155-era, re-check every snippet against the current Migration Guide before assuming it still holds.
