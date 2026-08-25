// ============================================================
//  Мир: террейн, небо, вода, залежи массы, декор
// ============================================================
import * as THREE from '../libs/three.module.js';
import { MAP_SIZE, HALF_MAP, SPAWNS } from './config.js';
import { G } from './state.js';
import { clamp, lerp, smoothstep, fbm, mulberry32 } from './util.js';

const MASS_SPOTS = [
  [-160, 160], [-252, 142], [-142, 252], [-88, 88],
  [160, -160], [252, -142], [142, -252], [88, -88],
  [0, 0], [-95, 0], [95, 0], [0, -95], [0, 95], [128, 128], [-128, -128],
];

export function heightRaw(x, z) {
  let h = (fbm(x * 0.0062 + 3.7, z * 0.0062 + 9.1, 4) - 0.5) * 26 + 3.2;
  h += (fbm(x * 0.028 + 17, z * 0.028 + 31, 2) - 0.5) * 2.6;
  if (h < 0) h *= 0.32; // мелкие низины
  const r = Math.max(Math.abs(x), Math.abs(z)) / HALF_MAP;
  if (r > 0.78) { const t = (r - 0.78) / 0.22; h -= t * t * 40; } // остров
  return h;
}

function height(x, z) {
  let h = heightRaw(x, z);
  for (const s of SPAWNS) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < 115) h = lerp(2.2, h, smoothstep(55, 115, d));
  }
  for (const p of G.massPoints) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < 13) h = lerp(p.h, h, smoothstep(6.5, 13, d));
  }
  return h;
}

export function initWorld(scene) {
  G.massPoints = MASS_SPOTS.map(([x, z]) => ({ x, z, h: heightRaw(x, z), building: null, mesh: null, phase: Math.random() * 10 }));
  G.heightAt = height;

  // ---------- террейн ----------
  const seg = 128;
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);

    const n = fbm(x * 0.045 + 5, z * 0.045 + 8, 2);
    const slope = Math.abs(height(x + 4, z) - h) + Math.abs(height(x, z + 4) - h);
    if (h < -0.8) {          // дно
      c.setRGB(0.16 + n * 0.05, 0.2 + n * 0.05, 0.2);
    } else if (h < 1.1) {    // песок
      c.setRGB(0.52 + n * 0.08, 0.46 + n * 0.07, 0.34 + n * 0.05);
    } else {                 // трава
      const g1 = 0.24 + n * 0.1, g2 = 0.34 + n * 0.12;
      c.setRGB(0.2 + n * 0.06, (g1 + g2) * 0.5, 0.16 + n * 0.05);
    }
    if (slope > 2.4) {       // скалы на склонах
      const t = clamp((slope - 2.4) / 3, 0, 1);
      c.lerp(new THREE.Color(0.36, 0.36, 0.4), t * 0.8);
    }
    if (h > 15) {            // светлые вершины
      c.lerp(new THREE.Color(0.55, 0.58, 0.6), clamp((h - 15) / 10, 0, 0.7));
    }
    const j = (fbm(x * 0.35, z * 0.35, 1) - 0.5) * 0.07;
    col[i * 3] = clamp(c.r + j, 0, 1);
    col[i * 3 + 1] = clamp(c.g + j, 0, 1);
    col[i * 3 + 2] = clamp(c.b + j, 0, 1);
  }
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- вода ----------
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1900, 1900).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x14384c, transparent: true, opacity: 0.9 })
  );
  water.position.y = -1.6;
  scene.add(water);
  G.water = water;

  // ---------- небесный купол ----------
  const skyGeo = new THREE.SphereGeometry(1500, 24, 15);
  {
    const sp = skyGeo.attributes.position;
    const sc = new Float32Array(sp.count * 3);
    const top = new THREE.Color(0x060b13), mid = new THREE.Color(0x14222e), bot = new THREE.Color(0x2c4a55);
    const tc = new THREE.Color();
    for (let i = 0; i < sp.count; i++) {
      const y = sp.getY(i) / 1500; // -1..1
      if (y > 0) tc.copy(mid).lerp(top, clamp(y * 1.6, 0, 1));
      else tc.copy(mid).lerp(bot, clamp(-y * 3, 0, 1));
      sc[i * 3] = tc.r; sc[i * 3 + 1] = tc.g; sc[i * 3 + 2] = tc.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  }
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);

  // ---------- залежи массы ----------
  const crystalGeo = new THREE.OctahedronGeometry(0.95);
  const crystalMat = new THREE.MeshBasicMaterial({ color: 0x6dff9d });
  const rockGeo = new THREE.CylinderGeometry(1.1, 1.5, 0.5, 7);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x4a4f56 });
  for (const p of G.massPoints) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.y = 0.2;
    rock.castShadow = true;
    const cr = new THREE.Mesh(crystalGeo, crystalMat);
    cr.position.y = 1.7;
    g.add(rock, cr);
    g.position.set(p.x, p.h, p.z);
    scene.add(g);
    p.mesh = cr;
    p.group = g;
  }

  // ---------- декор: деревья и камни ----------
  const rng = mulberry32(9042);
  const treePos = [], treeScl = [], treeCol = [];
  const rockPos = [], rockScl = [], rockCol = [];
  let tries = 0;
  while (treePos.length < 620 && tries < 9000) {
    tries++;
    const x = (rng() * 2 - 1) * 300, z = (rng() * 2 - 1) * 300;
    const h = height(x, z);
    if (h < 1.4 || h > 14) continue;
    let bad = false;
    for (const s of SPAWNS) if (Math.hypot(x - s.x, z - s.z) < 80) { bad = true; break; }
    if (bad) continue;
    for (const p of G.massPoints) if (Math.hypot(x - p.x, z - p.z) < 12) { bad = true; break; }
    if (bad) continue;
    treePos.push([x, h, z]);
    treeScl.push(0.7 + rng() * 0.9);
    const t = rng();
    treeCol.push(new THREE.Color().setRGB(0.13 + t * 0.1, 0.3 + t * 0.12, 0.12 + t * 0.05));
  }
  tries = 0;
  while (rockPos.length < 150 && tries < 4000) {
    tries++;
    const x = (rng() * 2 - 1) * 305, z = (rng() * 2 - 1) * 305;
    const h = height(x, z);
    if (h < -1) continue;
    rockPos.push([x, h, z]);
    rockScl.push(0.5 + rng() * 1.8);
    const t = 0.32 + rng() * 0.18;
    rockCol.push(new THREE.Color().setRGB(t, t * 1.02, t * 1.08));
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3();
  const place = (inst, list, scl, cols, yOff) => {
    for (let i = 0; i < list.length; i++) {
      const [x, h, z] = list[i];
      const s = scl[i];
      e.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(e);
      m4.compose(v.set(x, h + yOff * s, z), q, sv.set(s, s, s));
      inst.setMatrixAt(i, m4);
      if (cols) inst.setColorAt(i, cols[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.count = list.length;
  };

  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.22, 1.6, 5), new THREE.MeshLambertMaterial({ color: 0x5a4630 }), treePos.length);
  const canopy = new THREE.InstancedMesh(new THREE.ConeGeometry(1.35, 3.6, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }), treePos.length);
  trunk.castShadow = canopy.castShadow = true;
  place(trunk, treePos, treeScl, null, 0.8);
  place(canopy, treePos, treeScl, treeCol, 2.9);
  scene.add(trunk, canopy);

  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.85), new THREE.MeshLambertMaterial({ color: 0xffffff }), rockPos.length);
  rocks.castShadow = true;
  place(rocks, rockPos, rockScl, rockCol, 0.25);
  scene.add(rocks);
}

export function updateWorld(dt) {
  // парящие кристаллы массы
  for (const p of G.massPoints) {
    if (p.mesh && p.mesh.visible) {
      p.phase += dt;
      p.mesh.rotation.y += dt * 0.8;
      p.mesh.position.y = 1.7 + Math.sin(p.phase * 1.4) * 0.22;
    }
  }
  if (G.water) G.water.position.y = -1.6 + Math.sin(G.time * 0.5) * 0.06;
}

// цвет для миникарты
export function terrainMiniColor(h, x, z) {
  if (h < -1.6) return [22, 46, 64];
  if (h < 1.1) return [128, 114, 86];
  const n = fbm(x * 0.045 + 5, z * 0.045 + 8, 2);
  const g = 60 + n * 40;
  if (h > 15) return [140, 146, 152];
  return [Math.floor(46 + n * 18), Math.floor(g), Math.floor(40 + n * 12)];
}
