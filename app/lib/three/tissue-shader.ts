/**
 * Shader additions that make a MeshPhysicalMaterial read as living tissue.
 *
 * The atlas meshes have no texture coordinates, so surface character can't come from
 * painted maps. Instead it is generated from 3D simplex noise sampled at each fragment's
 * world position — which needs no UVs, never stretches or seams, and stays put on the
 * surface as the camera orbits. Four things are layered in:
 *
 *  - mottling: the base colour varies by a few percent, as real tissue does;
 *  - bumps: the same noise perturbs the shading normal (the clearcoat keeps the
 *    unperturbed one, so a smooth wet film sits over a textured surface);
 *  - flesh: a warm rim where the surface turns away from the eye — a cheap stand-in for
 *    light scattering through tissue and back out at the silhouette;
 *  - cut face: inside faces seen through the cross-section are painted flat, so an
 *    opened organ reads as solid rather than hollow.
 *
 * Everything is driven by uniforms, so every tissue material compiles to one program.
 */

import type { Color } from 'three';

import type { Detail } from '../tissue.ts';

export type TissueUniforms = {
  tissueScale: { value: number };
  tissueBump: { value: number };
  tissueMottle: { value: number };
  tissueFlesh: { value: number };
  fleshColor: { value: Color };
  cutColor: { value: Color };
  cutEnabled: { value: number };
};

export function tissueUniforms(detail: Detail, flesh: Color, cut: Color | null): TissueUniforms {
  return {
    tissueScale: { value: detail.scale },
    tissueBump: { value: detail.bump },
    tissueMottle: { value: detail.mottle },
    tissueFlesh: { value: detail.flesh },
    fleshColor: { value: flesh },
    cutColor: { value: cut ?? flesh },
    cutEnabled: { value: cut ? 1 : 0 },
  };
}

// Ashima Arts / Stefan Gustavson 3D simplex noise (MIT), plus a three-octave sum.
const NOISE = /* glsl */ `
vec3 tissueMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 tissueMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 tissuePermute(vec4 x) { return tissueMod289(((x * 34.0) + 10.0) * x); }
vec4 tissueTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float tissueSimplex(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = tissueMod289(i);
  vec4 p = tissuePermute(tissuePermute(tissuePermute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
    i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
    i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = tissueTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Roughly -1..1.
float tissueNoise(vec3 p) {
  return 0.57 * tissueSimplex(p) + 0.29 * tissueSimplex(p * 2.03) + 0.14 * tissueSimplex(p * 4.01);
}
`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vTissuePos;
uniform float tissueScale;
uniform float tissueBump;
uniform float tissueMottle;
uniform float tissueFlesh;
uniform vec3 fleshColor;
uniform vec3 cutColor;
uniform float cutEnabled;
${NOISE}
`;

// three's perturbNormalArb, which is only compiled in when a bump map is present.
const PERTURB = /* glsl */ `
vec3 tissuePerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sigmaX = normalize(dFdx(surfPos));
  vec3 sigmaY = normalize(dFdy(surfPos));
  vec3 r1 = cross(sigmaY, surfNorm);
  vec3 r2 = cross(surfNorm, sigmaX);
  float det = dot(sigmaX, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

export function injectTissueShader(
  shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string },
  uniforms: TissueUniforms,
): void {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = `varying vec3 vTissuePos;\n${shader.vertexShader}`.replace(
    '#include <project_vertex>',
    '#include <project_vertex>\nvTissuePos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
  );

  shader.fragmentShader = `${FRAGMENT_HEAD}\n${PERTURB}\n${shader.fragmentShader}`
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb *= 1.0 + tissueMottle * tissueNoise(vTissuePos * tissueScale);`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        vec3 tissueBumpPos = vTissuePos * tissueScale * 2.3;
        float tissueHeight = tissueNoise(tissueBumpPos);
        // Fade bumps out as they shrink toward a pixel: below that they only alias into
        // speckle, which reads as sandpaper rather than tissue.
        float tissueDetailAA = clamp(1.5 - length(fwidth(tissueBumpPos)) * 2.0, 0.0, 1.0);
        vec2 tissueSlope = vec2(dFdx(tissueHeight), dFdy(tissueHeight)) * tissueBump * tissueDetailAA;
        normal = tissuePerturb(-vViewPosition, normal, tissueSlope, faceDirection);
      }`,
    )
    .replace(
      '#include <tonemapping_fragment>',
      `{
        float tissueRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        gl_FragColor.rgb += fleshColor * tissueFlesh * tissueRim * tissueRim * tissueRim;
      }
      if (cutEnabled > 0.5 && !gl_FrontFacing) gl_FragColor.rgb = cutColor;
      #include <tonemapping_fragment>`,
    );
}
