// ============================================================
//  Сущности: юниты и здания, меши, приказы, бой
// ============================================================
import * as THREE from '../libs/three.module.js';
import { DEFS, TEAM_STYLE, UNIT_BOUND, UNIT_CAP } from './config.js';
import { G } from './state.js';
import { clamp, lerp, angleLerp, formationOffsets } from './util.js';

// ------------------------------------------------------------
//  Сборка мешей: части геометрии сливаются в один mesh с vertex colors
// ------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
      _v = new THREE.Vector3(), _s = new THREE.Vector3();

function tf(x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1));
  return _m.clone();
}

function mergeParts(parts) {
  let total = 0;
  const prep = parts.map(p => {
    let g = p.geo;
    if (g.index) g = g.toNonIndexed();
    if (p.m) g.applyMatrix4(p.m);
    total += g.attributes.position.count;
    return { g, c: new THREE.Color(p.color) };
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const { g, c } of prep) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    const n = g.attributes.position.count;
    for (let i = 0; i < n; i++) {
      const j = (off + i) * 3;
      col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
    }
    off += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

const B   = (w, h, d, c, x, y, z, rx = 0, ry = 0, rz = 0) => ({ geo: new THREE.BoxGeometry(w, h, d), color: c, m: tf(x, y, z, rx, ry, rz) });
const CYL = (rt, rb, h, c, x, y, z, rx = 0, ry = 0, rz = 0, seg = 10) => ({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, m: tf(x, y, z, rx, ry, rz) });
const SPH = (r, c, x, y, z, seg = 8) => ({ geo: new THREE.SphereGeometry(r, seg, 6), color: c, m: tf(x, y, z) });
const OCT = (r, c, x, y, z) => ({ geo: new THREE.OctahedronGeometry(r), color: c, m: tf(x, y, z) });
const TOR = (r, t, c, x, y, z, rx = 0, seg = 16) => ({ geo: new THREE.TorusGeometry(r, t, 7, seg), color: c, m: tf(x, y, z, rx) });

const MASS_GREEN = 0x59ff85;
const ENERGY_YELLOW = 0xffd45e;

const geoCache = new Map();
function getGeos(defKey, team) {
  const key = defKey + ':' + team;
  if (geoCache.has(key)) return geoCache.get(key);
  const S = TEAM_STYLE[team];
  const hull = S.hull, hull2 = S.hull2, trim = S.trim, glow = S.glow;
  const body = [], glowP = [], turretP = [], turretG = [];
  let special = {};

  switch (defKey) {
    case 'acu': {
      body.push(
        B(0.55, 1.5, 0.75, hull2, -0.5, 0.75, 0), B(0.55, 1.5, 0.75, hull2, 0.5, 0.75, 0),
        B(0.85, 0.32, 1.15, hull, -0.5, 0.16, 0.1), B(0.85, 0.32, 1.15, hull, 0.5, 0.16, 0.1),
        B(1.55, 0.7, 1.05, hull, 0, 1.65, 0),
      );
      turretP.push(
        B(1.9, 1.45, 1.25, hull, 0, 0.7, 0),
        B(1.25, 0.9, 0.14, trim, 0, 0.75, 0.65),
        B(0.72, 0.6, 1.05, hull, -1.32, 1.2, 0), B(0.72, 0.6, 1.05, hull, 1.32, 1.2, 0),
        B(0.58, 0.52, 0.62, hull2, 0, 1.62, 0.08),
        B(0.5, 1.15, 0.55, hull2, -1.32, 0.4, 0.15),
        CYL(0.05, 0.05, 1.1, hull2, 0.45, 2.3, -0.2),
        CYL(0.17, 0.2, 2.1, hull, 1.32, 0.45, 0.9, Math.PI / 2, 0, 0),
      );
      turretG.push(
        B(0.74, 0.12, 0.6, glow, -1.32, 1.42, 0), B(0.74, 0.12, 0.6, glow, 1.32, 1.42, 0),
        B(0.42, 0.15, 0.06, glow, 0, 1.7, 0.42),
        SPH(0.2, glow, 1.32, 0.45, 1.98),
      );
      break;
    }
    case 'tank': {
      body.push(
        B(0.55, 0.55, 3.1, hull2, -0.95, 0.28, 0), B(0.55, 0.55, 3.1, hull2, 0.95, 0.28, 0),
        B(1.9, 0.55, 2.9, hull, 0, 0.65, 0),
        B(1.6, 0.42, 0.95, hull, 0, 0.82, 1.35, -0.5),
        B(1.94, 0.1, 0.5, trim, 0, 0.95, 1.0),
      );
      turretP.push(
        B(1.25, 0.5, 1.55, hull, 0, 0.22, 0),
        B(0.9, 0.26, 0.55, hull2, 0, 0.55, -0.65),
        CYL(0.09, 0.09, 1.9, hull2, 0, 0.3, 1.15, Math.PI / 2, 0, 0),
      );
      turretG.push(SPH(0.13, glow, 0, 0.3, 2.1), B(1.27, 0.07, 1.0, glow, 0, 0.5, 0.15));
      break;
    }
    case 'heavy': {
      body.push(
        B(0.75, 0.62, 3.7, hull2, -1.15, 0.31, 0), B(0.75, 0.62, 3.7, hull2, 1.15, 0.31, 0),
        B(2.3, 0.62, 3.4, hull, 0, 0.75, 0),
        B(2.0, 0.5, 1.1, hull, 0, 0.98, 1.6, -0.5),
        B(2.35, 0.12, 0.6, trim, 0, 1.1, 1.15),
        B(0.5, 0.7, 1.1, hull2, -1.35, 1.1, -0.6), B(0.5, 0.7, 1.1, hull2, 1.35, 1.1, -0.6),
      );
      turretP.push(
        B(1.7, 0.62, 1.9, hull, 0, 0.3, 0),
        B(1.15, 0.35, 0.7, hull2, 0, 0.75, -0.75),
        CYL(0.11, 0.11, 2.2, hull2, -0.28, 0.38, 1.4, Math.PI / 2, 0, 0),
        CYL(0.11, 0.11, 2.2, hull2, 0.28, 0.38, 1.4, Math.PI / 2, 0, 0),
      );
      turretG.push(SPH(0.14, glow, -0.28, 0.38, 2.5), SPH(0.14, glow, 0.28, 0.38, 2.5), B(1.72, 0.08, 1.1, glow, 0, 0.66, 0.2));
      break;
    }
    case 'arty': {
      body.push(
        B(0.5, 0.5, 2.7, hull2, -0.85, 0.25, 0), B(0.5, 0.5, 2.7, hull2, 0.85, 0.25, 0),
        B(1.7, 0.55, 2.5, hull, 0, 0.55, 0),
        CYL(0.75, 0.9, 0.5, hull2, 0, 0.95, -0.3),
        B(1.74, 0.1, 0.4, trim, 0, 0.86, 0.95),
      );
      turretP.push(
        B(1.05, 0.6, 1.35, hull, 0, 1.3, 0),
        CYL(0.1, 0.13, 3.1, hull2, 0, 1.62, 1.15, Math.PI / 2 - 0.2, 0, 0),
        B(0.7, 0.3, 0.5, hull2, 0, 1.35, -0.6),
      );
      turretG.push(SPH(0.16, glow, 0, 1.95, 2.6));
      break;
    }
    case 'extractor': {
      body.push(
        CYL(2.5, 2.8, 0.75, hull, 0, 0.37, 0, 0, 0, 0, 12),
        B(5.4, 2.2, 5.4, hull2, 0, -1.1, 0),
        B(0.6, 1.6, 0.6, hull2, 1.9, 1.0, 0), B(0.6, 1.6, 0.6, hull2, -1.9, 1.0, 0),
        B(0.6, 1.6, 0.6, hull2, 0, 1.0, 1.9), B(0.6, 1.6, 0.6, hull2, 0, 1.0, -1.9),
      );
      glowP.push(
        TOR(2.0, 0.14, MASS_GREEN, 0, 0.8, 0, Math.PI / 2),
      );
      special.spin = mergeParts([OCT(1.05, 0x7dff9d, 0, 0, 0), OCT(0.6, 0xb8ffd0, 0, 0.3, 0)]);
      break;
    }
    case 'pgen': {
      body.push(
        B(3.6, 0.8, 3.6, hull, 0, 0.4, 0),
        B(3.2, 2.4, 3.2, hull2, 0, -1.2, 0),
        B(0.5, 1.7, 0.5, hull2, 1.5, 1.5, 1.5), B(0.5, 1.7, 0.5, hull2, -1.5, 1.5, 1.5),
        B(0.5, 1.7, 0.5, hull2, 1.5, 1.5, -1.5), B(0.5, 1.7, 0.5, hull2, -1.5, 1.5, -1.5),
        B(3.1, 0.3, 3.1, hull, 0, 2.45, 0),
      );
      glowP.push(
        TOR(1.35, 0.12, glow, 0, 2.75, 0, Math.PI / 2),
        B(3.62, 0.1, 0.5, trim, 0, 0.85, 1.55), B(3.62, 0.1, 0.5, trim, 0, 0.85, -1.55),
      );
      special.pulse = mergeParts([SPH(0.85, ENERGY_YELLOW, 0, 0, 0, 10), SPH(0.5, 0xfff2c0, 0, 0.3, 0, 10)]);
      break;
    }
    case 'factory': {
      body.push(
        B(9, 0.6, 9, hull, 0, 0.3, 0),
        B(8.4, 3.0, 8.4, hull2, 0, -1.5, 0),
        B(9, 3.1, 2.7, hull, 0, 1.9, -3.1),
        B(1.7, 2.7, 6.4, hull, 3.6, 1.7, 0.6), B(1.7, 2.7, 6.4, hull, -3.6, 1.7, 0.6),
        B(9, 0.5, 1.3, hull2, 0, 3.7, -2.4),
        B(0.45, 0.45, 5.4, hull2, 0, 3.35, 0.4),
        B(2.6, 1.4, 2.0, hull2, 3.4, 0.9, 3.1), B(2.6, 1.4, 2.0, hull2, -3.4, 0.9, 3.1),
        CYL(0.42, 0.5, 4.4, hull, 4.1, 2.2, 4.1, 0, 0, 0, 8), CYL(0.42, 0.5, 4.4, hull, -4.1, 2.2, 4.1, 0, 0, 0, 8),
        CYL(0.42, 0.5, 4.4, hull, 4.1, 2.2, -4.1, 0, 0, 0, 8), CYL(0.42, 0.5, 4.4, hull, -4.1, 2.2, -4.1, 0, 0, 0, 8),
      );
      glowP.push(
        B(6.6, 0.35, 0.2, glow, 0, 1.1, 3.05),
        B(2.2, 0.2, 2.05, glow, 3.4, 1.7, 3.1), B(2.2, 0.2, 2.05, glow, -3.4, 1.7, 3.1),
      );
      special.strip = mergeParts([B(6.6, 0.36, 0.22, glow, 0, 1.1, 3.05)]);
      break;
    }
    case 'turret': {
      body.push(
        CYL(1.35, 1.6, 1.0, hull, 0, 0.5, 0, 0, 0, 0, 10),
        B(3.6, 1.8, 3.6, hull2, 0, -0.9, 0),
        TOR(1.15, 0.1, trim, 0, 1.05, 0, Math.PI / 2),
      );
      turretP.push(
        B(1.1, 0.72, 1.35, hull, 0, 0.35, 0),
        B(0.7, 0.3, 0.6, hull2, 0, 0.8, -0.3),
        CYL(0.12, 0.14, 2.3, hull2, 0, 0.42, 1.35, Math.PI / 2, 0, 0),
      );
      turretG.push(SPH(0.16, glow, 0, 0.42, 2.5), B(0.3, 0.12, 0.3, glow, 0, 0.85, 0.2));
      break;
    }
  }

  const geos = {
    body: mergeParts(body),
    glow: glowP.length ? mergeParts(glowP) : null,
    turret: turretP.length ? mergeParts(turretP) : null,
    turretGlow: turretG.length ? mergeParts(turretG) : null,
    special,
  };
  geoCache.set(key, geos);
  return geos;
}

// Общие материалы для каркаса строящихся зданий
const wireMats = [null, null];
function wireMat(team) {
  if (!wireMats[team]) wireMats[team] = new THREE.LineBasicMaterial({ color: TEAM_STYLE[team].wire, transparent: true, opacity: 0.7 });
  return wireMats[team];
}

export function buildEntityMesh(defKey, team) {
  const geos = getGeos(defKey, team);
  const group = new THREE.Group();
  const body = new THREE.Mesh(geos.body, G.matBody);
  body.castShadow = true;
  group.add(body);
  if (geos.glow) group.add(new THREE.Mesh(geos.glow, G.matGlow));

  let turret = null;
  if (geos.turret) {
    turret = new THREE.Group();
    const tb = new THREE.Mesh(geos.turret, G.matBody);
    tb.castShadow = true;
    turret.add(tb);
    if (geos.turretGlow) turret.add(new THREE.Mesh(geos.turretGlow, G.matGlow));
    group.add(turret);
  }

  let spin = null, pulse = null, strip = null;
  if (geos.special.spin) {
    spin = new THREE.Mesh(geos.special.spin, G.matGlow);
    spin.position.y = 2.2;
    group.add(spin);
  }
  if (geos.special.pulse) {
    pulse = new THREE.Mesh(geos.special.pulse, G.matGlow);
    pulse.position.y = 3.4;
    group.add(pulse);
  }
  if (geos.special.strip) {
    strip = new THREE.Mesh(geos.special.strip, G.matGlow);
    group.add(strip);
  }
  return { group, turret, spin, pulse, strip };
}

// ------------------------------------------------------------
//  Классы сущностей
// ------------------------------------------------------------
let NEXT_ID = 1;

export class Entity {
  constructor(defKey, team, x, z) {
    this.id = NEXT_ID++;
    this.defKey = defKey;
    this.def = DEFS[defKey];
    this.team = team;
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = 0;
    this.hp = this.def.hp;
    this.dead = false;
    this.swept = false;
    this.selected = false;
    this.lastHitT = -99;
    this.lastAttacker = null;
    this.combatTarget = null;
    this.cooldown = Math.random() * 0.4;
    this.acquireT = Math.random() * 0.5;
    this.turretYaw = 0;
    this.recoil = 0;
    this._vis = true;
    this._explored = true;
    this._sx = -9999; this._sy = -9999; this._onscreen = false; this._pr = 12;
  }
  get radius() {
    return this.def.kind === 'building' ? this.def.size.w * 0.56 : this.def.radius;
  }
  distTo(o) { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); }
}

export class Building extends Entity {
  constructor(defKey, team, x, z) {
    super(defKey, team, x, z);
    this.progress = 0;
    this.hp = Math.max(1, this.def.hp * 0.12);
    this.queue = [];
    this.progressUnit = 0;
    this.rally = null;
    this.massPoint = null;
    this.y = G.heightAt(x, z);
    this.pos.y = this.y;

    const m = buildEntityMesh(defKey, team);
    this.mesh = m.group; this.turret = m.turret;
    this.spin = m.spin; this.pulse = m.pulse; this.strip = m.strip;
    this.mesh.position.copy(this.pos);
    if (team === 1) this.mesh.rotation.y = Math.PI;
    this.meshYaw = team === 1 ? Math.PI : 0;
    this.wire = null;
    G.scene.add(this.mesh);
    this.updateBuildVisual();
  }

  updateBuildVisual() {
    const p = this.progress;
    this.mesh.scale.set(1, 0.1 + 0.9 * p, 1);
    if (p < 1 && !this.wire) {
      const d = this.def;
      const g = new THREE.BoxGeometry(d.size.w + 0.4, d.height, d.size.d + 0.4);
      this.wire = new THREE.LineSegments(new THREE.EdgesGeometry(g), wireMat(this.team));
      this.wire.position.y = d.height / 2;
      this.mesh.add(this.wire);
    }
    if (p >= 1 && this.wire) {
      this.mesh.remove(this.wire);
      this.wire.geometry.dispose();
      this.wire = null;
    }
    this.hp = Math.max(this.hp, this.def.hp * (0.12 + 0.88 * p));
  }

  onComplete() {
    this.progress = 1;
    this.hp = this.def.hp;
    this.updateBuildVisual();
    if (this.massPoint && this.massPoint.mesh) this.massPoint.mesh.visible = false;
    if (this.team === 0) {
      G.sound?.done();
      G.ui?.toast(`${this.def.name} — построено`, 'ok');
    }
  }
}

export class Unit extends Entity {
  constructor(defKey, team, x, z) {
    super(defKey, team, x, z);
    this.orders = [];
    this.vel = new THREE.Vector3();
    this.prevPos = this.pos.clone();
    this.recoil = 0;
    this.walkPhase = Math.random() * 10;
    this.moving = false;
    this.pos.y = G.heightAt(x, z);

    const m = buildEntityMesh(defKey, team);
    this.mesh = m.group; this.turret = m.turret;
    this.mesh.position.copy(this.pos);
    G.scene.add(this.mesh);
    if (!this.def.acu) G.teams[team].unitCount++;
  }
}

// ------------------------------------------------------------
//  Создание / уничтожение
// ------------------------------------------------------------
export function nearestFreeMassPoint(x, z, maxD = 9) {
  let best = null, bd = maxD * maxD;
  for (const p of G.massPoints) {
    if (p.building) continue;
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function createBuilding(defKey, team, x, z) {
  const def = DEFS[defKey];
  let point = null;
  if (def.onMass) {
    point = nearestFreeMassPoint(x, z, 10);
    if (!point) return null;
    x = point.x; z = point.z;
  }
  const b = new Building(defKey, team, x, z);
  if (point) { b.massPoint = point; point.building = b; }
  G.buildings.push(b);
  G.entities.push(b);
  return b;
}

export function spawnUnit(defKey, team, x, z) {
  const def = DEFS[defKey];
  if (!def.acu && G.teams[team].unitCount >= UNIT_CAP) return null;
  const u = new Unit(defKey, team, x, z);
  G.units.push(u);
  G.entities.push(u);
  return u;
}

export function damageEntity(e, dmg, attacker) {
  if (!e || e.dead || dmg <= 0) return;
  e.hp -= dmg;
  e.lastHitT = G.time;
  if (attacker) e.lastAttacker = attacker;
  if (e.team === 0) {
    G.ui?.ping(e.pos.x, e.pos.z, '#ff5040');
    G.sound?.alert();
  }
  if (e.hp <= 0) killEntity(e, attacker);
}

export function killEntity(e, attacker) {
  if (e.dead) return;
  e.dead = true;
  G.stats[e.team].lost++;
  if (attacker && attacker.team !== undefined && !attacker.dead) G.stats[attacker.team].kills++;

  const power = e.def.kind === 'building' ? 1 + e.def.size.w * 0.14 : (e.def.acu ? 6 : 0.9);
  G.combat?.explosion(e.pos.x, e.pos.y + 1.4, e.pos.z, power);
  G.sound?.explosion(power, e.pos.x, e.pos.z);

  if (e.massPoint) {
    e.massPoint.building = null;
    if (e.massPoint.mesh) e.massPoint.mesh.visible = true;
  }
  if (e.def.kind === 'unit' && !e.def.acu) G.teams[e.team].unitCount--;
  if (e.team === 0 && e.def.kind === 'building') G.ui?.toast(`${e.def.name} — уничтожено`, 'err');

  if (e.def.acu) {
    G.combat?.nuke(e.pos.x, e.pos.y, e.pos.z);
    G.shake = 1.5;
    G.sound?.nuke();
    // ядерный взрыв ACU
    for (const o of G.entities) {
      if (o.dead || o === e) continue;
      const d = e.distTo(o);
      if (d < 60) damageEntity(o, 1100 * (1 - d / 70) + 150, e);
    }
    G.ui?.toast(e.team === 0 ? 'ВАШ КОМАНДИР ПОГИБ!' : 'Командир противника уничтожен!', e.team === 0 ? 'err' : 'ok');
  }
}

export function sweepDead() {
  if (!G.entities.some(e => e.dead && !e.swept)) return;
  for (const e of G.entities) {
    if (e.dead && !e.swept) {
      e.swept = true;
      if (e.mesh) G.scene.remove(e.mesh);
    }
  }
  G.units = G.units.filter(u => !u.dead);
  G.buildings = G.buildings.filter(b => !b.dead);
  G.entities = G.entities.filter(x => !x.dead);
  const sel = G.selection.filter(s => !s.dead);
  if (sel.length !== G.selection.length) {
    for (const s of G.selection) s.selected = false;
    for (const s of sel) s.selected = true;
    G.selection = sel;
    if (G.ui) G.ui.selDirty = true;
  }
}

// ------------------------------------------------------------
//  Видимость и цели
// ------------------------------------------------------------
export function targetable(e, team) {
  if (e.team === team || e.dead) return false;
  if (!G.fog) return true;
  return G.fog.isVisible(team, e.pos.x, e.pos.z);
}

export function acquireTarget(e, range) {
  let best = null, bestScore = 1e9;
  for (const o of G.entities) {
    if (!targetable(o, e.team)) continue;
    const d = e.distTo(o);
    if (d > range) continue;
    const score = d * (o.def.kind === 'unit' ? 1 : 1.7);
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

export function updateEntityVisibility() {
  for (const e of G.entities) {
    if (e.team === 1) {
      const vis = G.fog ? G.fog.isVisible(0, e.pos.x, e.pos.z) : true;
      const explored = G.fog ? (e.def.kind === 'building' && G.fog.isExplored(0, e.pos.x, e.pos.z)) : true;
      e._vis = vis;
      e._explored = explored;
      if (e.mesh) e.mesh.visible = vis || explored;
    } else {
      e._vis = true;
      e._explored = true;
    }
  }
}

// ------------------------------------------------------------
//  Размещение зданий
// ------------------------------------------------------------
export function canPlace(defKey, x, z, team) {
  const def = DEFS[defKey];
  if (!def || def.kind !== 'building') return { ok: false, reason: 'Это не здание' };
  let snap = null;
  if (def.onMass) {
    snap = nearestFreeMassPoint(x, z, 10);
    if (!snap) return { ok: false, reason: 'Экстрактор строится только на свободных залежах массы' };
    x = snap.x; z = snap.z;
  } else {
    const hw = def.size.w / 2;
    if (Math.abs(x) + hw > 296 || Math.abs(z) + hw > 296) return { ok: false, reason: 'Слишком близко к краю карты' };
    for (const p of G.massPoints) {
      if (Math.hypot(x - p.x, z - p.z) < 8) return { ok: false, reason: 'Нельзя перекрывать залежи массы' };
    }
  }
  const hw = def.size.w / 2;
  const h0 = G.heightAt(x - hw, z - hw), h1 = G.heightAt(x + hw, z - hw);
  const h2 = G.heightAt(x - hw, z + hw), h3 = G.heightAt(x + hw, z + hw);
  const hc = G.heightAt(x, z);
  const hs = [h0, h1, h2, h3, hc];
  if (Math.max(...hs) - Math.min(...hs) > 3.4) return { ok: false, reason: 'Слишком неровная местность' };
  for (const b of G.buildings) {
    if (b.dead) continue;
    if (Math.abs(b.pos.x - x) < (b.def.size.w + def.size.w) / 2 + 1.2 &&
        Math.abs(b.pos.z - z) < (b.def.size.d + def.size.d) / 2 + 1.2) {
      return { ok: false, reason: 'Место занято' };
    }
  }
  return { ok: true, x, z };
}

// ------------------------------------------------------------
//  Приказы
// ------------------------------------------------------------
export function pushOrder(u, o, append) {
  if (append && u.orders.length && u.orders.length < 12) u.orders.push(o);
  else u.orders = [o];
}

function finishOrder(u) { u.orders.shift(); }

function moveToward(u, dest, dt, stopDist) {
  const dx = dest.x - u.pos.x, dz = dest.z - u.pos.z;
  const d = Math.hypot(dx, dz);
  u.moving = false;
  if (d <= stopDist) return true;
  u.moving = true;
  const sp = u.def.speed * clamp(d / 8, 0.4, 1);
  u.pos.x = clamp(u.pos.x + (dx / d) * sp * dt, -UNIT_BOUND, UNIT_BOUND);
  u.pos.z = clamp(u.pos.z + (dz / d) * sp * dt, -UNIT_BOUND, UNIT_BOUND);
  u.yaw = angleLerp(u.yaw, Math.atan2(dx, dz), dt * 8);
  return false;
}

function faceToward(u, dest, dt) {
  const dx = dest.x - u.pos.x, dz = dest.z - u.pos.z;
  if (dx * dx + dz * dz > 0.01) u.yaw = angleLerp(u.yaw, Math.atan2(dx, dz), dt * 10);
}

function tryFire(u, t) {
  const w = u.def.weapon;
  if (!w || u.cooldown > 0 || u.progress !== undefined && u.progress < 1) return;
  if (w.arc && u.distTo(t) < (u.def.minRange || 0)) return;
  u.cooldown = 1 / w.rof;
  u.recoil = 0.2;
  G.combat.spawnProjectile(u, t, w);
  if (w.arc) G.sound?.artyShot(u.pos.x, u.pos.z);
  else G.sound?.shoot(u.pos.x, u.pos.z);
}

function combatBehavior(u, t, dt, chase) {
  const w = u.def.weapon;
  if (!w) return;
  const d = u.distTo(t);
  const minR = u.def.minRange || 0;
  if (w.arc && d < minR) {
    // отъехать от цели
    const dx = u.pos.x - t.pos.x, dz = u.pos.z - t.pos.z;
    const dd = Math.max(0.01, Math.hypot(dx, dz));
    u.pos.x = clamp(u.pos.x + (dx / dd) * u.def.speed * dt * 0.7, -UNIT_BOUND, UNIT_BOUND);
    u.pos.z = clamp(u.pos.z + (dz / dd) * u.def.speed * dt * 0.7, -UNIT_BOUND, UNIT_BOUND);
    u.moving = true;
    faceToward(u, t.pos, dt);
    return;
  }
  if (d > w.range) {
    if (chase) moveToward(u, t.pos, dt, w.range * 0.82);
  } else {
    faceToward(u, t.pos, dt);
    tryFire(u, t);
  }
}

// ------------------------------------------------------------
//  Апдейт юнитов
// ------------------------------------------------------------
export function updateUnits(dt) {
  for (const u of G.units) {
    if (u.dead) continue;
    u.prevPos.copy(u.pos);
    u.cooldown -= dt;
    u.recoil = Math.max(0, u.recoil - dt * 1.1);
    u.moving = false;

    const o = u.orders[0];
    if (o) {
      switch (o.type) {
        case 'move': {
          if (moveToward(u, o.pos, dt, 3.5)) finishOrder(u);
          else if (G.time - o.t0 > (o.eta || 999)) finishOrder(u);
          break;
        }
        case 'attackmove': {
          if (o.target && !o.target.dead && u.distTo(o.target) > u.def.vision * 1.15) o.target = null;
          if (!o.target || o.target.dead) o.target = acquireTarget(u, u.def.vision);
          if (o.target && !o.target.dead) combatBehavior(u, o.target, dt, true);
          else if (moveToward(u, o.pos, dt, 4)) finishOrder(u);
          else if (G.time - o.t0 > (o.eta || 999)) finishOrder(u);
          break;
        }
        case 'patrol': {
          if (o.target && !o.target.dead && u.distTo(o.target) > u.def.vision * 1.15) o.target = null;
          const dest = o.pts[o.pi];
          if (moveToward(u, dest, dt, 3.5)) {
            o.pi = (o.pi + 1) % o.pts.length;
            if (!o.target || o.target.dead) o.target = acquireTarget(u, u.def.vision);
          }
          if (o.target && !o.target.dead) combatBehavior(u, o.target, dt, false);
          break;
        }
        case 'attack': {
          const t = o.target;
          if (!t || t.dead) finishOrder(u);
          else combatBehavior(u, t, dt, true);
          break;
        }
        case 'build': {
          const b = o.target;
          if (!b || b.dead || b.progress >= 1) finishOrder(u);
          else {
            const stop = b.radius + 6;
            if (u.distTo(b) > stop) moveToward(u, b.pos, dt, stop);
            else faceToward(u, b.pos, dt);
          }
          break;
        }
        default: finishOrder(u);
      }
    } else {
      // простой: автозахват целей
      if (!u.combatTarget || u.combatTarget.dead || !targetable(u.combatTarget, u.team)) {
        u.acquireT -= dt;
        if (u.acquireT <= 0) {
          u.acquireT = 0.45;
          u.combatTarget = u.def.weapon ? acquireTarget(u, u.def.vision) : null;
        }
      }
      const t = u.combatTarget;
      if (t && !t.dead) {
        const d = u.distTo(t);
        if (d > u.def.vision * 1.1) u.combatTarget = null;
        else combatBehavior(u, t, dt, !u.def.acu); // ACU не преследует
      }
    }

    // скорость (для упреждения)
    u.vel.copy(u.pos).sub(u.prevPos).divideScalar(Math.max(dt, 1e-4));

    // позиция меша
    const h = G.heightAt(u.pos.x, u.pos.z);
    u.pos.y = h;
    u.mesh.position.copy(u.pos);
    u.mesh.rotation.y = u.yaw;
    if (u.moving) {
      u.walkPhase += dt * (u.def.acu ? 6 : 10);
      u.mesh.position.y = h + Math.abs(Math.sin(u.walkPhase)) * (u.def.acu ? 0.12 : 0.07);
    }

    // башня
    if (u.turret) {
      let desired = 0;
      const t = (u.orders[0] && u.orders[0].target && !u.orders[0].target.dead && u.orders[0].type !== 'build') ? u.orders[0].target : u.combatTarget;
      if (t && !t.dead) desired = Math.atan2(t.pos.x - u.pos.x, t.pos.z - u.pos.z) - u.yaw;
      u.turretYaw = angleLerp(u.turretYaw, desired, dt * 7);
      u.turret.rotation.y = u.turretYaw;
      u.turret.position.z = -u.recoil * 0.9;
    }
  }
}

// ------------------------------------------------------------
//  Апдейт зданий
// ------------------------------------------------------------
export function updateBuildings(dt) {
  for (const b of G.buildings) {
    if (b.dead) continue;

    if (b.spin) { b.spin.rotation.y += dt * 1.3; }
    if (b.pulse) { const s = 1 + Math.sin(G.time * 3 + b.id) * 0.13; b.pulse.scale.setScalar(s); }
    if (b.strip) {
      const active = b.queue && b.queue.length;
      b.strip.scale.x = active ? 0.65 + 0.35 * Math.abs(Math.sin(G.time * 6)) : 1;
    }

    if (b.progress < 1) continue;
    b.cooldown -= dt;

    if (b.def.weapon) {
      const w = b.def.weapon;
      const t = b.combatTarget;
      if (t && (t.dead || !targetable(t, b.team) || b.distTo(t) > w.range * 1.15)) b.combatTarget = null;
      if (!b.combatTarget) {
        b.acquireT -= dt;
        if (b.acquireT <= 0) {
          b.acquireT = 0.35;
          b.combatTarget = acquireTarget(b, b.def.vision);
        }
      }
      if (b.combatTarget && b.turret) {
        const desired = Math.atan2(b.combatTarget.pos.x - b.pos.x, b.combatTarget.pos.z - b.pos.z) - b.meshYaw;
        b.turretYaw = angleLerp(b.turretYaw, desired, dt * 6);
        b.turret.rotation.y = b.turretYaw;
        b.turret.position.z = -b.recoil * 0.9;
        b.recoil = Math.max(0, b.recoil - dt * 1.1);
        if (b.distTo(b.combatTarget) <= w.range) tryFire(b, b.combatTarget);
      }
    }
  }
}

// ------------------------------------------------------------
//  Расталкивание юнитов
// ------------------------------------------------------------
export function separation() {
  const us = G.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    if (a.dead) continue;
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      if (b.dead) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const rr = a.radius + b.radius + 0.3;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        const ux = dx / d, uz = dz / d;
        a.pos.x -= ux * push; a.pos.z -= uz * push;
        b.pos.x += ux * push; b.pos.z += uz * push;
      }
    }
    // выталкивание из зданий
    for (const b of G.buildings) {
      if (b.dead) continue;
      const hw = b.def.size.w / 2 + a.radius + 0.25;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hw) {
        const px = hw - Math.abs(dx), pz = hw - Math.abs(dz);
        if (px < pz) a.pos.x = b.pos.x + (dx >= 0 ? hw : -hw);
        else a.pos.z = b.pos.z + (dz >= 0 ? hw : -hw);
      }
    }
    a.pos.x = clamp(a.pos.x, -UNIT_BOUND, UNIT_BOUND);
    a.pos.z = clamp(a.pos.z, -UNIT_BOUND, UNIT_BOUND);
  }
}

export { formationOffsets };
