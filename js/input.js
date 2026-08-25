// ============================================================
//  Ввод: камера (стратегический зум), выбор, приказы
// ============================================================
import * as THREE from '../libs/three.module.js';
import { DEFS, UNIT_BOUND } from './config.js';
import { G } from './state.js';
import { clamp, smoothstep, lerp, formationOffsets } from './util.js';
import { canPlace, createBuilding, pushOrder } from './entities.js';

const PAN_KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null;      // { x0, y0, moved }
    this.mid = null;       // панорама средней кнопкой
    this.mode = null;      // 'attack' | 'patrol'
    this.lastClick = { t: 0, x: 0, y: 0, key: '' };
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._gp = new THREE.Vector3();

    const el = G.renderer.domElement;

    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('pointerdown', e => this.onPointerDown(e));
    window.addEventListener('pointermove', e => this.onPointerMove(e));
    window.addEventListener('pointerup', e => this.onPointerUp(e));
    document.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    el.addEventListener('pointerenter', () => this.mouse.inside = true);
    el.addEventListener('pointerleave', () => this.mouse.inside = false);
  }

  // ---------------- камера ----------------
  updateCamera(dt) {
    const cam = G.cam;
    if (!cam) return;

    let mx = 0, mz = 0;
    for (const code in PAN_KEYS) {
      if (this.keys.has(code)) { mx += PAN_KEYS[code][0]; mz += PAN_KEYS[code][1]; }
    }
    // панорама средней кнопкой
    if (this.mid) {
      const dx = this.mouse.x - this.mid.x, dy = this.mouse.y - this.mid.y;
      const k = cam.dist / 700;
      mx += dx * k * 2.2;
      mz += dy * k * 2.2;
    }
    // скроллинг у края экрана
    if (G.edgePan && G.started && this.mouse.inside && !G.over) {
      const m = 15, W = innerWidth, H = innerHeight;
      const sp = 1.6;
      if (this.mouse.x < m) mx -= sp;
      if (this.mouse.x > W - m) mx += sp;
      if (this.mouse.y < m) mz -= sp;
      if (this.mouse.y > H - m) mz += sp;
    }

    if (mx || mz) {
      const sp = (cam.dist * 1.15 + 10) * dt * 1.4;
      cam.target.x = clamp(cam.target.x + mx * sp, -UNIT_BOUND, UNIT_BOUND);
      cam.target.z = clamp(cam.target.z + mz * sp, -UNIT_BOUND, UNIT_BOUND);
    }
    if (this.mid) this.mid = { x: this.mouse.x, y: this.mouse.y };

    const dist = cam.dist;
    const elev = lerp(0.62, 1.45, smoothstep(26, 640, dist)); // наклон при отдалении
    const ty = G.heightAt(cam.target.x, cam.target.z);
    let px = cam.target.x, py = ty + Math.sin(elev) * dist, pz = cam.target.z + Math.cos(elev) * dist;

    if (G.shake > 0) {
      G.shake = Math.max(0, G.shake - dt * 1.2);
      const s = G.shake * G.shake * 5;
      px += (Math.random() - 0.5) * s;
      py += (Math.random() - 0.5) * s;
      pz += (Math.random() - 0.5) * s;
    }

    G.camera.position.set(px, Math.max(py, G.heightAt(px, pz) + 6), pz);
    G.camera.lookAt(cam.target.x, ty + 1.5, cam.target.z);
    G.camDist = dist;
    G.iconMode = dist > 250;
  }

  // ---------------- утилиты ----------------
  ndc() {
    this._ndc.set((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    return this._ndc;
  }

  groundPoint(out) {
    if (!out) out = this._gp;
    this.ray.setFromCamera(this.ndc(), G.camera);
    let y = 0;
    for (let i = 0; i < 3; i++) {
      this.plane.constant = -y;
      if (!this.ray.ray.intersectPlane(this.plane, out)) return false;
      y = G.heightAt(out.x, out.z);
    }
    out.y = y;
    return true;
  }

  pickEntity() {
    let best = null, bd = 1e9;
    for (const e of G.entities) {
      if (e.dead || !e._onscreen) continue;
      if (e.team === 1 && !e._vis && !e._explored) continue;
      let d = Math.hypot(e._sx - this.mouse.x, e._sy - this.mouse.y);
      if (e.team === 0) d *= 0.55; // приоритет своим
      const thr = Math.max(16, e._pr);
      if (d < thr && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------------- события ----------------
  onWheel(e) {
    e.preventDefault();
    const cam = G.cam;
    const f = Math.exp(e.deltaY * 0.00125);
    const nd = clamp(cam.dist * f, 24, 640);
    if (e.deltaY < 0) {
      // зум к курсору: точка под курсором остаётся на месте
      const before = new THREE.Vector3();
      if (this.groundPoint(before)) {
        cam.dist = nd;
        const after = new THREE.Vector3();
        if (this.groundPoint(after)) {
          cam.target.x = clamp(cam.target.x + before.x - after.x, -UNIT_BOUND, UNIT_BOUND);
          cam.target.z = clamp(cam.target.z + before.z - after.z, -UNIT_BOUND, UNIT_BOUND);
        }
      } else cam.dist = nd;
    } else {
      cam.dist = nd;
    }
  }

  onPointerDown(e) {
    if (e.button === 1) {
      this.mid = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      if (G.ui && G.ui.placement) {
        G.ui.tryPlace(e.shiftKey);
        return;
      }
      this.drag = { x0: e.clientX, y0: e.clientY, moved: false };
    }
  }

  onPointerMove(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.drag) {
      const d = Math.hypot(e.clientX - this.drag.x0, e.clientY - this.drag.y0);
      if (d > 7) this.drag.moved = true;
    }
  }

  onPointerUp(e) {
    if (e.button === 1) { this.mid = null; return; }

    if (e.button === 2) {
      if (this.mode) { this.setMode(null); return; }
      if (G.ui && G.ui.placement) { G.ui.cancelPlacement(); return; }
      this.issueCommand(e.shiftKey);
      return;
    }

    if (e.button === 0 && this.drag) {
      const drag = this.drag;
      this.drag = null;
      if (drag.moved) {
        this.boxSelect(drag.x0, drag.y0, e.clientX, e.clientY, e.shiftKey);
        return;
      }
      // одиночный клик
      if (this.mode) {
        this.modeClick(e.shiftKey);
        return;
      }
      this.clickSelect(e.shiftKey);
    }
  }

  onKeyDown(e) {
    if (e.repeat && e.code !== 'ArrowUp' && e.code !== 'ArrowDown' && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
    switch (e.code) {
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
        this.keys.add(e.code);
        e.preventDefault();
        break;
      case 'Space': {
        e.preventDefault();
        const acu = G.acu[0];
        if (acu && !acu.dead) {
          G.cam.target.set(acu.pos.x, 0, acu.pos.z);
          G.cam.dist = Math.min(G.cam.dist, 110);
        }
        break;
      }
      case 'Escape':
        if (G.ui && G.ui.placement) G.ui.cancelPlacement();
        else if (this.mode) this.setMode(null);
        else this.select([], false);
        break;
      case 'KeyA':
        if (e.ctrlKey) { this.selectAllArmy(); e.preventDefault(); }
        else if (!e.repeat && this.hasCombatSelection()) this.setMode('attack');
        break;
      case 'KeyP':
        if (!e.repeat && this.hasCombatSelection()) this.setMode('patrol');
        break;
      case 'KeyS': {
        let any = false;
        for (const u of G.selection) {
          if (u.dead || u.team !== 0 || u.def.kind !== 'unit') continue;
          u.orders = [];
          any = true;
        }
        if (any) G.sound?.click();
        break;
      }
      case 'KeyM':
        if (G.sound) {
          G.sound.init();
          const m = G.sound.toggleMute();
          G.ui?.toast(m ? 'Звук выключен' : 'Звук включён', 'info');
        }
        break;
      case 'F1':
        e.preventDefault();
        G.ui?.toggleHelp();
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': {
        const n = +e.code.slice(5) - 1;
        G.ui?.hotkey(n);
        break;
      }
    }
  }

  // ---------------- режимы (атака/патруль) ----------------
  hasCombatSelection() {
    return G.selection.some(s => !s.dead && s.team === 0 && s.def.kind === 'unit');
  }

  setMode(m) {
    this.mode = m;
    if (G.ui) G.ui.setModeHint(m);
  }

  modeClick(shift) {
    const m = this.mode;
    this.setMode(null);
    const gp = new THREE.Vector3();
    if (!this.groundPoint(gp)) return;
    const picked = this.pickEntity();

    const units = G.selection.filter(s => !s.dead && s.team === 0 && s.def.kind === 'unit');
    if (!units.length) return;

    if (m === 'attack') {
      if (picked && picked.team === 1) {
        for (const u of units) pushOrder(u, { type: 'attack', target: picked, t0: G.time }, shift);
        G.combat.marker(picked.pos.x, picked.pos.z, 0xff6a55);
      } else {
        for (const u of units) {
          pushOrder(u, {
            type: 'attackmove',
            pos: { x: gp.x + (Math.random() - 0.5) * 8, y: 0, z: gp.z + (Math.random() - 0.5) * 8 },
            target: null, t0: G.time, eta: 240,
          }, shift);
        }
        G.combat.marker(gp.x, gp.z, 0xff6a55);
      }
      G.sound?.click();
    } else if (m === 'patrol') {
      for (const u of units) {
        const pts = [u.pos.clone(), new THREE.Vector3(gp.x, 0, gp.z)];
        pushOrder(u, { type: 'patrol', pts, pi: 1, target: null, t0: G.time }, shift);
      }
      G.combat.marker(gp.x, gp.z, 0x4dc8ff);
      G.sound?.click();
    }
  }

  // ---------------- выбор ----------------
  select(list, additive) {
    const cur = additive ? G.selection.filter(s => !s.dead) : [];
    const set = new Set(cur);
    for (const s of list) if (s.team === 0 || list.length === 1) set.add(s);
    for (const s of G.selection) s.selected = false;
    const arr = [...set].filter(s => !s.dead);
    for (const s of arr) s.selected = true;
    G.selection = arr;
    if (G.ui) { G.ui.selDirty = true; G.ui.refreshPanels(); }
    if (arr.length) G.sound?.select();
  }

  selectAllArmy() {
    const list = G.units.filter(u => !u.dead && u.team === 0 && !u.def.acu);
    if (list.length) this.select(list, false);
  }

  clickSelect(shift) {
    const e = this.pickEntity();
    if (!e) { this.select([], false); return; }

    // двойной клик — выбрать всех таких же на экране
    const now = performance.now();
    const dbl = now - this.lastClick.t < 350 &&
      Math.hypot(this.mouse.x - this.lastClick.x, this.mouse.y - this.lastClick.y) < 8 &&
      this.lastClick.key === e.defKey &&
      e.team === 0 && e.def.kind === 'unit';
    this.lastClick = { t: now, x: this.mouse.x, y: this.mouse.y, key: e.defKey };

    if (dbl) {
      const list = G.units.filter(u => !u.dead && u.team === 0 && u.defKey === e.defKey && u._onscreen);
      this.select(list, false);
    } else {
      this.select([e], shift);
    }
  }

  boxSelect(x0, y0, x1, y1, shift) {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
    const list = G.units.filter(u =>
      !u.dead && u.team === 0 && u._onscreen &&
      u._sx >= xa && u._sx <= xb && u._sy >= ya && u._sy <= yb);
    if (list.length) this.select(list, shift);
    else if (!shift) this.select([], false);
  }

  // ---------------- приказы (ПКМ) ----------------
  issueCommand(shift) {
    const sel = G.selection.filter(s => !s.dead);
    const units = sel.filter(s => s.team === 0 && s.def.kind === 'unit');
    const gp = new THREE.Vector3();
    const hasGround = this.groundPoint(gp);
    const picked = this.pickEntity();

    if (units.length) {
      // атака врага
      const attackable = picked && picked.team === 1 && (picked._vis || (picked.def.kind === 'building' && picked._explored));
      if (attackable) {
        for (const u of units) pushOrder(u, { type: 'attack', target: picked, t0: G.time }, shift);
        G.combat.marker(picked.pos.x, picked.pos.z, 0xff6a55);
        G.sound?.click();
        return;
      }
      // ACU строит недостроенное своё здание
      const acu = units.find(u => u.def.acu);
      if (acu && picked && picked.team === 0 && picked.def.kind === 'building' && picked.progress < 1) {
        pushOrder(acu, { type: 'build', target: picked, t0: G.time }, shift);
        G.combat.marker(picked.pos.x, picked.pos.z, 0x4dc8ff);
        G.sound?.click();
        return;
      }
      // движение строем
      if (hasGround) {
        const sorted = [...units].sort((a, b) =>
          Math.hypot(a.pos.x - gp.x, a.pos.z - gp.z) - Math.hypot(b.pos.x - gp.x, b.pos.z - gp.z));
        const offs = formationOffsets(sorted.length, 5.5);
        sorted.forEach((u, i) => {
          const off = offs[i] || [0, 0];
          const dest = { x: gp.x + off[0], y: 0, z: gp.z + off[1] };
          const d = Math.hypot(dest.x - u.pos.x, dest.z - u.pos.z);
          pushOrder(u, { type: 'move', pos: dest, t0: G.time, eta: d / u.def.speed * 2.5 + 6 }, shift);
        });
        G.combat.marker(gp.x, gp.z, 0x4dffa0);
        G.sound?.click();
      }
      return;
    }

    // точка сбора завода
    if (sel.length === 1 && sel[0].team === 0 && sel[0].def.factory && hasGround) {
      sel[0].rally = { x: gp.x, z: gp.z };
      G.combat.marker(gp.x, gp.z, 0x4dc8ff);
      G.sound?.click();
    }
  }
}
