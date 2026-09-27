/**
 * Cavity shading: darkens folds, grooves and creases, per vertex, from the mesh alone.
 *
 * Much of what makes an organ read as real rather than as a plastic cast is that its
 * crevices — brain sulci, the gaps between loops of intestine, the groove a coronary
 * artery runs in — catch less light than its surface. Proper ambient occlusion needs
 * a render pass or an offline bake; this is the cheap approximation: a vertex whose
 * neighbours sit above it along its normal is in a hollow, and is darkened in proportion
 * to how deep, measured against the local edge length so it works at any mesh density.
 *
 * Runs once per model at load, writing a `color` attribute the tissue material
 * multiplies in (vertexColors). Nothing extra is drawn per frame.
 */

import { BufferAttribute } from 'three';
import type { BufferGeometry } from 'three';

/** Darkening at full concavity, at strength 1. */
const MAX_DARKEN = 0.6;
/** Neighbour-averaging passes. Turns per-vertex speckle into soft occlusion. */
const SMOOTHING = 2;

export function cavityShade(geometry: BufferGeometry, strength: number): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const count = position.count;

  // Weld by position: meshes are often split at seams, and a crease is exactly where
  // unshared vertices sit, so adjacency must look through the split.
  const weldOf = new Int32Array(count);
  const keys = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
    let id = keys.get(key);
    if (id === undefined) keys.set(key, (id = keys.size));
    weldOf[i] = id;
  }
  const welded = keys.size;

  const point = new Float32Array(welded * 3);
  const normals = new Float32Array(welded * 3);
  for (let i = 0; i < count; i += 1) {
    const w = weldOf[i] * 3;
    point[w] = position.getX(i);
    point[w + 1] = position.getY(i);
    point[w + 2] = position.getZ(i);
    if (normal) {
      normals[w] += normal.getX(i);
      normals[w + 1] += normal.getY(i);
      normals[w + 2] += normal.getZ(i);
    }
  }

  // Neighbour sums from the triangle edges.
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : count / 3;
  const corner = (t: number, k: number) => weldOf[index ? index.getX(t * 3 + k) : t * 3 + k];
  const sum = new Float32Array(welded * 3);
  const degree = new Float32Array(welded);
  const edge = new Float32Array(welded);
  const neighbours: number[][] = Array.from({ length: welded }, () => []);
  for (let t = 0; t < triangles; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = corner(t, k);
      const b = corner(t, (k + 1) % 3);
      if (a === b) continue;
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        sum[from * 3] += point[to * 3];
        sum[from * 3 + 1] += point[to * 3 + 1];
        sum[from * 3 + 2] += point[to * 3 + 2];
        degree[from] += 1;
        edge[from] += Math.hypot(
          point[to * 3] - point[from * 3],
          point[to * 3 + 1] - point[from * 3 + 1],
          point[to * 3 + 2] - point[from * 3 + 2],
        );
        neighbours[from].push(to);
      }
    }
  }

  // Concavity: how far the neighbours' centroid sits above the vertex along its normal,
  // as a fraction of the mean edge length. Positive is a hollow.
  const concavity = new Float32Array(welded);
  for (let w = 0; w < welded; w += 1) {
    if (degree[w] === 0) continue;
    const nx = normals[w * 3];
    const ny = normals[w * 3 + 1];
    const nz = normals[w * 3 + 2];
    const length = Math.hypot(nx, ny, nz) || 1;
    const dx = sum[w * 3] / degree[w] - point[w * 3];
    const dy = sum[w * 3 + 1] / degree[w] - point[w * 3 + 1];
    const dz = sum[w * 3 + 2] / degree[w] - point[w * 3 + 2];
    const along = (dx * nx + dy * ny + dz * nz) / length;
    concavity[w] = along / (edge[w] / degree[w]);
  }

  // Smooth, but only ever darken vertices that are themselves in a hollow: the rim of a
  // pit is concave, and averaging it into the crest of a neighbouring bump would put
  // shadow on the one place light hits hardest.
  let smoothed = Float32Array.from(concavity, (c) => Math.max(c, 0));
  for (let pass = 0; pass < SMOOTHING; pass += 1) {
    const next = new Float32Array(welded);
    for (let w = 0; w < welded; w += 1) {
      let total = smoothed[w];
      for (const n of neighbours[w]) total += smoothed[n];
      next[w] = total / (neighbours[w].length + 1);
    }
    smoothed = next;
  }

  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const w = weldOf[i];
    const depth = concavity[w] > 0 ? Math.min(smoothed[w], 1) : 0;
    const shade = 1 - strength * MAX_DARKEN * depth;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}
