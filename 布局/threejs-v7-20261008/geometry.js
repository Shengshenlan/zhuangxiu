import * as THREE from './vendor/three.module.js';

// Project each planar polygon to its dominant plane. Ear clipping handles the
// concave living-room outline; a triangle fan would fill the bathroom recess.
export function triangulateFace(face) {
  const n = new THREE.Vector3(...face.n).normalize();
  const drop = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].indexOf(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)));
  const axes = [0, 1, 2].filter(i => i !== drop);
  const flat = face.v.map(p => new THREE.Vector2(p[axes[0]], p[axes[1]]));
  const indices = THREE.ShapeUtils.triangulateShape(flat, []);
  const positions = [], normals = [];
  for (let tri of indices) {
    const a = new THREE.Vector3(...face.v[tri[0]]), b = new THREE.Vector3(...face.v[tri[1]]), c = new THREE.Vector3(...face.v[tri[2]]);
    if (b.sub(a).cross(c.sub(a)).dot(n) < 0) tri = [tri[0], tri[2], tri[1]];
    for (const index of tri) { positions.push(...face.v[index]); normals.push(n.x, n.y, n.z); }
  }
  return { positions, normals };
}

export function buildMeshes(faces, { room = 'all', catalog = {}, night = false } = {}) {
  const batches = new Map();
  for (const face of faces) {
    if (room !== 'all' && face.room && face.room !== room && catalog[face.objectId]?.relatedRoom !== room) continue;
    if (room !== 'all' && !face.room) continue;
    if (face.alpha === .11) continue; // real Three.js shadows replace flat SVG shadow patches
    const key = JSON.stringify([face.objectId, face.room, face.color, face.alpha ?? 1]);
    if (!batches.has(key)) batches.set(key, { face, positions: [], normals: [] });
    const batch = batches.get(key), tri = triangulateFace(face);
    batch.positions.push(...tri.positions); batch.normals.push(...tri.normals);
  }
  const group = new THREE.Group();
  for (const { face, positions, normals } of batches.values()) {
    if (!positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    const lamp = /-L\d$/.test(face.objectId || '') && face.color === '#fff1ce';
    const material = new THREE.MeshStandardMaterial({ color: face.color, roughness: .78, metalness: .02, side: THREE.DoubleSide,
      transparent: (face.alpha ?? 1) < 1, opacity: face.alpha ?? 1, depthWrite: !(face.alpha < 1),
      emissive: lamp ? '#ffe6b3' : '#000000', emissiveIntensity: lamp ? (night ? 1.1 : .28) : 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { objectId: face.objectId, room: face.room };
    mesh.castShadow = !(face.alpha < 1); mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export function disposeGroup(group) {
  group.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
  group.clear();
}
