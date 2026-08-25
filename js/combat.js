// ============================================================
//  Бой: снаряды, взрывы, эффекты
// ============================================================
import * as THREE from '../libs/three.module.js';
import { TEAM_STYLE } from './config.js';
import { G } from './state.js';
import { clamp } from './util.js';
import { damageEntity } from './entities.js';

const MAX_PROJ = 320;
const MAX_PART = 2600;

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,220,150,0.85)');
  g.addColorStop(0.6, 'rgba(255,140,60,0.35)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.projs = [];

    // снаряды — InstancedMesh
    this.pMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.24, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_PROJ
    );
    this.pMesh.count = 0;
    this.pMesh.frustumCulled = false;
    scene.add(this.pMesh);
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s1 = new THREE.Vector3(1, 1, 1);
    this._col = new THREE.Color();

    // частицы — Points
    this.pCount = 0;
    this.pPos = new Float32Array(MAX_PART * 3);
    this.pCol = new Float32Array(MAX_PART * 3);
    this.pBase = new Float32Array(MAX_PART * 3);
    this.pVel = new Float32Array(MAX_PART * 3);
    this.pLife = new Float32Array(MAX_PART);
    this.pMaxL = new Float32Array(MAX_PART);
    this.pGrav = new Float32Array(MAX_PART);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    pg.setDrawRange(0, 0);
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 2.4, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // вспышки — спрайты
    this.flashTex = (typeof document !== 'undefined') ? makeFlashTexture() : null;
    this.flashes = [];
    for (let i = 0; i < 22; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
      }));
      spr.visible = false;
      scene.add(spr);
      this.flashes.push({ spr, life: 0, max: 1, s0: 1, s1: 2 });
    }

    // кольца (маркеры приказов и взрывов)
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.86, 1, 26);
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, max: 1, s0: 1, s1: 6 });
    }
  }

  // ------------------------------------------------------------
  spawnProjectile(owner, target, w) {
    if (this.projs.length >= MAX_PROJ) return;
    const from = new THREE.Vector3(owner.pos.x, owner.pos.y + (w.height || 1.5), owner.pos.z);
    const p = {
      owner, team: owner.team, target,
      from, pos: from.clone(),
      dest: new THREE.Vector3(target.pos.x, target.pos.y + 0.8, target.pos.z),
      speed: w.pSpeed, dmg: w.dmg, aoe: w.aoe || 0, arc: !!w.arc,
      t: 0, dur: 0, peak: 0,
    };
    if (p.arc) {
      // упреждение
      const tv = target.vel || null;
      const d0 = Math.hypot(target.pos.x - from.x, target.pos.z - from.z);
      p.dur = clamp(d0 / 26, 1.1, 3.4);
      if (tv) p.dest.set(target.pos.x + tv.x * p.dur * 0.8, 0, target.pos.z + tv.z * p.dur * 0.8);
      else p.dest.set(target.pos.x, 0, target.pos.z);
      p.dest.y = G.heightAt(p.dest.x, p.dest.z) + 0.5;
      p.peak = 6 + Math.hypot(p.dest.x - from.x, p.dest.z - from.z) * 0.16;
    }
    this.projs.push(p);
    // вспышка выстрела
    this.flash(from.x, from.y, from.z, 2.2, 0.12);
  }

  // ------------------------------------------------------------
  burst(x, y, z, n, opts) {
    const { speed = 10, up = 5, colors = [[1, 0.7, 0.3]], life = 0.8, grav = -12, spread = 1 } = opts || {};
    for (let i = 0; i < n; i++) {
      if (this.pCount >= MAX_PART) return;
      const idx = this.pCount++;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const sp = speed * (0.35 + Math.random() * 0.9);
      this.pPos[idx * 3] = x + Math.cos(a) * r * 0.4;
      this.pPos[idx * 3 + 1] = y + Math.random() * 0.8;
      this.pPos[idx * 3 + 2] = z + Math.sin(a) * r * 0.4;
      this.pVel[idx * 3] = Math.cos(a) * sp;
      this.pVel[idx * 3 + 1] = up * (0.3 + Math.random());
      this.pVel[idx * 3 + 2] = Math.sin(a) * sp;
      const c = colors[(Math.random() * colors.length) | 0];
      this.pBase[idx * 3] = c[0]; this.pBase[idx * 3 + 1] = c[1]; this.pBase[idx * 3 + 2] = c[2];
      const l = life * (0.6 + Math.random() * 0.7);
      this.pLife[idx] = l; this.pMaxL[idx] = l;
      this.pGrav[idx] = grav;
    }
  }

  flash(x, y, z, scale, dur) {
    for (const f of this.flashes) {
      if (f.life <= 0) {
        f.life = dur; f.max = dur; f.s0 = scale * 0.5; f.s1 = scale * 1.9;
        f.spr.position.set(x, y, z);
        f.spr.material.opacity = 0.95;
        f.spr.visible = true;
        return;
      }
    }
  }

  ring(x, z, color, s0, s1, dur) {
    for (const r of this.rings) {
      if (r.life <= 0) {
        r.life = dur; r.max = dur; r.s0 = s0; r.s1 = s1;
        r.mesh.material.color.set(color);
        r.mesh.material.opacity = 0.9;
        r.mesh.position.set(x, G.heightAt(x, z) + 0.35, z);
        r.mesh.scale.setScalar(s0);
        r.mesh.visible = true;
        return;
      }
    }
  }

  explosion(x, y, z, power = 1) {
    const p = Math.min(4, power);
    this.flash(x, y + 1, z, 4 + p * 4, 0.25 + p * 0.1);
    this.burst(x, y, z, Math.floor(14 + p * 16), {
      speed: 5 + p * 5, up: 6 + p * 4,
      colors: [[1, 0.82, 0.4], [1, 0.5, 0.2], [1, 0.95, 0.75], [0.4, 0.4, 0.45]],
      life: 0.55 + p * 0.3, grav: -14,
    });
    this.burst(x, y + 1, z, Math.floor(6 + p * 6), {
      speed: 2 + p, up: 4 + p * 3,
      colors: [[0.35, 0.33, 0.3], [0.5, 0.48, 0.45]],
      life: 1.2 + p * 0.5, grav: 2,
    });
    this.ring(x, z, 0xffcf90, 1 + p, 4 + p * 4, 0.45);
    G.shake = Math.max(G.shake, Math.min(0.5, p * 0.12));
  }

  nuke(x, y, z) {
    this.flash(x, y + 6, z, 60, 1.4);
    this.burst(x, y + 2, z, 260, {
      speed: 34, up: 30, spread: 6,
      colors: [[1, 0.95, 0.7], [1, 0.7, 0.3], [1, 0.45, 0.15], [1, 1, 1]],
      life: 2.2, grav: -10,
    });
    this.burst(x, y + 1, z, 160, {
      speed: 14, up: 22, spread: 10,
      colors: [[0.3, 0.29, 0.28], [0.45, 0.43, 0.42], [0.2, 0.2, 0.22]],
      life: 3.4, grav: 3,
    });
    this.ring(x, z, 0xffe0a0, 2, 70, 1.6);
    this.ring(x, z, 0xff9060, 1, 46, 1.2);
  }

  marker(x, z, color) {
    this.ring(x, z, color, 0.8, 5.5, 0.55);
  }

  hitSpark(x, y, z) {
    this.burst(x, y, z, 5, { speed: 6, up: 4, colors: [[1, 0.9, 0.5], [1, 0.6, 0.3]], life: 0.3, grav: -10 });
  }

  // ------------------------------------------------------------
  impact(p) {
    if (p.aoe) {
      this.explosion(p.pos.x, p.pos.y, p.pos.z, 1.6);
      G.sound?.explosion(1.6, p.pos.x, p.pos.z);
      for (const e of G.entities) {
        if (e.dead) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < p.aoe + e.radius) {
          damageEntity(e, p.dmg * (1 - 0.55 * clamp(d / p.aoe, 0, 1)), p.owner);
        }
      }
    } else {
      if (p.target && !p.target.dead) {
        damageEntity(p.target, p.dmg, p.owner);
        this.hitSpark(p.pos.x, p.pos.y, p.pos.z);
      }
    }
  }

  update(dt) {
    // --- снаряды ---
    let n = 0;
    for (let i = 0; i < this.projs.length; i++) {
      const p = this.projs[i];
      let done = false;
      if (p.arc) {
        p.t += dt / p.dur;
        if (p.t >= 1) {
          p.pos.copy(p.dest);
          done = true;
        } else {
          const t = p.t;
          p.pos.set(
            p.from.x + (p.dest.x - p.from.x) * t,
            p.from.y + (p.dest.y - p.from.y) * t + Math.sin(Math.PI * t) * p.peak,
            p.from.z + (p.dest.z - p.from.z) * t
          );
        }
      } else {
        if (p.target && !p.target.dead) p.dest.set(p.target.pos.x, p.target.pos.y + 0.8, p.target.pos.z);
        const dx = p.dest.x - p.pos.x, dy = p.dest.y - p.pos.y, dz = p.dest.z - p.pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const step = p.speed * dt;
        const hitR = (p.target && !p.target.dead ? p.target.radius * 0.85 : 0.5) + 0.4;
        if (d <= step + hitR) {
          done = true;
        } else {
          p.pos.x += (dx / d) * step;
          p.pos.y += (dy / d) * step;
          p.pos.z += (dz / d) * step;
        }
      }
      if (done) {
        this.impact(p);
        this.projs.splice(i, 1);
        i--;
        continue;
      }
      // запись в InstancedMesh
      if (n < MAX_PROJ) {
        const sc = p.arc ? 1.8 : 1;
        this._s1.set(sc, sc, sc);
        this._m4.compose(p.pos, this._q, this._s1);
        this.pMesh.setMatrixAt(n, this._m4);
        if (p.arc) this._col.set(0xffd27d);
        else this._col.set(TEAM_STYLE[p.team].glow);
        this.pMesh.setColorAt(n, this._col);
        n++;
      }
    }
    this.pMesh.count = n;
    this.pMesh.instanceMatrix.needsUpdate = true;
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;

    // --- частицы ---
    for (let i = 0; i < this.pCount; i++) {
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        const last = --this.pCount;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            this.pPos[i * 3 + k] = this.pPos[last * 3 + k];
            this.pVel[i * 3 + k] = this.pVel[last * 3 + k];
            this.pBase[i * 3 + k] = this.pBase[last * 3 + k];
          }
          this.pLife[i] = this.pLife[last];
          this.pMaxL[i] = this.pMaxL[last];
          this.pGrav[i] = this.pGrav[last];
        }
        i--;
        continue;
      }
      this.pVel[i * 3 + 1] += this.pGrav[i] * dt;
      const drag = 1 - Math.min(0.9, dt * 1.6);
      this.pVel[i * 3] *= drag;
      this.pVel[i * 3 + 2] *= drag;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const a = clamp(this.pLife[i] / this.pMaxL[i], 0, 1);
      this.pCol[i * 3] = this.pBase[i * 3] * a;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * a;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * a;
    }
    this.points.geometry.setDrawRange(0, this.pCount);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // --- вспышки ---
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        const t = 1 - f.life / f.max;
        const s = f.s0 + (f.s1 - f.s0) * t;
        f.spr.scale.set(s, s, s);
        f.spr.material.opacity = Math.max(0, 0.95 * (1 - t));
        if (f.life <= 0) f.spr.visible = false;
      }
    }

    // --- кольца ---
    for (const r of this.rings) {
      if (r.life > 0) {
        r.life -= dt;
        const t = 1 - r.life / r.max;
        r.mesh.scale.setScalar(r.s0 + (r.s1 - r.s0) * t);
        r.mesh.material.opacity = Math.max(0, 0.9 * (1 - t));
        if (r.life <= 0) r.mesh.visible = false;
      }
    }
  }
}
