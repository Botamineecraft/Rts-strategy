// ============================================================
//  FORGED ARENA — точка входа
// ============================================================
import * as THREE from '../libs/three.module.js';
import { G } from './state.js';
import { SPAWNS, TEAM_STYLE } from './config.js';
import { initWorld, updateWorld } from './world.js';
import { Fog } from './fog.js';
import { Combat } from './combat.js';
import { spawnUnit, updateUnits, updateBuildings, separation, sweepDead, updateEntityVisibility } from './entities.js';
import { updateEconomy } from './economy.js';
import { initAI, updateAI } from './ai.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Sound } from './sound.js';

// ---------------- рендерер / сцена ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;

G.renderer = renderer;
G.scene = new THREE.Scene();
G.scene.fog = new THREE.Fog(0x0e1622, 500, 1650);
G.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 2, 2800);
G.cam = { target: new THREE.Vector3(SPAWNS[0].x, 0, SPAWNS[0].z), dist: 95 };
G.clock = new THREE.Clock();

// общие материалы
G.matBody = new THREE.MeshLambertMaterial({ vertexColors: true });
G.matGlow = new THREE.MeshBasicMaterial({ vertexColors: true });

// ---------------- свет ----------------
const hemi = new THREE.HemisphereLight(0x9db8c8, 0x3d4a3a, 0.85);
G.scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
sun.position.set(260, 340, 160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -400;
sun.shadow.camera.right = 400;
sun.shadow.camera.top = 400;
sun.shadow.camera.bottom = -400;
sun.shadow.camera.near = 60;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 1.5;
G.scene.add(sun);
G.scene.add(sun.target);

// ---------------- мир ----------------
initWorld(G.scene);
G.fog = new Fog(G.scene);
G.combat = new Combat(G.scene);
G.sound = new Sound();

// ---------------- стартовые силы ----------------
const a0 = spawnUnit('acu', 0, SPAWNS[0].x, SPAWNS[0].z);
a0.yaw = Math.atan2(SPAWNS[1].x - SPAWNS[0].x, SPAWNS[1].z - SPAWNS[0].z);
a0.mesh.rotation.y = a0.yaw;
const a1 = spawnUnit('acu', 1, SPAWNS[1].x, SPAWNS[1].z);
a1.yaw = Math.atan2(SPAWNS[0].x - SPAWNS[1].x, SPAWNS[0].z - SPAWNS[1].z);
a1.mesh.rotation.y = a1.yaw;
G.acu = [a0, a1];

initAI();

// ---------------- ввод / интерфейс ----------------
G.input = new Input();
G.ui = new UI();

window.addEventListener('resize', () => {
  G.camera.aspect = innerWidth / innerHeight;
  G.camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

document.getElementById('loading').style.display = 'none';

// ---------------- условия конца игры ----------------
function checkEnd(dt) {
  if (G.pendingEnd) {
    G.pendingEnd.t -= dt;
    if (G.pendingEnd.t <= 0) {
      G.over = true;
      G.winner = G.pendingEnd.winner;
      G.ui.showEnd(G.winner);
      G.pendingEnd = null;
    }
    return;
  }
  let winner = null;
  if (G.acu[1] && G.acu[1].dead) winner = 0;
  else if (G.acu[0] && G.acu[0].dead) winner = 1;
  else {
    const enemyAlive = G.entities.some(e => e.team === 1 && !e.dead);
    if (G.started && !enemyAlive) winner = 0;
  }
  if (winner !== null) {
    G.pendingEnd = { winner, t: 2.4 };
  }
}

// ---------------- цикл ----------------
window.G = G; // доступ к состоянию для отладки/модирования из консоли

// отладочный ускоритель времени: index.html?debug=1 → window.__tick(n)
if (new URLSearchParams(location.search).has('debug')) {
  window.__tick = (n = 60, dt = 0.05) => {
    for (let i = 0; i < n; i++) {
      if (G.over) break;
      if (G.started) {
        G.time += dt;
        updateEconomy(dt);
        updateAI(dt);
        updateUnits(dt);
        updateBuildings(dt);
        separation();
        sweepDead();
        checkEnd(dt);
      }
      G.combat.update(dt);
      G.fog.update(dt);
      updateEntityVisibility();
      updateWorld(dt);
    }
    return { time: G.time, buildings: G.buildings.length, units: G.units.length };
  };
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(G.clock.getDelta(), 0.05);

  if (!G.over) {
    if (G.started) {
      G.time += dt;
      updateEconomy(dt);
      updateAI(dt);
      updateUnits(dt);
      updateBuildings(dt);
      separation();
      sweepDead();
      checkEnd(dt);
    }
    G.combat.update(dt);
    G.fog.update(dt);
    updateEntityVisibility();
    updateWorld(dt);
  }

  G.input.updateCamera(dt);
  G.ui.update(dt);
  renderer.render(G.scene, G.camera);
}
animate();
