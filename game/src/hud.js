// The HUD: plain DOM over the canvas, updated from the state store each
// frame (writes only when a value changes). Health and armour bottom-left,
// weapon and money bottom-right, timer and score top-centre, kill feed
// top-right, banners centre, and the buy menu as a grid during the buy
// phase. The crosshair gap is a CSS variable the gun's spread drives, so
// the sight picture itself tells you how wild the next shot will be.
import { G, PHASE } from './state.js';
import { CATALOG, WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { inSite } from './map.js';

const $ = (id) => document.getElementById(id);

function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  const els = {
    healthFill: $('health-fill'),
    healthNum: $('health-num'),
    armorTag: $('armor-tag'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoBox: $('ammo'),
    weaponName: $('weapon-name'),
    money: $('money'),
    timer: $('timer'),
    scoreLine: $('score-line'),
    feed: $('feed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    prompt: $('prompt'),
    plantbar: $('plantbar'),
    plantFill: $('plantbar-fill'),
    plantLabel: $('plantbar-label'),
    buy: $('buy'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    vignette: $('vignette'),
    flashfx: $('flashfx'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    bombtag: $('bombtag'),
    grenades: $('grenades'),
  };

  const cache = new Map();
  function set(key, el, prop, value) {
    if (cache.get(key) === value) return;
    cache.set(key, value);
    if (prop === 'text') el.textContent = value;
    else el.style[prop] = value;
  }

  // Build the buy menu once; frame() refreshes prices and owned states.
  const buyButtons = CATALOG.map((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'buy-item';
    btn.type = 'button';
    const name = item.kind === 'weapon' ? WEAPONS[item.key].name
      : item.kind === 'grenade' ? GRENADES[item.key].name : 'Vest Plating';
    const price = item.kind === 'weapon' ? WEAPONS[item.key].price
      : item.kind === 'grenade' ? GRENADES[item.key].price : ARMOR_PRICE;
    btn.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${name}</span><span class="buy-price">$${price}</span>`;
    btn.addEventListener('click', () => hud.onBuy && hud.onBuy(i));
    els.buyItems.appendChild(btn);
    return { btn, item, price };
  });

  let hitmarkUntil = 0;
  let damageUntil = 0;
  let flashUntil = 0;

  const hud = {
    onPlay: null,
    onBuy: null,

    bind() {
      els.play.addEventListener('click', () => hud.onPlay && hud.onPlay());
    },
    showOverlay(title, copy, button) {
      els.overlayTitle.textContent = title;
      els.overlayCopy.textContent = copy;
      els.play.textContent = button;
      els.overlay.hidden = false;
    },
    hideOverlay() { els.overlay.hidden = true; },
    hitmarker(killed) {
      hitmarkUntil = performance.now() + (killed ? 260 : 130);
      els.hitmarker.classList.add(killed ? 'kill' : 'on');
      els.hitmarker.classList.toggle('kill', killed);
    },
    damage() {
      damageUntil = performance.now() + 320;
      els.vignette.style.opacity = '1';
    },
    flash(seconds) {
      flashUntil = performance.now() + seconds * 1000;
      els.flashfx.style.opacity = '1';
    },

    // Called every frame with the local player's actor and gun.
    frame(player, gun, spreadPx) {
      const now = performance.now();
      if (now > hitmarkUntil) els.hitmarker.classList.remove('on', 'kill');
      if (now > damageUntil) els.vignette.style.opacity = '0';
      if (now > flashUntil) els.flashfx.style.opacity = '0';

      // Health / armour
      const hp = Math.max(0, Math.round(player.health));
      set('hp', els.healthNum, 'text', String(hp));
      set('hpf', els.healthFill, 'width', `${hp}%`);
      set('hpc', els.healthFill, 'background', hp <= 30 ? 'var(--danger)' : 'var(--accent)');
      set('armor', els.armorTag, 'text', player.armor ? 'VEST' : '');

      // Weapon / ammo / grenades
      const def = gun.def;
      if (player.loadout.current.startsWith('grenade:')) {
        const key = player.loadout.current.slice(8);
        set('wn', els.weaponName, 'text', GRENADES[key].name);
        set('am', els.ammoMag, 'text', String(player.loadout.grenades[key]));
        set('ar', els.ammoReserve, 'text', '');
      } else if (def) {
        set('wn', els.weaponName, 'text', gun.reloading ? `${def.name} — reloading` : def.name);
        if (def.key === 'knife') {
          set('am', els.ammoMag, 'text', '—');
          set('ar', els.ammoReserve, 'text', '');
        } else {
          set('am', els.ammoMag, 'text', String(gun.ammo.mag));
          set('ar', els.ammoReserve, 'text', `/ ${gun.ammo.reserve}`);
        }
      }
      els.ammoBox.classList.toggle('empty', Boolean(def && def.key !== 'knife' && gun.ammo && gun.ammo.mag === 0));
      const nades = Object.entries(player.loadout.grenades)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${GRENADES[k].name.split(' ')[0]} ×${n}`)
        .join('  ');
      set('nades', els.grenades, 'text', nades);
      set('money', els.money, 'text', `$${player.money}`);

      // Timer / score / bomb tag
      const planted = G.phase === PHASE.PLANTED;
      set('timer', els.timer, 'text', fmtTime(G.phaseTime));
      set('timerColor', els.timer, 'color', planted ? 'var(--danger)' : 'var(--ink)');
      set('score', els.scoreLine, 'text', `EMBER ${G.score.ember} — ${G.score.watch} WATCH · ROUND ${G.round}`);
      els.bombtag.hidden = !planted;

      // Crosshair spread
      els.crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
      els.crosshair.style.opacity = player.alive ? '1' : '0';

      // Banner
      if (G.banner) {
        els.banner.hidden = false;
        set('bt', els.bannerTitle, 'text', G.banner.title);
        set('bs', els.bannerSub, 'text', G.banner.sub ?? '');
      } else {
        els.banner.hidden = true;
      }

      // Kill feed (rebuilt when its length changes; entries are few)
      const feedKey = G.feed.length ? `${G.feed.length}:${G.feed[G.feed.length - 1].t}` : '0';
      if (cache.get('feed') !== feedKey) {
        cache.set('feed', feedKey);
        els.feed.innerHTML = G.feed.map((f) => `<div>${f.text}</div>`).join('');
      }

      // Context prompt + plant/defuse progress
      let prompt = '';
      let plantRatio = -1;
      let plantText = '';
      const bomb = G.bomb;
      if (bomb.state === 'carried' && bomb.carrier === player && G.phase === PHASE.LIVE) {
        const site = inSite(player.body.pos.x, player.body.pos.z, 'A') ? 'A'
          : inSite(player.body.pos.x, player.body.pos.z, 'B') ? 'B' : null;
        prompt = site ? `Hold E to plant at site ${site}` : 'You have the bomb — reach site A or B';
      } else if (bomb.state === 'dropped') {
        prompt = 'The bomb is down — recover it';
      }
      if (bomb.state === 'planting') {
        plantRatio = bomb.channel / 3;
        plantText = `Planting… ${Math.round(plantRatio * 100)}%`;
      } else if (bomb.state === 'defusing') {
        plantRatio = bomb.channel / 5;
        plantText = `Defusing… ${Math.round(plantRatio * 100)}%`;
      } else if (bomb.state === 'planted') {
        plantText = `Bomb at site ${bomb.site} — ${fmtTime(bomb.timer)}`;
        plantRatio = bomb.timer / 40;
      }
      set('prompt', els.prompt, 'text', prompt);
      els.plantbar.hidden = plantRatio < 0;
      if (plantRatio >= 0) {
        set('pf', els.plantFill, 'width', `${Math.round(plantRatio * 100)}%`);
        set('pl', els.plantLabel, 'text', plantText);
      }

      // Buy menu
      const buying = G.phase === PHASE.BUY;
      els.buy.hidden = !buying;
      if (buying) {
        set('bm', els.buyMoney, 'text', `$${player.money}`);
        for (const { btn, item, price } of buyButtons) {
          let owned = false;
          if (item.kind === 'weapon') owned = Boolean(player.loadout.owned[item.key]);
          else if (item.kind === 'armor') owned = player.armor;
          else owned = player.loadout.grenades[item.key] >= (item.key === 'frag' ? 2 : 1);
          btn.disabled = owned || player.money < price;
          btn.classList.toggle('owned', owned);
        }
      }
    },
  };

  hud.bind();
  return hud;
}
