# Three.js Custom Shaders (r185)

> Provenance: authored by Sol (Aside) 2026-08-29 23:52 MDT. Verified against the threejs.org ShaderMaterial, RawShaderMaterial, and color-management pages on this date.

## ShaderMaterial vs RawShaderMaterial: the one difference that matters

- `THREE.ShaderMaterial` still gets three.js built-in attributes, uniforms, and preludes injected into your GLSL source. It composes your shader from a preamble plus named chunks. Use it for custom materials that want three.js lighting, attributes, and matrices without writing boilerplate.
- `THREE.RawShaderMaterial` gives you none of that. You must declare the full vertex pipeline yourself, including the position attribute and `gl_Position`. Use it only when you want zero three.js injection.

The wrong choice between these two is the most common agent mistake in the shader area.

## ShaderMaterial contract

```js
const material = new THREE.ShaderMaterial({
  uniforms: {
    time: { value: 1.0 },
    color: { value: new THREE.Color() },
    uTexture: { value: texture },
  },
  vertexShader: ` // GLSL string
    void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: ` // GLSL string
    void main() { gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 ); }
  `,
});
```

- The uniforms contract is `{ name: { value: ... } }`. Uniforms refresh every frame, so mutating `material.uniforms.time.value` takes effect immediately; no needsUpdate.
- `glslVersion` selects GLSL1 vs GLSL3 output.
- `defines` emits `#define` lines into your source.
- `lights: true` passes the lighting uniforms. Fog needs `UniformsLib.fog` merged in via `UniformsUtils.merge`.
- The `#include <chunk>` macro composes named shader chunks into your GLSL. The chunk system is part of the contract; some agents reference it as part of three.js compilation.

## The color-space conversion contract

three.js renders custom materials in a linear working space and expects your fragment output to convert to the output color space. Verified guidance from the official color-management page: a ShaderMaterial must include its own linear to sRGB conversion at the end of the fragment shader. For ShaderMaterial, adding the `colorspace_fragment` shader chunk inside `main()` is sufficient. If you skip it, colors render visibly wrong (washed out or dark) even though nothing else is broken.

Related: color textures sampled in a custom shader must be declared with `.colorSpace = THREE.SRGBColorSpace` so the data is decoded correctly, matching the rule for the built-in materials in the cheatsheet.

## GLSL essentials agents need

- Vertex stage jobs: read attributes, transform to clip space with `projectionMatrix * modelViewMatrix * vec4( position, 1.0 )`. These three uniforms are injected by ShaderMaterial.
- Fragment stage jobs: compute the final color. `gl_FragColor` for GLSL1, explicit `out` for GLSL3.
- Uniforms are your per-frame inputs (time, color, texture, raycaster-driven values). Varyings pass data from vertex to fragment.
- Whatever you sample from a color texture arrived gamma-encoded; decode and re-encode around the linear lighting math, which is exactly what the color-management rule above encodes.

## When to reach for it

Use raw shaders for effects the built-in materials cannot express: procedural disks, accretion-disk gradients, gravitational-lensing-style distortion, custom particle fields, or any per-pixel math. Beware that full custom materials forfeit the lighting, shadows, fog, and tone-mapping handling of StandardMaterial; you re-implement what you need. For texture-based PBR-like work, MeshStandardMaterial plus a few custom textures usually wins over hand-written GLSL.
