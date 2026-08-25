// ============================================================
//  Интерфейс: HUD, иконки, миникарта, меню строительства
// ============================================================
import * as THREE from '../libs/three.module.js';
import { DEFS, BUILD_MENU, PROD_MENU, TEAM_STYLE, DIFFICULTIES, MAP_SIZE, HALF_MAP, UNIT_CAP, ICON_DIST } from './config.js';
import { G } from './state.js';
import { clamp, fmtTime } from './util.js';
import { canPlace, createBuilding, pushOrder, buildEntityMesh } from './entities.js';
import { terrainMiniColor } from './world.js';

const $ = id => document.getElementById(id);

export class UI {
  constructor() {
    this.ov = $('overlay');
    this.octx = this.ov.getContext('2d');
    this.mm = $('minimap');
    this.mctx = this.mm.getContext('2d');
    this.selDirty = true;
    this.panelT = 0;
    this.hudT = 0;
    this.mmT = 0;
    this.lastPingT = -99;
    this.placement = null;   // { defKey, group, bodyMat, glowMat, rangeLine, valid, reason }
    this.modeHint = null;
    this.toasts = [];
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this.buildMiniBase();
    this.buildButtons();
    this.wireScreens();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.ov.width = Math.floor(innerWidth * dpr);
    this.ov.height = Math.floor(innerHeight * dpr);
    this.ov.style.width = innerWidth + 'px';
    this.ov.style.height = innerHeight + 'px';
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------
  //  Миникарта: базовая картинка местности
  // ------------------------------------------------------------
  buildMiniBase() {
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(192, 192);
    for (let py = 0; py < 192; py++) {
      for (let px = 0; px < 192; px++) {
        const x = (px / 191 - 0.5) * MAP_SIZE;
        const z = (py / 191 - 0.5) * MAP_SIZE;
        const h = G.heightAt(x, z);
        const [r, g, b] = terrainMiniColor(h, x, z);
        const i = (py * 192 + px) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.miniBase = c;

    // ввод на миникарте
    let down = false;
    const toWorld = e => {
      const r = this.mm.getBoundingClientRect();
      const px = clamp((e.clientX - r.left) / r.width, 0, 1);
      const py = clamp((e.clientY - r.top) / r.height, 0, 1);
      return { x: (px - 0.5) * MAP_SIZE, z: (py - 0.5) * MAP_SIZE };
    };
    this.mm.addEventListener('pointerdown', e => {
      down = true;
      const w = toWorld(e);
      G.cam.target.set(clamp(w.x, -300, 300), 0, clamp(w.z, -300, 300));
      e.preventDefault();
    });
    window.addEventListener('pointermove', e => {
      if (down) {
        const w = toWorld(e);
        G.cam.target.set(clamp(w.x, -300, 300), 0, clamp(w.z, -300, 300));
      }
    });
    window.addEventListener('pointerup', () => down = false);
  }

  // ------------------------------------------------------------
  //  Кнопки строительства / производства
  // ------------------------------------------------------------
  buildButtons() {
    const buildWrap = $('buildButtons');
    this.buildBtns = {};
    for (const key of BUILD_MENU) {
      const d = DEFS[key];
      const btn = document.createElement('button');
      btn.className = 'cmd-btn';
      btn.title = d.desc;
      btn.innerHTML = `<span class="hk">${d.hotkey}</span><span class="nm">${d.name}</span>
        <span class="cost"><b class="m">${d.cost.m}</b><b class="e">${d.cost.e}</b></span>`;
      btn.addEventListener('click', () => { this.startPlacement(key); G.sound?.click(); });
      buildWrap.appendChild(btn);
      this.buildBtns[key] = btn;
    }

    const prodWrap = $('prodButtons');
    this.prodBtns = {};
    for (const key of PROD_MENU) {
      const d = DEFS[key];
      const btn = document.createElement('button');
      btn.className = 'cmd-btn';
      btn.title = d.desc;
      btn.innerHTML = `<span class="hk">${d.hotkey}</span><span class="nm">${d.name}</span>
        <span class="cost"><b class="m">${d.cost.m}</b><b class="e">${d.cost.e}</b></span>`;
      btn.addEventListener('click', () => { this.enqueue(key); G.sound?.click(); });
      prodWrap.appendChild(btn);
      this.prodBtns[key] = btn;
    }
    $('clearQueue').addEventListener('click', () => {
      for (const s of G.selection) {
        if (s.team === 0 && s.def.factory) { s.queue = []; s.progressUnit = 0; }
      }
      this.selDirty = true;
      G.sound?.click();
    });
  }

  wireScreens() {
    // выбор сложности
    this.diff = 'normal';
    document.querySelectorAll('.diffBtn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.diffBtn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.diff = b.dataset.diff;
        G.sound?.init();
        G.sound?.click();
      });
    });
    $('startBtn').addEventListener('click', () => {
      G.sound?.init();
      G.sound?.click();
      $('startScreen').style.display = 'none';
      $('loading').style.display = 'none';
      G.difficulty = this.diff;
      G.started = true;
      this.toast('Стройте экстракторы на залежах массы (зелёные кристаллы)', 'info', 6000);
      this.toast('Цель: уничтожить вражеского Командира', 'info', 6000);
    });
    $('restartBtn').addEventListener('click', () => location.reload());
    $('helpBtn').addEventListener('click', () => this.toggleHelp());
    $('closeHelp').addEventListener('click', () => this.toggleHelp());
    $('muteBtn').addEventListener('click', () => {
      G.sound?.init();
      const m = G.sound?.toggleMute();
      $('muteBtn').textContent = m ? '🔇' : '🔊';
    });
    $('edgeBtn').addEventListener('click', () => {
      G.edgePan = !G.edgePan;
      $('edgeBtn').classList.toggle('off', !G.edgePan);
      this.toast(G.edgePan ? 'Скроллинг у края экрана: вкл' : 'Скроллинг у края экрана: выкл', 'info');
    });
  }

  toggleHelp() {
    const h = $('helpOverlay');
    h.style.display = h.style.display === 'flex' ? 'none' : 'flex';
  }

  // ------------------------------------------------------------
  //  Сообщения и пинги
  // ------------------------------------------------------------
  toast(msg, type = 'info', dur = 3500) {
    const box = $('toasts');
    if (box.childElementCount > 5) box.removeChild(box.firstChild);
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('fade'); }, dur - 600);
    setTimeout(() => { el.remove(); }, dur);
  }

  ping(x, z, color) {
    if (G.time - this.lastPingT < 4) return;
    this.lastPingT = G.time;
    G.pings.push({ x, z, t: G.time, color: color || '#ff5040' });
  }

  setModeHint(m) {
    this.modeHint = m;
    const el = $('cursorHint');
    if (!m) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = m === 'attack' ? 'АТАКА-МАРШ · ЛКМ — точка/цель · ПКМ — отмена' : 'ПАТРУЛЬ · ЛКМ — точка · ПКМ — отмена';
  }

  // ------------------------------------------------------------
  //  Размещение зданий
  // ------------------------------------------------------------
  startPlacement(defKey) {
    this.cancelPlacement();
    if (G.input && G.input.mode) G.input.setMode(null);
    const bodyMat = G.matBody.clone();
    bodyMat.transparent = true;
    bodyMat.opacity = 0.55;
    bodyMat.depthWrite = false;
    const glowMat = G.matGlow.clone();
    glowMat.transparent = true;
    glowMat.opacity = 0.55;
    glowMat.depthWrite = false;

    const group = buildGhostMesh(defKey, 0, bodyMat, glowMat);

    // круг дальности для турели
    let rangeLine = null;
    const d = DEFS[defKey];
    if (d.weapon) {
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * d.weapon.range, 0.4, Math.sin(a) * d.weapon.range));
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      rangeLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x4dffa0, transparent: true, opacity: 0.5 }));
      group.add(rangeLine);
    }
    G.scene.add(group);
    this.placement = { defKey, group, bodyMat, glowMat, rangeLine, valid: false, reason: '', gx: 0, gz: 0 };
  }

  cancelPlacement() {
    if (!this.placement) return;
    G.scene.remove(this.placement.group);
    this.placement = null;
    const el = $('cursorHint');
    if (!this.modeHint) el.style.display = 'none';
  }

  updateGhost() {
    const pl = this.placement;
    if (!pl) return;
    const gp = new THREE.Vector3();
    if (!G.input.groundPoint(gp)) return;
    const r = canPlace(pl.defKey, gp.x, gp.z, 0);
    pl.valid = r.ok;
    pl.reason = r.reason || '';
    pl.gx = r.ok ? r.x : gp.x;
    pl.gz = r.ok ? r.z : gp.z;
    const y = G.heightAt(pl.gx, pl.gz);
    pl.group.position.set(pl.gx, y, pl.gz);
    const tint = r.ok ? 0x86ffbe : 0xff9d8c;
    pl.bodyMat.color.set(tint);
    pl.glowMat.color.set(tint);

    // подсказка у курсора
    const el = $('cursorHint');
    el.style.display = 'block';
    el.textContent = r.ok ? `${DEFS[pl.defKey].name} · ЛКМ — построить · ПКМ/ESC — отмена` : `${r.reason} · ПКМ/ESC — отмена`;
    el.style.left = (G.input.mouse.x + 18) + 'px';
    el.style.top = (G.input.mouse.y + 22) + 'px';
    el.classList.toggle('bad', !r.ok);
  }

  tryPlace(shift) {
    const pl = this.placement;
    if (!pl) return;
    const gp = new THREE.Vector3();
    if (!G.input.groundPoint(gp)) return;
    const r = canPlace(pl.defKey, gp.x, gp.z, 0);
    if (!r.ok) {
      this.toast(r.reason, 'err');
      G.sound?.error();
      return;
    }
    const b = createBuilding(pl.defKey, 0, r.x, r.z);
    if (!b) { this.toast('Не удалось разместить здание', 'err'); return; }
    const acu = G.acu[0];
    if (acu && !acu.dead) {
      pushOrder(acu, { type: 'build', target: b, t0: G.time }, false);
    }
    G.sound?.place();
    this.toast(`${DEFS[pl.defKey].name}: ACU начал строительство`, 'info', 2200);
    if (!shift) this.cancelPlacement();
  }

  // ------------------------------------------------------------
  //  Производство
  // ------------------------------------------------------------
  enqueue(key) {
    for (const s of G.selection) {
      if (s.team === 0 && !s.dead && s.def.factory && s.progress >= 1) {
        if (s.queue.length < 25) {
          s.queue.push(key);
          this.selDirty = true;
        }
      }
    }
  }

  hotkey(n) {
    // цифры: строительство (ACU) или производство (завод)
    const acuSel = G.selection.some(s => s.team === 0 && !s.dead && s.def.acu);
    const facSel = G.selection.some(s => s.team === 0 && !s.dead && s.def.factory);
    if (acuSel && BUILD_MENU[n]) { this.startPlacement(BUILD_MENU[n]); G.sound?.click(); }
    else if (facSel && PROD_MENU[n]) { this.enqueue(PROD_MENU[n]); G.sound?.click(); }
  }

  refreshPanels() { this.selDirty = true; }

  // ------------------------------------------------------------
  //  Главный апдейт
  // ------------------------------------------------------------
  update(dt) {
    this.updateGhost();

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.15;
      this.updateTopbar();
    }

    this.panelT -= dt;
    if (this.panelT <= 0 || this.selDirty) {
      this.panelT = 0.3;
      this.selDirty = false;
      this.updatePanels();
    }

    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.12;
      this.updateMinimap();
    }

    this.drawOverlay();
  }

  updateTopbar() {
    const T = G.teams[0];
    $('massVal').textContent = Math.floor(T.mass);
    $('massRate').textContent = (T.massIncome - (T.massDrain || 0)).toFixed(1) + '/с';
    $('massFill').style.width = clamp(T.mass / T.massCap * 100, 0, 100) + '%';
    $('massRate').className = (T.massIncome - (T.massDrain || 0)) >= 0 ? 'rate plus' : 'rate minus';
    $('enVal').textContent = Math.floor(T.energy);
    $('enRate').textContent = (T.energyIncome - (T.energyDrain || 0)).toFixed(1) + '/с';
    $('enFill').style.width = clamp(T.energy / T.energyCap * 100, 0, 100) + '%';
    $('enRate').className = (T.energyIncome - (T.energyDrain || 0)) >= 0 ? 'rate plus' : 'rate minus';
    $('clock').textContent = fmtTime(G.time);
    $('unitCount').textContent = `Юниты ${G.teams[0].unitCount}/${UNIT_CAP}`;
    $('diffLabel').textContent = (DIFFICULTIES[G.difficulty] || DIFFICULTIES.normal).name;
  }

  updatePanels() {
    const sel = G.selection.filter(s => !s.dead);
    const acuSel = sel.some(s => s.team === 0 && s.def.acu);
    const facSel = sel.filter(s => s.team === 0 && s.def.factory);

    $('buildMenu').style.display = acuSel ? 'flex' : 'none';
    $('prodMenu').style.display = facSel.length ? 'flex' : 'none';
    const T = G.teams[0];
    for (const key of BUILD_MENU) {
      const d = DEFS[key];
      this.buildBtns[key].classList.toggle('poor', T.mass < d.cost.m * 0.35 || T.energy < d.cost.e * 0.35);
    }
    for (const key of PROD_MENU) {
      const d = DEFS[key];
      this.prodBtns[key].classList.toggle('poor', T.mass < d.cost.m * 0.35 || T.energy < d.cost.e * 0.35);
    }

    // очередь завода
    const q = $('queueInfo');
    if (facSel.length === 1) {
      const f = facSel[0];
      const cur = f.queue.length ? DEFS[f.queue[0]] : null;
      const pct = Math.floor(f.progressUnit * 100);
      q.style.display = 'block';
      q.innerHTML = cur
        ? `<div class="qtitle">Производится: ${cur.name} · ${pct}%</div>
           <div class="qbar"><div style="width:${pct}%"></div></div>
           <div class="qcount">В очереди: ${f.queue.length}</div>`
        : '<div class="qtitle">Очередь пуста</div>';
    } else {
      q.style.display = 'none';
    }

    // панель выделения
    const sp = $('selPanel');
    if (!sel.length) {
      sp.innerHTML = '<div class="hint">ЛКМ — выбор · рамка — группа · ПКМ — приказ<br>A — атака-марш · P — патруль · колесо — зум</div>';
      return;
    }
    // группировка
    const groups = new Map();
    for (const s of sel) {
      if (!groups.has(s.defKey)) groups.set(s.defKey, []);
      groups.get(s.defKey).push(s);
    }
    let html = '';
    if (sel.length === 1) {
      const e = sel[0];
      const pct = clamp(e.hp / e.def.hp * 100, 0, 100);
      let extra = '';
      if (e.def.kind === 'building' && e.progress < 1) {
        extra = `<div class="qtitle" style="color:#4dc8ff">Строится · ${Math.floor(e.progress * 100)}%</div>
          <div class="qbar"><div style="width:${e.progress * 100}%"></div></div>`;
      } else if (e.def.income && e.progress >= 1) {
        const inc = [];
        if (e.def.income.m) inc.push(`+${e.def.income.m} массы/с`);
        if (e.def.income.e) inc.push(`+${e.def.income.e} энергии/с`);
        extra = `<div class="qtitle" style="color:#7dff8a">${inc.join(' · ')}</div>`;
      } else if (e.def.factory) {
        extra = `<div class="qtitle">Очередь: ${e.queue.length} · ПКМ по земле — точка сбора</div>`;
      } else if (e.def.acu) {
        extra = `<div class="qtitle">Строит здания · 1–4 — горячие клавиши</div>`;
      }
      const st = e.team === 0 ? TEAM_STYLE[0].name : TEAM_STYLE[1].name;
      html = `<div class="sel-row">
        <div class="sel-name">${e.def.name} <span class="fac">${st}</span></div>
        ${extra}
        <div class="hpbar"><div style="width:${pct}%; background:${pct > 55 ? '#4dffa0' : pct > 25 ? '#ffd24d' : '#ff5a48'}"></div></div>
        <div class="hptext">${Math.ceil(e.hp)} / ${e.def.hp}</div>
      </div>`;
    } else {
      for (const [key, list] of groups) {
        const d = DEFS[key];
        const hp = list.reduce((a, x) => a + x.hp / x.def.hp, 0) / list.length * 100;
        html += `<div class="sel-row small">
          <span class="sel-name">${d.name} <b>×${list.length}</b></span>
          <div class="hpbar"><div style="width:${hp}%; background:${hp > 55 ? '#4dffa0' : hp > 25 ? '#ffd24d' : '#ff5a48'}"></div></div>
        </div>`;
      }
    }
    sp.innerHTML = html;
  }

  // ------------------------------------------------------------
  //  Миникарта
  // ------------------------------------------------------------
  updateMinimap() {
    const ctx = this.mctx;
    const W = this.mm.width, H = this.mm.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.miniBase, 0, 0, W, H);

    // туман
    if (G.fog) {
      ctx.drawImage(G.fog.canvas, 0, 0, W, H);
    }

    const toMM = (x, z) => [(x / MAP_SIZE + 0.5) * W, (z / MAP_SIZE + 0.5) * H];

    // залежи массы
    ctx.fillStyle = '#59ff85';
    for (const p of G.massPoints) {
      if (!p.building) {
        const [mx, my] = toMM(p.x, p.z);
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }

    // сущности
    for (const e of G.entities) {
      if (e.dead) continue;
      if (e.team === 1 && !e._vis && !e._explored) continue;
      const [mx, my] = toMM(e.pos.x, e.pos.z);
      if (e.def.acu) {
        ctx.fillStyle = e.team === 0 ? '#8dffc8' : '#ff9a7a';
        ctx.fillRect(mx - 3, my - 3, 6, 6);
      } else if (e.def.kind === 'building') {
        ctx.fillStyle = e.team === 0 ? '#3dc88a' : '#d8563f';
        const s = e.def.size.w / MAP_SIZE * W * 0.9;
        ctx.fillRect(mx - s / 2, my - s / 2, s, s);
      } else {
        ctx.fillStyle = e.team === 0 ? '#4dffa0' : '#ff6a55';
        ctx.fillRect(mx - 1.2, my - 1.2, 2.4, 2.4);
      }
    }

    // пинги
    for (const p of G.pings) {
      const age = G.time - p.t;
      if (age > 2) continue;
      const [mx, my] = toMM(p.x, p.z);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - age / 2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 3 + age * 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    G.pings = G.pings.filter(p => G.time - p.t <= 2);

    // рамка камеры
    if (G.camera) {
      const pts = [];
      for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        this._v.set(nx, ny, 0.5).unproject(G.camera);
        const dir = this._v.sub(G.camera.position);
        const t = (2 - G.camera.position.y) / dir.y;
        const px = G.camera.position.x + dir.x * t;
        const pz = G.camera.position.z + dir.z * t;
        pts.push(toMM(px, pz));
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------
  //  Оверлей: иконки, полоски HP, выделение
  // ------------------------------------------------------------
  drawOverlay() {
    const ctx = this.octx;
    const W = innerWidth, H = innerHeight;
    ctx.clearRect(0, 0, W, H);
    if (!G.camera) return;

    G.camera.updateMatrixWorld();
    this._right.setFromMatrixColumn(G.camera.matrixWorld, 0);
    const cam = G.camera;
    const mwi = cam.matrixWorldInverse;

    const project = (x, y, z) => {
      this._v.set(x, y, z).applyMatrix4(mwi);
      if (this._v.z > -1) return null;
      this._v.applyMatrix4(cam.projectionMatrix);
      return [(this._v.x * 0.5 + 0.5) * W, (-this._v.y * 0.5 + 0.5) * H];
    };

    for (const e of G.entities) {
      if (e.dead) { e._onscreen = false; continue; }
      const p = project(e.pos.x, e.pos.y + e.def.height * 0.55, e.pos.z);
      if (!p || p[0] < -80 || p[0] > W + 80 || p[1] < -80 || p[1] > H + 80) {
        e._onscreen = false;
        continue;
      }
      e._onscreen = true;
      e._sx = p[0]; e._sy = p[1];

      // проекционный радиус
      const pr = project(e.pos.x + this._right.x * e.radius, e.pos.y, e.pos.z + this._right.z * e.radius);
      e._pr = pr ? Math.max(10, Math.abs(pr[0] - p[0]) + 6) : 14;
    }

    const icons = G.iconMode;
    const style = TEAM_STYLE;

    for (const e of G.entities) {
      if (e.dead || !e._onscreen) continue;
      if (e.team === 1 && !e._vis && !e._explored) continue;

      const col = style[e.team].icon;
      const x = e._sx, y = e._sy;

      if (icons) {
        // стратегические иконки
        drawIcon(ctx, e, x, y, col, e.selected);
        if (e.hp < e.def.hp * 0.995 || e.selected) {
          const bw = 22;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x - bw / 2 - 1, y + 8, bw + 2, 4);
          ctx.fillStyle = e.hp / e.def.hp > 0.55 ? '#4dffa0' : e.hp / e.def.hp > 0.25 ? '#ffd24d' : '#ff5a48';
          ctx.fillRect(x - bw / 2, y + 9, bw * clamp(e.hp / e.def.hp, 0, 1), 2);
        }
        if (e.def.kind === 'building' && e.progress < 1) {
          ctx.fillStyle = '#4dc8ff';
          ctx.fillRect(x - 10, y + 14, 20 * e.progress, 2);
        }
      } else {
        // выделение — эллипс
        if (e.selected) {
          const rx = e._pr * 1.1;
          ctx.strokeStyle = e.team === 0 ? 'rgba(90,255,170,0.9)' : 'rgba(255,120,90,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(x, y + e._pr * 0.28, rx, rx * 0.4, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        // полоска HP
        if (e.hp < e.def.hp * 0.995 || e.selected) {
          const bw = e.def.kind === 'building' ? 34 : 24;
          const pct = clamp(e.hp / e.def.hp, 0, 1);
          const by = y - e.def.height * 6 - 6;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, 5);
          ctx.fillStyle = pct > 0.55 ? '#4dffa0' : pct > 0.25 ? '#ffd24d' : '#ff5a48';
          ctx.fillRect(x - bw / 2, by, bw * pct, 3);
        }
        // прогресс стройки
        if (e.def.kind === 'building' && e.progress < 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(x - 18, y + 10, 36, 5);
          ctx.fillStyle = '#4dc8ff';
          ctx.fillRect(x - 17, y + 11, 34 * e.progress, 3);
        }
      }
    }

    // рамка выделения
    const d = G.input && G.input.drag;
    if (d && d.moved) {
      ctx.strokeStyle = 'rgba(90,255,170,0.9)';
      ctx.fillStyle = 'rgba(90,255,170,0.08)';
      ctx.lineWidth = 1.5;
      const xa = Math.min(d.x0, G.input.mouse.x), ya = Math.min(d.y0, G.input.mouse.y);
      const xb = Math.max(d.x0, G.input.mouse.x), yb = Math.max(d.y0, G.input.mouse.y);
      ctx.fillRect(xa, ya, xb - xa, yb - ya);
      ctx.strokeRect(xa, ya, xb - xa, yb - ya);
    }

    // подсказка режима у курсора
    if (this.modeHint && G.input) {
      const el = $('cursorHint');
      el.style.left = (G.input.mouse.x + 18) + 'px';
      el.style.top = (G.input.mouse.y + 22) + 'px';
    }

    // индикатор зума
    if (G.camDist > ICON_DIST - 30 && G.camDist < ICON_DIST + 30) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('стратегический вид', W / 2, 30);
    }
  }

  // ------------------------------------------------------------
  showEnd(winner) {
    const win = winner === 0;
    $('endTitle').textContent = win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    $('endTitle').className = win ? 'win' : 'lose';
    const s = G.stats[0];
    $('endStats').innerHTML = `
      <div>Время партии: <b>${fmtTime(G.time)}</b></div>
      <div>Уничтожено врагов: <b>${s.kills}</b></div>
      <div>Потери: <b>${s.lost}</b></div>
      <div>Произведено юнитов: <b>${s.built}</b></div>`;
    $('endScreen').style.display = 'flex';
  }
}

// ------------------------------------------------------------
//  Стратегические иконки (в стиле SupCom)
// ------------------------------------------------------------
function drawIcon(ctx, e, x, y, color, selected) {
  const k = e.defKey;
  ctx.lineWidth = selected ? 2.2 : 1.4;
  ctx.strokeStyle = selected ? '#ffffff' : color;
  ctx.fillStyle = color;

  if (k === 'acu') {
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  } else if (k === 'tank' || k === 'heavy') {
    const r = k === 'heavy' ? 8 : 6;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.85); ctx.lineTo(x - r, y + r * 0.85);
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  } else if (k === 'arty') {
    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  } else if (k === 'turret') {
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  } else {
    // здания — квадраты
    const s = k === 'factory' ? 8 : 6;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x - s, y - s, s * 2, s * 2);
    ctx.globalAlpha = 1;
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    if (k === 'factory') {
      ctx.fillStyle = '#0a0f14';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.fillStyle = color;
    } else if (k === 'extractor') {
      ctx.fillStyle = '#0a0f14';
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
    }
  }
}

// меш-призрак с подменой материалов на полупрозрачные
function buildGhostMesh(defKey, team, bodyMat, glowMat) {
  const built = buildEntityMesh(defKey, team);
  built.group.traverse(o => {
    if (o.isMesh) {
      o.material = o.material === G.matGlow ? glowMat : bodyMat;
      o.castShadow = false;
    }
  });
  return built.group;
}
