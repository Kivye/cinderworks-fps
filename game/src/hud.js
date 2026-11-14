// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, team
// score, kill feed, the buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. Every setter
// is cached, so a value that did not change costs no DOM write.
const COPY = {
  start: {
    title: 'Cinderworks',
    copy: 'Round-based tactical FPS in the foundry yard. Plant the charge at Furnace or Crane Dock — or wipe the Slag crew. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Cinderworks',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const weaponName = el('weapon-name');
  const healthFill = el('health-fill');
  const healthValue = el('health-value');
  const armorRow = el('armor-row');
  const armorValue = el('armor-value');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const scoreValue = el('score-value');
  const roundValue = el('round-value');
  const siteValue = el('site-value');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const killfeed = el('killfeed');
  const banner = el('banner');
  const bannerText = el('banner-text');
  const bannerSub = el('banner-sub');
  const buyMenu = el('buy-menu');
  const buyMoney = el('buy-money');
  const bombStatus = el('bomb-status');
  const damageFlash = el('damage-flash');
  const hint = el('hint');

  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastRound = '';
  let lastWeapon = '';
  let lastSite = '';
  let lastBomb = '';
  let lastHint = '';
  let hitTimer = 0;
  let bannerTimer = 0;

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setHealth(hp, armor) {
      if (hp === lastHealth && armor === lastArmor) return;
      lastHealth = hp;
      lastArmor = armor;
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthFill.classList.toggle('low', hp <= 30);
      healthValue.textContent = String(Math.ceil(hp));
      armorRow.style.display = armor > 0 ? 'flex' : 'none';
      armorValue.textContent = String(Math.ceil(armor));
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
      buyMoney.textContent = `$${value}`;
    },
    setTimer(text, urgent) {
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', !!urgent);
    },
    setScore(cinder, slag) {
      const text = `${cinder} — ${slag}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = text;
    },
    setRound(text) {
      if (text === lastRound) return;
      lastRound = text;
      roundValue.textContent = text;
    },
    setSite(text) {
      if (text === lastSite) return;
      lastSite = text;
      siteValue.textContent = text;
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombStatus.textContent = text;
      bombStatus.style.display = text ? 'block' : 'none';
    },
    setHint(text) {
      if (text === lastHint) return;
      lastHint = text;
      hint.innerHTML = text;
      hint.style.display = text ? 'block' : 'none';
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageFlash.classList.add('on');
      setTimeout(() => damageFlash.classList.remove('on'), 140);
    },
    feed(text, good) {
      const line = document.createElement('div');
      line.className = good ? 'feed-line good' : 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    banner(text, sub, holdMs = 2200) {
      bannerText.textContent = text;
      bannerSub.textContent = sub || '';
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    showBuy(items, money) {
      buyMenu.hidden = false;
      buyMoney.textContent = `$${money}`;
      const list = el('buy-list');
      list.innerHTML = '';
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'buy-row' + (item.owned ? ' owned' : '') + (item.affordable ? '' : ' poor');
        row.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name">${item.name}</span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
        list.appendChild(row);
      });
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail || text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
