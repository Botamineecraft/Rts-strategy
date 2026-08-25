// ============================================================
//  ИИ противника: развитие базы, оборона, волны атак
// ============================================================
import * as THREE from '../libs/three.module.js';
import { DEFS, DIFFICULTIES, SPAWNS, UNIT_CAP } from './config.js';
import { G } from './state.js';
import { canPlace, createBuilding, spawnUnit, pushOrder } from './entities.js';

export function initAI() {
  const d = DIFFICULTIES[G.difficulty] || DIFFICULTIES.normal;
  G.ai = {
    team: 1,
    ecoMult: d.eco,
    first: d.first, interval: d.interval,
    size: d.size, growth: d.growth,
    waveT: d.first,
    waveN: 0,
    decideT: 3,
    prodT: 2,
    defT: 2,
    base: new THREE.Vector3(SPAWNS[1].x, 0, SPAWNS[1].z),
    turretDir: 0,
  };
  // стартовые юниты на высокой сложности
  if (d.startUnits > 0) {
    for (let i = 0; i < d.startUnits; i++) {
      const a = (i / d.startUnits) * Math.PI * 2;
      spawnUnit('tank', 1, SPAWNS[1].x + Math.cos(a) * 14, SPAWNS[1].z + Math.sin(a) * 14);
    }
  }
}

export function applyDifficulty(key) {
  G.difficulty = key;
  // пересчёт параметров до старта
  initAI();
}

function aiBuildOrder() {
  const acu = G.acu[1];
  if (!acu || acu.dead) return;
  if (acu.orders.length && acu.orders[0].type === 'build') return;

  const t = G.time;
  let ext = 0, pgen = 0, fac = 0, tur = 0;
  for (const b of G.buildings) {
    if (b.dead || b.team !== 1) continue;
    if (b.defKey === 'extractor') ext++;
    else if (b.defKey === 'pgen') pgen++;
    else if (b.defKey === 'factory') fac++;
    else if (b.defKey === 'turret') tur++;
  }

  const wantFactory = Math.min(1 + Math.floor(t / 170), 4);
  let defKey = null;

  if (ext < 4) defKey = 'extractor';
  else if (pgen < 2 + fac * 2) defKey = 'pgen';
  else if (fac < wantFactory) defKey = 'factory';
  else if (ext < 6) defKey = 'extractor';
  else if (t > 150 && tur < 4) defKey = 'turret';
  else if (pgen < 3 + fac * 2) defKey = 'pgen';
  else return;

  // позиция
  const base = G.ai.base;
  let x = 0, z = 0, ok = false;
  if (defKey === 'extractor') {
    // ближайшая к базе свободная точка массы
    let best = null, bd = 1e9;
    for (const p of G.massPoints) {
      if (p.building) continue;
      const d = Math.hypot(p.x - base.x, p.z - base.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 260) return;
    x = best.x; z = best.z;
    const r = canPlace('extractor', x, z, 1);
    if (!r.ok) return;
    x = r.x; z = r.z;
    ok = true;
  } else if (defKey === 'turret') {
    // в сторону игрока
    const dir = Math.atan2(SPAWNS[0].x - base.x, SPAWNS[0].z - base.z);
    for (let attempt = 0; attempt < 10 && !ok; attempt++) {
      const ang = dir + (attempt % 2 ? 1 : -1) * (0.25 + attempt * 0.12);
      const dist = 32 + (attempt % 3) * 10;
      x = base.x + Math.sin(ang) * dist;
      z = base.z + Math.cos(ang) * dist;
      const r = canPlace('turret', x, z, 1);
      if (r.ok) { x = r.x; z = r.z; ok = true; }
    }
  } else {
    // спираль вокруг базы
    outer:
    for (let ring = 2; ring < 12; ring++) {
      const cnt = 6 + ring * 3;
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * Math.PI * 2 + ring;
        const dist = 14 + ring * 5.5;
        x = base.x + Math.cos(a) * dist;
        z = base.z + Math.sin(a) * dist;
        const r = canPlace(defKey, x, z, 1);
        if (r.ok) { x = r.x; z = r.z; ok = true; break outer; }
      }
    }
  }
  if (!ok) return;

  const b = createBuilding(defKey, 1, x, z);
  if (b) {
    acu.orders = [{ type: 'build', target: b, t0: G.time }];
  }
}

function aiProduction() {
  const T = G.teams[1];
  if (T.unitCount >= UNIT_CAP - 2) return;
  const t = G.time;
  for (const f of G.buildings) {
    if (f.dead || f.team !== 1 || f.progress < 1 || !f.def.factory) continue;
    if (f.queue.length >= 3) continue;
    const r = Math.random();
    let key = 'tank';
    if (t > 230 && r < 0.16) key = 'arty';
    else if (t > 160 && r < 0.45) key = 'heavy';
    f.queue.push(key);
  }
}

function aiDefense() {
  const base = G.ai.base;
  // угрозы рядом с базой ИИ
  let threat = null, td = 1e9;
  for (const e of G.entities) {
    if (e.dead || e.team !== 0 || e.def.kind !== 'unit') continue;
    const d = Math.hypot(e.pos.x - base.x, e.pos.z - base.z);
    if (d < 120 && d < td) { td = d; threat = e; }
  }
  if (!threat) return;
  for (const u of G.units) {
    if (u.dead || u.team !== 1 || u.def.acu) continue;
    const dHome = Math.hypot(u.pos.x - base.x, u.pos.z - base.z);
    if (dHome < 150 && (!u.orders.length || u.orders[0].type === 'patrol')) {
      u.orders = [{ type: 'attack', target: threat, t0: G.time }];
    }
  }
  const acu = G.acu[1];
  if (acu && !acu.dead && td < 50) acu.combatTarget = threat;
}

function aiWave() {
  const size = Math.min(26, G.ai.size + G.ai.waveN * G.ai.growth);
  const troops = [];
  for (const u of G.units) {
    if (u.dead || u.team !== 1 || u.def.acu) continue;
    if (u.orders.length) continue;
    const dHome = Math.hypot(u.pos.x - G.ai.base.x, u.pos.z - G.ai.base.z);
    if (dHome < 160) troops.push(u);
  }
  if (troops.length < Math.min(size, 4)) return;

  troops.sort((a, b) => b.def.cost.m - a.def.cost.m);
  const squad = troops.slice(0, size);

  // цель: ACU игрока или ближайшее его здание
  let target = G.acu[0] && !G.acu[0].dead ? G.acu[0] : null;
  if (!target) {
    let bd = 1e9;
    for (const e of G.entities) {
      if (e.dead || e.team !== 0) continue;
      const d = Math.hypot(e.pos.x - G.ai.base.x, e.pos.z - G.ai.base.z);
      if (d < bd) { bd = d; target = e; }
    }
  }
  if (!target) return;

  const dest = { x: target.pos.x, z: target.pos.z };
  for (const u of squad) {
    pushOrder(u, {
      type: 'attackmove',
      pos: { x: dest.x + (Math.random() - 0.5) * 20, y: 0, z: dest.z + (Math.random() - 0.5) * 20 },
      target: null, t0: G.time, eta: 240,
    }, false);
  }
  G.ui?.toast('Обнаружена волна атаки противника!', 'warn');
  G.sound?.alert();
}

export function updateAI(dt) {
  const ai = G.ai;
  if (!ai || G.over) return;

  ai.decideT -= dt;
  if (ai.decideT <= 0) { ai.decideT = 2.2; aiBuildOrder(); }

  ai.prodT -= dt;
  if (ai.prodT <= 0) { ai.prodT = 1.6; aiProduction(); }

  ai.defT -= dt;
  if (ai.defT <= 0) { ai.defT = 2.0; aiDefense(); }

  ai.waveT -= dt;
  if (ai.waveT <= 0) {
    ai.waveN++;
    ai.waveT = ai.interval;
    aiWave();
  }
}
