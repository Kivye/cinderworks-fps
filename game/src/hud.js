// hud.js — DOM HUD: health/armour/ammo/timer/score/money, live minimap (canvas 2D
// drawn from the real colliders + waypoints), killfeed, comms, hurt-direction arc,
// buy menu, round banner, match-end scoreboard. No canvas textures, plain DOM.
import { WEAPONS, GRENADE, ARMOUR_PRICE, WEAPON_ORDER } from './state.js';

export class Hud {
  constructor(root, world) {
    this.world = world;
    this.el = {};
    const mk = (tag, id, cls, parent) => {
      const e = document.createElement(tag);
      if (id) e.id = id;
      if (cls) e.className = cls;
      (parent || root).appendChild(e);
      return e;
    };
    const css = document.createElement('style');
    css.textContent = `
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:#0a0e14;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#fff;user-select:none}
      #hud{position:fixed;inset:0;pointer-events:none;z-index:5}
      .panel{background:rgba(8,12,18,.62);border:1px solid rgba(255,255,255,.16);border-radius:6px;padding:6px 10px}
      #topleft{position:absolute;top:12px;left:12px;display:flex;gap:10px;align-items:flex-start}
      #minimap{width:190px;height:150px;border:1px solid rgba(255,255,255,.35);border-radius:6px;background:rgba(10,14,20,.78)}
      #roundbox{font-size:15px;line-height:1.5}
      #roundbox b{font-size:19px}
      #killfeed{position:absolute;top:12px;right:12px;width:300px;text-align:right;font-size:14px;line-height:1.6;text-shadow:0 1px 3px #000}
      #killfeed div{margin-bottom:2px}
      #comms{position:absolute;left:12px;bottom:170px;width:340px;font-size:13px;line-height:1.5;text-shadow:0 1px 3px #000;color:#cfe6ff}
      #bottom{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;display:flex;gap:12px;align-items:flex-end}
      #hpbox{font-size:17px;line-height:1.4;min-width:150px}
      #hpbox b{font-size:26px}
      #ammobox{font-size:17px;text-align:right;min-width:120px}
      #ammobox b{font-size:30px}
      #slots{display:flex;gap:6px}
      #slots span{padding:4px 8px;border:1px solid rgba(255,255,255,.25);border-radius:4px;background:rgba(8,12,18,.6);font-size:13px}
      #slots span.on{border-color:#ffb020;color:#ffd47a}
      #cross{position:absolute;left:50%;top:50%;width:22px;height:22px;transform:translate(-50%,-50%)}
      #cross:before,#cross:after{content:'';position:absolute;background:#fff;box-shadow:0 0 3px #000}
      #cross:before{left:10px;top:0;width:2px;height:22px}
      #cross:after{top:10px;left:0;width:22px;height:2px}
      #hurt{position:absolute;left:50%;top:50%;width:220px;height:220px;transform:translate(-50%,-50%);opacity:0}
      #banner{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:42px;font-weight:bold;text-shadow:0 2px 10px #000;text-align:center}
      #banner small{display:block;font-size:17px;font-weight:normal;margin-top:6px}
      #plantbar{position:absolute;left:50%;top:58%;transform:translateX(-50%);width:280px;display:none;text-align:center}
      #plantbar .bar{height:12px;border:1px solid #fff;background:#222;border-radius:6px;overflow:hidden}
      #plantbar .fill{height:100%;background:#ffb020;width:0%}
      #buymenu{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:460px;background:rgba(8,14,22,.94);border:1px solid #ffb020;border-radius:8px;padding:16px;pointer-events:auto;display:none;z-index:9}
      #buymenu h2{color:#ffb020;font-size:19px;margin-bottom:8px}
      #buymenu .row{display:flex;justify-content:space-between;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.12);font-size:15px;cursor:pointer}
      #buymenu .row:hover{background:rgba(255,176,32,.18)}
      #buymenu .row.afford{color:#fff}
      #buymenu .row.poor{color:#888}
      #buymenu .hint{margin-top:10px;font-size:13px;color:#9fb4cc}
      #scoreboard{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:520px;background:rgba(8,14,22,.95);border:1px solid #fff;border-radius:8px;padding:18px;display:none;pointer-events:auto;z-index:9}
      #scoreboard h2{font-size:21px;margin-bottom:10px;text-align:center}
      #scoreboard table{width:100%;border-collapse:collapse;font-size:15px}
      #scoreboard td,#scoreboard th{padding:5px 8px;text-align:left;border-bottom:1px solid rgba(255,255,255,.14)}
      #help{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);font-size:13px;color:#cfe0f2;text-shadow:0 1px 3px #000;text-align:center}
      #vign{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 120px rgba(255,0,0,0);z-index:4}
      #start{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(6,10,16,.72);z-index:20;pointer-events:auto;cursor:pointer}
      #start h1{font-size:44px;color:#ffb020;letter-spacing:2px}
      #start p{font-size:16px;margin-top:12px;color:#dfe9f5;max-width:560px;text-align:center;line-height:1.6}
    `;
    document.head.appendChild(css);
    const hud = mk('div', 'hud');
    const tl = mk('div', 'topleft', '', hud);
    this.mapCanvas = mk('canvas', 'minimap', '', tl);
    this.mapCanvas.width = 190; this.mapCanvas.height = 150;
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.el.round = mk('div', 'roundbox', 'panel', tl);
    this.el.feed = mk('div', 'killfeed', '', hud);
    this.el.comms = mk('div', 'comms', '', hud);
    this.el.help = mk('div', 'help', '', hud);
    this.el.help.textContent = 'WASD gerak · Mouse aim · Klik tembak · R reload · E plant/defuse/pickup · G grenade · B buy · Ctrl crouch · Shift jalan pelan · Tab scoreboard';
    const bottom = mk('div', 'bottom', '', hud);
    this.el.hp = mk('div', 'hpbox', 'panel', bottom);
    this.el.slots = mk('div', 'slots', '', bottom);
    this.el.ammo = mk('div', 'ammobox', 'panel', bottom);
    mk('div', 'cross', '', hud);
    this.el.hurt = mk('canvas', 'hurt', '', hud);
    this.el.hurt.width = 220; this.el.hurt.height = 220;
    this.el.banner = mk('div', 'banner', '', hud);
    const pb = mk('div', 'plantbar', '', hud);
    pb.innerHTML = '<div class="lbl">PLANTING…</div><div class="bar"><div class="fill"></div></div>';
    this.el.plantbar = pb;
    this.el.plantFill = pb.querySelector('.fill');
    this.el.plantLbl = pb.querySelector('.lbl');
    // Buy menu
    const buy = mk('div', 'buymenu', '', hud);
    buy.innerHTML = '<h2>BUY MENU — tekan 1-5 / G grenade / klik, B atau Esc tutup</h2><div class="list"></div><div class="hint"></div>';
    this.el.buy = buy; this.el.buyList = buy.querySelector('.list'); this.el.buyHint = buy.querySelector('.hint');
    // Scoreboard
    const sb = mk('div', 'scoreboard', '', hud);
    sb.innerHTML = '<h2>SCOREBOARD</h2><table><tr><th>Player</th><th>Team</th><th>K</th><th>D</th><th>Role</th></tr></table><div class="foot" style="margin-top:10px;text-align:center;color:#9fb4cc"></div>';
    this.el.scoreboard = sb; this.el.sbTable = sb.querySelector('table'); this.el.sbFoot = sb.querySelector('.foot');
    const vig = mk('div', 'vign', '', document.body);
    this.el.vign = vig;
    const start = mk('div', 'start', '', document.body);
    start.innerHTML = '<h1>CINDERWORKS</h1><p>Foundry-yard tactical FPS — 5v5. Plant the charge at Furnace (A) or Crane Dock (B), or eliminate the defenders. Buy between rounds. Click to play.</p><p style="color:#ffb020">Klik untuk mulai — mouse terkunci, ESC lepas</p>';
    this.el.start = start;
    this.feedItems = [];
    this.hurtT = 0; this.hurtAngle = 0;
  }

  setRound(round, score, timer, phase, money) {
    const mm = Math.floor(Math.max(0, timer) / 60);
    const ss = Math.floor(Math.max(0, timer) % 60).toString().padStart(2, '0');
    const ph = phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'ROUND LIVE' : phase === 'end' ? 'ROUND OVER' : 'MATCH OVER';
    this.el.round.innerHTML = `<b>EMBER ${score[0]} — ${score[1]} ASH</b><br>Round ${round} · ${mm}:${ss} · ${ph}<br>💰 $${money}`;
  }
  setPlayer(hp, armour, ammo, reserve, weaponId, slots, grenades) {
    this.el.hp.innerHTML = `❤ <b>${Math.max(0, Math.ceil(hp))}</b> HP &nbsp; 🛡 ${armour ? 'ARMOUR' : '—'}`;
    const w = WEAPONS[weaponId];
    this.el.ammo.innerHTML = `<b>${ammo}</b> / ${reserve} &nbsp; ${w.name}<br>💣 frag ${grenades.frag} · smoke ${grenades.smoke}`;
    this.el.slots.innerHTML = slots.map((s) => `<span class="${s.id === weaponId ? 'on' : ''}">${s.key} ${s.name}</span>`).join('');
  }
  pushFeed(html) {
    this.feedItems.unshift(html);
    if (this.feedItems.length > 5) this.feedItems.pop();
    this.el.feed.innerHTML = this.feedItems.map((f) => `<div>${f}</div>`).join('');
  }
  pushComms(text, team) {
    const el = document.createElement('div');
    el.textContent = (team === 0 ? '[TEAM] ' : '[ENEMY] ') + text;
    this.el.comms.prepend(el);
    while (this.el.comms.children.length > 4) this.el.comms.lastChild.remove();
  }
  showBanner(text, sub, color) {
    this.el.banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.banner.style.color = color || '#fff';
  }
  clearBanner() { this.el.banner.innerHTML = ''; }
  showHurt(angle) {
    this.hurtT = 1; this.hurtAngle = angle;
    this.el.vign.style.boxShadow = 'inset 0 0 120px rgba(255,0,0,0.55)';
    setTimeout(() => { this.el.vign.style.boxShadow = 'inset 0 0 120px rgba(255,0,0,0)'; }, 180);
  }
  drawHurt(dt) {
    const ctx = this.el.hurt.getContext('2d');
    ctx.clearRect(0, 0, 220, 220);
    if (this.hurtT <= 0) return;
    this.hurtT -= dt * 1.4;
    ctx.save();
    ctx.translate(110, 110);
    ctx.rotate(this.hurtAngle);
    ctx.globalAlpha = Math.max(0, this.hurtT);
    ctx.fillStyle = '#ff2a1a';
    ctx.beginPath();
    ctx.arc(0, 0, 105, -0.5, 0.5);
    ctx.arc(0, 0, 78, 0.5, -0.5, true);
    ctx.fill();
    ctx.restore();
  }
  setPlant(label, frac) {
    if (frac == null) { this.el.plantbar.style.display = 'none'; return; }
    this.el.plantbar.style.display = 'block';
    this.el.plantLbl.textContent = label;
    this.el.plantFill.style.width = `${Math.round(frac * 100)}%`;
  }
  // Minimap from real colliders + waypoints + live dots.
  drawMinimap(player, bots, state, world) {
    const ctx = this.mapCtx;
    const W = 190, H = 150;
    const sx = (x) => (x + 46) / 92 * W;
    const sy = (z) => (z + 36) / 72 * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1a2430'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (const n of world.nodes) for (const l of n.links) {
      ctx.beginPath(); ctx.moveTo(sx(n.x), sy(n.z)); ctx.lineTo(sx(world.nodes[l].x), sy(world.nodes[l].z)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const b of world.colliders) ctx.fillRect(sx(b.x - b.hx), sy(b.z - b.hz), (b.hx * 2) / 92 * W, (b.hz * 2) / 72 * H);
    ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5a2a'; ctx.fillText('A', sx(-32), sy(-22) + 5);
    ctx.fillStyle = '#2a7aff'; ctx.fillText('B', sx(32), sy(-22) + 5);
    const dot = (x, z, color, r) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sx(x), sy(z), r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.stroke();
    };
    if (state.charge.state === 'dropped') dot(state.charge.x, state.charge.z, '#ff2a1a', 4);
    if (state.charge.state === 'planted') {
      const s = world.sites[state.charge.site];
      dot(s.x, s.z, '#ff2a1a', 5);
    }
    for (const b of bots) {
      if (!b.alive) continue;
      if (b.team === 0) dot(b.x, b.z, '#37d67a', 3.5);
      else if (b.seen) dot(b.x, b.z, '#ff4a2a', 3.5);
    }
    // Player arrow.
    ctx.save();
    ctx.translate(sx(player.x), sy(player.z)); ctx.rotate(-player.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'left';
    ctx.fillText('A Furnace   B Crane Dock', 4, H - 4);
  }
  openBuy(money, owned) {
    this.el.buy.style.display = 'block';
    const rows = WEAPON_ORDER.map((id, i) => {
      const w = WEAPONS[id];
      const afford = money >= w.price || owned.has(id);
      return `<div class="row ${afford ? 'afford' : 'poor'}" data-buy="${id}"><span>${i + 1} · ${w.name}</span><span>${owned.has(id) ? 'OWNED' : '$' + w.price}</span></div>`;
    }).join('');
    const g = `<div class="row ${money >= GRENADE.frag.price ? 'afford' : 'poor'}" data-buy="frag"><span>G · Frag Grenade</span><span>$${GRENADE.frag.price}</span></div>
      <div class="row ${money >= GRENADE.smoke.price ? 'afford' : 'poor'}" data-buy="smoke"><span>H · Smoke Grenade</span><span>$${GRENADE.smoke.price}</span></div>
      <div class="row ${money >= ARMOUR_PRICE ? 'afford' : 'poor'}" data-buy="armour"><span>0 · Armour</span><span>$${ARMOUR_PRICE}</span></div>`;
    this.el.buyList.innerHTML = rows + g;
    this.el.buyHint.textContent = `Money: $${money} — click or press the key. Armour absorbs 50% damage.`;
  }
  closeBuy() { this.el.buy.style.display = 'none'; }
  isBuyOpen() { return this.el.buy.style.display === 'block'; }
  showScoreboard(rows, score, matchOver, footer) {
    this.el.scoreboard.style.display = 'block';
    const tr = rows.map((r) => `<tr><td>${r.name}</td><td>${r.team === 0 ? 'EMBER' : 'ASH'}</td><td>${r.k}</td><td>${r.d}</td><td>${r.role}</td></tr>`).join('');
    this.el.sbTable.innerHTML = `<tr><th>Player</th><th>Team</th><th>K</th><th>D</th><th>Role</th></tr>${tr}`;
    this.el.sbFoot.textContent = (matchOver ? 'MATCH OVER — ' : '') + `EMBER ${score[0]} — ${score[1]} ASH` + (footer ? ' · ' + footer : '');
  }
  hideScoreboard() { this.el.scoreboard.style.display = 'none'; }
}
