/**
 * Wraps a cloud of points in a smooth closed surface.
 *
 * BodyParts3D has no lung surface: every lung and lobe concept is only its airway and
 * vessel trees. This builds an approximate lobe surface around those trees — each point
 * splats a soft kernel into a voxel field, and marching cubes extracts the level set.
 * Where branches are closer together than about twice `radius` the kernels merge into
 * one sheet, which is what makes a lobe's worth of branches read as a lobe.
 *
 * The result is an approximation derived from the atlas, not atlas geometry, and the
 * UI says so.
 */

import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';

/**
 * `blur` box-blurs the field that many cells wide, twice, before extraction: without
 * it the sheet shrink-wraps each branch and reads as a bundle of sausages, not a lobe.
 *
 * @param {number[]} points flat [x0, y0, z0, x1, ...] in atlas millimetres
 * @param {{ radius: number, resolution?: number, isolation?: number, blur?: number }} options
 * @returns {{ positions: Float32Array, normals: Float32Array }} non-indexed triangles
 */
export function envelope(points, { radius, resolution = 64, isolation = 0.6, blur = 0 }) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], points[i + axis]);
      max[axis] = Math.max(max[axis], points[i + axis]);
    }
  }
  const centre = min.map((lo, axis) => (lo + max[axis]) / 2);
  // A cube, so voxels stay isotropic; padded so the kernel never touches the border,
  // where marching cubes would leave the surface open.
  // Three radii of margin a side also covers the blur's spread at these resolutions.
  const side = Math.max(...max.map((hi, axis) => hi - min[axis])) + radius * 6;

  const mc = new MarchingCubes(resolution, undefined, false, false, 400_000);
  mc.isolation = isolation;
  const size = resolution;
  const cell = side / size;
  const reach = Math.ceil(radius / cell);
  const toIndex = (value, axis) => ((value - centre[axis]) / side) * size + size / 2;

  for (let i = 0; i < points.length; i += 3) {
    const gx = toIndex(points[i], 0);
    const gy = toIndex(points[i + 1], 1);
    const gz = toIndex(points[i + 2], 2);
    const cx = Math.round(gx);
    const cy = Math.round(gy);
    const cz = Math.round(gz);
    for (let z = cz - reach; z <= cz + reach; z += 1) {
      for (let y = cy - reach; y <= cy + reach; y += 1) {
        for (let x = cx - reach; x <= cx + reach; x += 1) {
          const d2 = ((x - gx) ** 2 + (y - gy) ** 2 + (z - gz) ** 2) * cell * cell;
          if (d2 >= radius * radius) continue;
          const k = 1 - d2 / (radius * radius);
          mc.field[x + y * size + z * size * size] += k * k;
        }
      }
    }
  }

  for (let pass = 0; pass < (blur > 0 ? 2 : 0); pass += 1) {
    for (let axis = 0; axis < 3; axis += 1) boxBlur(mc.field, size, axis, blur);
  }

  mc.update();

  const count = mc.count;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 1) {
    const axis = i % 3;
    // Marching cubes emits -1..1 across the cube.
    positions[i] = centre[axis] + (mc.positionArray[i] * side) / 2;
    normals[i] = mc.normalArray[i];
  }
  mc.geometry.dispose();
  return largestSheet({ positions, normals });
}

/**
 * Keeps only the connected sheet with the most triangles. A lobe's trees can include a
 * detached fragment (a vessel stub well below the lung); wrapping it produces a free-
 * floating bubble that reads as a separate organ.
 */
function largestSheet({ positions, normals }) {
  const triangles = positions.length / 9;
  if (triangles === 0) return { positions, normals };

  // Marching cubes emits unshared vertices; weld by position to find adjacency.
  const ids = new Map();
  const vertexId = (i) => {
    const key = `${positions[i].toFixed(4)},${positions[i + 1].toFixed(4)},${positions[i + 2].toFixed(4)}`;
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const corners = new Int32Array(triangles * 3);
  for (let t = 0; t < triangles * 3; t += 1) corners[t] = vertexId(t * 3);

  const parent = Array.from({ length: ids.size }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let t = 0; t < triangles; t += 1) {
    parent[find(corners[t * 3 + 1])] = find(corners[t * 3]);
    parent[find(corners[t * 3 + 2])] = find(corners[t * 3]);
  }

  const sizes = new Map();
  for (let t = 0; t < triangles; t += 1) {
    const root = find(corners[t * 3]);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const [keep] = [...sizes].reduce((best, entry) => (entry[1] > best[1] ? entry : best));

  const kept = [];
  for (let t = 0; t < triangles; t += 1) if (find(corners[t * 3]) === keep) kept.push(t);
  const outPositions = new Float32Array(kept.length * 9);
  const outNormals = new Float32Array(kept.length * 9);
  kept.forEach((t, k) => {
    outPositions.set(positions.subarray(t * 9, t * 9 + 9), k * 9);
    outNormals.set(normals.subarray(t * 9, t * 9 + 9), k * 9);
  });
  return { positions: outPositions, normals: outNormals };
}

/** In-place running-sum box blur of a cubic field along one axis. */
function boxBlur(field, size, axis, width) {
  const stride = axis === 0 ? 1 : axis === 1 ? size : size * size;
  const line = new Float32Array(size);
  const span = width * 2 + 1;
  for (let a = 0; a < size; a += 1) {
    for (let b = 0; b < size; b += 1) {
      // The two axes that aren't being blurred pick out one line of the field.
      const base =
        axis === 0 ? a * size + b * size * size : axis === 1 ? a + b * size * size : a + b * size;
      for (let i = 0; i < size; i += 1) line[i] = field[base + i * stride];
      let sum = 0;
      for (let i = -width; i <= width; i += 1) sum += line[Math.min(Math.max(i, 0), size - 1)];
      for (let i = 0; i < size; i += 1) {
        field[base + i * stride] = sum / span;
        sum += line[Math.min(i + width + 1, size - 1)] - line[Math.max(i - width, 0)];
      }
    }
  }
}

/** Serialises non-indexed triangles as OBJ text, with per-vertex normals. */
export function trianglesToObj({ positions, normals }) {
  const lines = [];
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
  }
  for (let i = 0; i < normals.length; i += 3) {
    lines.push(`vn ${normals[i]} ${normals[i + 1]} ${normals[i + 2]}`);
  }
  for (let v = 1; v <= positions.length / 3; v += 3) {
    lines.push(`f ${v}//${v} ${v + 1}//${v + 1} ${v + 2}//${v + 2}`);
  }
  return lines.join('\n');
}
