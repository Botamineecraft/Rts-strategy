// ============================================================
//  Экономика в стиле Supreme Commander:
//  непрерывный доход массы/энергии и списание при строительстве.
//  При нехватке ресурсов стройка/производство замедляются.
// ============================================================
import { DEFS, UNIT_CAP } from './config.js';
import { G } from './state.js';
import { spawnUnit, pushOrder } from './entities.js';

function completeUnit(f) {
  const key = f.queue[0];
  f.queue.shift();
  f.progressUnit = 0;
  const dir = f.team === 0 ? 1 : -1;
  const x = f.pos.x + (Math.random() - 0.5) * 5;
  const z = f.pos.z + dir * (f.def.size.w / 2 + 3.5);
  const u = spawnUnit(key, f.team, x, z);
  if (u) {
    G.stats[f.team].built++;
    const rally = f.rally || { x: f.pos.x + dir * 22, z: f.pos.z + dir * 14 };
    pushOrder(u, {
      type: 'move',
      pos: { x: rally.x + (Math.random() - 0.5) * 6, y: 0, z: rally.z + (Math.random() - 0.5) * 6 },
      t0: G.time, eta: 12,
    }, false);
    if (f.team === 0 && G.selection.includes(f) && G.ui) G.ui.selDirty = true;
  }
}

export function updateEconomy(dt) {
  // 1) доход
  for (let t = 0; t < 2; t++) {
    const T = G.teams[t];
    let mi = 0, ei = 0;
    const acu = G.acu[t];
    if (acu && !acu.dead) { mi += acu.def.income.m; ei += acu.def.income.e; }
    for (const b of G.buildings) {
      if (b.dead || b.team !== t || b.progress < 1 || !b.def.income) continue;
      mi += b.def.income.m;
      ei += b.def.income.e;
    }
    if (t === 1 && G.ai) { mi *= G.ai.ecoMult; ei *= G.ai.ecoMult; }
    T.mass = Math.min(T.massCap, T.mass + mi * dt);
    T.energy = Math.min(T.energyCap, T.energy + ei * dt);
    T.massIncome = mi;
    T.energyIncome = ei;
  }

  // 2) потребители: стройка (нужен ACU рядом) и заводы
  for (let t = 0; t < 2; t++) {
    const T = G.teams[t];
    const acu = G.acu[t];
    const cons = [];

    for (const b of G.buildings) {
      if (b.dead || b.team !== t) continue;
      if (b.progress < 1) {
        if (acu && !acu.dead) {
          const d = Math.hypot(acu.pos.x - b.pos.x, acu.pos.z - b.pos.z);
          if (d <= acu.def.buildRange + b.def.size.w * 0.5) {
            cons.push({ m: b.def.cost.m / b.def.bt, e: b.def.cost.e / b.def.bt, b });
          }
        }
      } else if (b.def.factory && b.queue.length && T.unitCount < UNIT_CAP) {
        const ud = DEFS[b.queue[0]];
        if (ud) cons.push({ m: ud.cost.m / ud.bt, e: ud.cost.e / ud.bt, f: b });
      }
    }
    if (!cons.length) continue;

    let sm = 0, se = 0;
    for (const c of cons) { sm += c.m; se += c.e; }
    const k = Math.min(1,
      sm > 1e-9 ? T.mass / (sm * dt) : 1,
      se > 1e-9 ? T.energy / (se * dt) : 1);

    T.mass = Math.max(0, T.mass - sm * k * dt);
    T.energy = Math.max(0, T.energy - se * k * dt);
    T.massDrain = sm * k;
    T.energyDrain = se * k;

    for (const c of cons) {
      if (c.b) {
        c.b.progress = Math.min(1, c.b.progress + (dt * k) / c.b.def.bt);
        c.b.updateBuildVisual();
        if (c.b.progress >= 1 && !c.b._completed) {
          c.b._completed = true;
          c.b.onComplete();
        }
      } else if (c.f) {
        const ud = DEFS[c.f.queue[0]];
        c.f.progressUnit = Math.min(1, c.f.progressUnit + (dt * k) / ud.bt);
        if (c.f.progressUnit >= 1) completeUnit(c.f);
      }
    }
  }
}
