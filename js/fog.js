// ============================================================
//  Туман войны (по командам)
// ============================================================
import * as THREE from '../libs/three.module.js';
import { MAP_SIZE } from './config.js';
import { G } from './state.js';

const N = 80;
const CELL = MAP_SIZE / N;

export class Fog {
  constructor(scene) {
    this.N = N;
    this.vis = [new Uint8Array(N * N), new Uint8Array(N * N)];
    this.exp = [new Uint8Array(N * N), new Uint8Array(N * N)];
    this.t = 0;

    // текстура тумана (для игрока)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = N;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(N, N);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;

    // плоскость тумана, повторяющая рельеф
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 128, 128);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, G.heightAt(pos.getX(i), pos.getZ(i)) + 0.7);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
  }

  stamp(arr, x, z, r) {
    const cx = (x + MAP_SIZE / 2) / CELL, cz = (z + MAP_SIZE / 2) / CELL;
    const rc = r / CELL;
    const x0 = Math.max(0, Math.floor(cx - rc)), x1 = Math.min(N - 1, Math.ceil(cx + rc));
    const z0 = Math.max(0, Math.floor(cz - rc)), z1 = Math.min(N - 1, Math.ceil(cz + rc));
    const r2 = rc * rc;
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix - cx, dz = iz - cz;
        if (dx * dx + dz * dz <= r2) arr[iz * N + ix] = 1;
      }
    }
  }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.18;

    for (let t = 0; t < 2; t++) {
      const vis = this.vis[t], exp = this.exp[t];
      vis.fill(0);
      for (const e of G.entities) {
        if (e.dead || e.team !== t) continue;
        this.stamp(vis, e.pos.x, e.pos.z, e.def.vision);
      }
      for (let i = 0; i < vis.length; i++) if (vis[i]) exp[i] = 1;
    }

    // перерисовать текстуру (туман игрока)
    const d = this.img.data;
    const vis = this.vis[0], exp = this.exp[0];
    for (let i = 0; i < N * N; i++) {
      const j = i * 4;
      d[j] = 3; d[j + 1] = 8; d[j + 2] = 12;
      d[j + 3] = vis[i] ? 0 : (exp[i] ? 105 : 235);
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.tex.needsUpdate = true;
  }

  isVisible(team, x, z) {
    const ix = Math.floor((x + MAP_SIZE / 2) / CELL);
    const iz = Math.floor((z + MAP_SIZE / 2) / CELL);
    if (ix < 0 || ix >= N || iz < 0 || iz >= N) return false;
    return this.vis[team][iz * N + ix] === 1;
  }

  isExplored(team, x, z) {
    const ix = Math.floor((x + MAP_SIZE / 2) / CELL);
    const iz = Math.floor((z + MAP_SIZE / 2) / CELL);
    if (ix < 0 || ix >= N || iz < 0 || iz >= N) return false;
    return this.exp[team][iz * N + ix] === 1;
  }
}
