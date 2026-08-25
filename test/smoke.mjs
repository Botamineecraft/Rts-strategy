// ============================================================
//  Headless-тест игровой логики (без DOM и WebGL):
//  node test/smoke.mjs
//  Проверяет: экономику, стройку, производство ИИ, бой, туман-заглушки.
// ============================================================
import * as THREE from '../libs/three.module.js';
import { G } from '../js/state.js';
import { MAP_SIZE } from '../js/config.js';
import * as WORLD from '../js/world.js';
import { Combat } from '../js/combat.js';
import { spawnUnit, createBuilding, updateUnits, updateBuildings, separation, sweepDead, canPlace } from '../js/entities.js';
import { updateEconomy } from '../js/economy.js';
import { initAI, updateAI } from '../js/ai.js';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
};

console.log('== Forged Arena smoke test ==');

// --- инициализация ---
G.scene = new THREE.Scene();
WORLD.initWorld(G.scene);
G.matBody = new THREE.MeshLambertMaterial({ vertexColors: true });
G.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
G.combat = new Combat(G.scene);
G.fog = null; // без тумана: вся карта "видима"

const p0 = { x: -210, z: 210 }, p1 = { x: 210, z: -210 };
const acu0 = spawnUnit('acu', 0, p0.x, p0.z);
const acu1 = spawnUnit('acu', 1, p1.x, p1.z);
G.acu = [acu0, acu1];
initAI();

ok(G.massPoints.length >= 14, `залежи массы созданы (${G.massPoints.length})`);
ok(acu0 && acu1 && !acu0.dead, 'ACU заспавнены');
ok(Math.abs(G.heightAt(0, 0)) < 60, `высота в центре адекватна (${G.heightAt(0, 0).toFixed(1)})`);

// --- ручная стройка игрока: экстрактор ---
const mp = G.massPoints.reduce((best, p) => {
  const d = Math.hypot(p.x - p0.x, p.z - p0.z);
  return (!best || d < best.d) ? { p, d } : best;
}, null).p;
const ext = createBuilding('extractor', 0, mp.x, mp.z);
ok(ext && ext.massPoint === mp, 'экстрактор встал на залежь');
acu0.orders = [{ type: 'build', target: ext, t0: 0 }];

// нельзя строить не на залежах
const bad = canPlace('extractor', 10, 10, 0);
ok(!bad.ok, 'экстрактор вне залежей запрещён: ' + bad.reason);

// нельзя строить на неровной земле (ищем Steilhang) — просто проверим границы
const edge = canPlace('pgen', 330, 330, 0);
ok(!edge.ok, 'стройка за границей запрещена');

// --- симуляция ---
const dt = 0.05;
let steps = 0;
const maxSteps = 14000; // 700 игровых секунд
let extractorDone = false, aiFactory = false, peakIncome = 0;

while (steps < maxSteps) {
  steps++;
  updateEconomy(dt);
  updateAI(dt);
  updateUnits(dt);
  updateBuildings(dt);
  separation();
  G.combat.update(dt);
  sweepDead();
  G.time += dt;
  peakIncome = Math.max(peakIncome, G.teams[0].massIncome);

  if (!extractorDone && ext.progress >= 1) extractorDone = true;

  if (!aiFactory && G.buildings.some(b => b.team === 1 && b.defKey === 'factory' && b.progress >= 1)) aiFactory = true;

  // конец партии
  if ((acu0.dead || acu1.dead) && steps > 100) break;
}

console.log(`— симуляция: ${(steps * dt / 60).toFixed(1)} игровых минут —`);
console.log(`  debug: acu0.dead=${acu0.dead} acu1.dead=${acu1.dead} hp0=${acu0.hp.toFixed(0)} hp1=${acu1.hp.toFixed(0)} ` +
  `playerBuildings=${G.buildings.filter(b => b.team === 0).map(b => b.defKey + ':' + b.progress.toFixed(2)).join(',')} ` +
  `kills0=${G.stats[0].kills} kills1=${G.stats[1].kills} time=${G.time.toFixed(0)}`);
ok(extractorDone, 'экстрактор игрока достроен');
ok(peakIncome > 3, `пиковый доход массы игрока: ${peakIncome.toFixed(1)}/с`);
ok(aiFactory, 'ИИ построил завод');
ok(G.buildings.filter(b => b.team === 1).length >= 4, `у ИИ зданий: ${G.buildings.filter(b => b.team === 1).length}`);
ok(G.teams[1].unitCount > 0 || G.stats[0].kills > 0, `юниты ИИ: ${G.teams[1].unitCount}, убито ИИ: ${G.stats[0].kills}`);

// --- проверка финансов: ресурсы не уходят в минус ---
ok(G.teams[0].mass >= 0 && G.teams[0].energy >= 0, 'ресурсы игрока не отрицательны');
ok(G.teams[1].mass >= 0 && G.teams[1].energy >= 0, 'ресурсы ИИ не отрицательны');

// --- принудительный бой: два танка против одного ---
console.log('— боевая проверка —');
const t1 = spawnUnit('tank', 0, 0, 10);
const t2 = spawnUnit('tank', 1, 0, -10);
if (t1 && t2) {
  t1.orders = [{ type: 'attack', target: t2, t0: G.time }];
  t2.combatTarget = t1;
  let guard = 0;
  while (!t1.dead && !t2.dead && guard++ < 3000) {
    updateEconomy(dt); updateUnits(dt); updateBuildings(dt); separation();
    G.combat.update(dt); sweepDead();
    G.time += dt;
  }
  ok(t1.dead || t2.dead, `бой завершился (guard=${guard}, танк1 hp=${t1.hp.toFixed(0)}, танк2 hp=${t2.hp.toFixed(0)})`);
} else {
  ok(false, 'танки не заспавнились (превышен лимит юнитов?)');
}

// --- проверка ядерного взрыва ACU ---
console.log('— проверка гибели ACU —');
const before = G.entities.filter(e => !e.dead).length;
acu1.hp = 1;
import('../js/entities.js').then(E => {
  E.damageEntity(acu1, 100, acu0);
  ok(acu1.dead, 'ACU ИИ погиб');
  const after = G.entities.filter(e => !e.dead).length;
  console.log(`  живых сущностей: ${before} → ${after}`);

  sweepDead();
  ok(!G.units.includes(acu1) && !G.entities.includes(acu1), 'мёртвый ACU убран из списков');

  if (failures === 0) {
    console.log('\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ✓');
    process.exit(0);
  } else {
    console.error(`\nПРОВАЛЕНО ПРОВЕРОК: ${failures}`);
    process.exit(1);
  }
});
