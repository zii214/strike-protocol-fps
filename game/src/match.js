// The match: phases, economy, the bomb, and the round plans the bots follow.
// A round is buy (frozen, menu open) → live (105 s) → maybe planted (40 s to
// detonation) → end (banner, payouts) → next round; first to 7 takes the
// match. Ember attacks: carry the bomb to site A or B, plant, defend it.
// Watch defends: run the clock down, eliminate Ember, or defuse.
//
// Win checks and channels live here, not in the bots or weapons, so there is
// exactly one place where a round can end.
import { G, PHASE, aliveActors, setBanner, pushFeed, resetMatchState } from './state.js';
import { SPAWNS, SITES, inSite, NODES, nearestNode, route } from './map.js';
import { WEAPONS, GRENADES, CATALOG, ARMOR_PRICE, createLoadout } from './weapons.js';
import { sendTo } from './bots.js';
import * as sfx from './audio.js';

export const BUY_TIME = 14;
export const ROUND_TIME = 105;
export const BOMB_TIME = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
const END_TIME = 5.5;

let random = Math.random;
let hooks = { placePlayer: () => {} };
let lastBeepSecond = -1;

export function createMatch(rand, matchHooks) {
  random = rand;
  hooks = matchHooks;
  return { start, step, tryBuy, setPlayerChannel };
}

export function start() {
  resetMatchState();
  for (const a of G.actors) {
    a.loadout = createLoadout();
    a.armor = false;
  }
  setupRound();
}

// ---------------------------------------------------------------------------
// Round setup

function setupRound() {
  G.phase = PHASE.BUY;
  G.phaseTime = BUY_TIME;
  G.bomb.state = 'carried';
  G.bomb.site = null;
  G.bomb.channel = 0;
  G.bomb.channelBy = null;
  G.bomb.timer = 0;
  G.targetSite = random() < 0.55 ? 'A' : 'B';
  lastBeepSecond = -1;

  for (const team of ['ember', 'watch']) {
    const spawns = SPAWNS[team];
    let i = 0;
    for (const a of G.actors.filter((x) => x.team === team)) {
      const spawn = spawns[i++ % spawns.length];
      a.alive = true;
      a.health = 100;
      if (a.diedLastRound) {
        a.loadout = createLoadout();
        a.armor = false;
        a.diedLastRound = false;
      }
      // Owned weapons come back with full magazines and fresh reserve.
      for (const key of Object.keys(a.loadout.ammo)) {
        a.loadout.ammo[key] = { mag: WEAPONS[key].mag, reserve: WEAPONS[key].reserve };
      }
      if (!a.loadout.owned[a.loadout.current]) a.loadout.current = 'wasp';
      a.body.pos.x = spawn.x;
      a.body.pos.y = 0;
      a.body.pos.z = spawn.z;
      a.body.vel.x = 0;
      a.body.vel.y = 0;
      a.body.vel.z = 0;
      a.yaw = spawn.yaw;
      if (a.group) {
        a.group.visible = true;
        a.group.rotation.set(0, spawn.yaw, 0);
        a.group.userData.fell = false;
        a.group.position.set(spawn.x, 0, spawn.z);
      }
      if (a.ai) {
        a.ai.state = 'hold';
        a.ai.path = [];
        a.ai.goalPos = null;
        a.ai.target = null;
        a.ai.alertPos = null;
        a.ai.threwSmoke = false;
        a.ai.threwFrag = false;
        a.ai.blindUntil = -9;
        a.ai.lastSeenAt = -9;
      }
      if (a.isPlayer) hooks.placePlayer(spawn);
    }
  }

  // The bomb starts with a random Ember bot — never the player, so a new
  // player can watch the carrier work; walk over a dropped bomb to take it.
  const emberBots = G.actors.filter((a) => a.team === 'ember' && !a.isPlayer);
  G.bomb.carrier = emberBots[Math.floor(random() * emberBots.length)] ?? G.player;
  for (const a of G.actors) if (a.ai) botBuy(a);
  planBots();
  setBanner(`Round ${G.round}`, 'Ember: plant at site A or B — Watch: run down the clock', 3.2);
}

function botBuy(a) {
  const L = a.loadout;
  const buy = (price) => { if (a.money >= price) { a.money -= price; return true; } return false; };
  if (!L.primary && a.money >= 2700) {
    const key = random() < 0.18 ? 'longbow' : 'meridian';
    if (buy(WEAPONS[key].price)) { L.owned[key] = true; L.primary = key; L.current = key; }
  }
  if (!L.primary && a.money >= 1000 && buy(WEAPONS.kestrel.price)) {
    L.owned.kestrel = true; L.primary = 'kestrel'; L.current = 'kestrel';
  }
  if (!a.armor && a.money >= ARMOR_PRICE + 250 && buy(ARMOR_PRICE)) a.armor = true;
  if (a === G.bomb.carrier && L.grenades.smoke === 0 && buy(GRENADES.smoke.price)) L.grenades.smoke += 1;
  if (L.grenades.frag === 0 && a.money >= 550 && random() < 0.55 && buy(GRENADES.frag.price)) L.grenades.frag += 1;
}

// Route an actor through a chain of nodes.
function sendVia(actor, nodes) {
  const from = nearestNode(actor.body.pos.x, actor.body.pos.z);
  let path = route(from, nodes[0]);
  for (let i = 1; i < nodes.length; i++) path = path.concat(route(nodes[i - 1], nodes[i]).slice(1));
  actor.ai.path = path.slice(1);
  actor.ai.goalPos = null;
  actor.ai.state = 'route';
}

function holdAt(actor, nodeId, watchX, watchZ) {
  sendTo(actor, nodeId);
  const [nx, nz] = NODES[nodeId];
  actor.ai.holdYaw = Math.atan2(-(watchX - nx), -(watchZ - nz));
}

function planBots() {
  const site = G.targetSite;
  const ember = G.actors.filter((a) => a.team === 'ember' && a.ai);
  const watch = G.actors.filter((a) => a.team === 'watch' && a.ai);
  const carrier = G.bomb.carrier;

  for (const bot of ember) {
    if (bot === carrier) {
      if (site === 'A') sendVia(bot, ['aMain', 'aSite']);
      else sendVia(bot, ['bMain', 'bSite']);
    } else if (site === 'A') {
      sendVia(bot, random() < 0.5 ? ['westAlley', 'aPocket'] : ['aMain', 'aSite']);
    } else {
      sendVia(bot, random() < 0.5 ? ['eastAlley', 'bDoor'] : ['bMain', 'bSite']);
    }
  }
  // The lurker: one Ember bot shows at the other site, then rotates late.
  const lurker = ember.find((b) => b !== carrier);
  if (lurker) {
    if (site === 'A') sendVia(lurker, ['bMain']);
    else sendVia(lurker, ['aMain']);
  }

  const posts = [
    (b) => holdAt(b, 'aSite', -13.5, -17), // A site, watching A main
    (b) => holdAt(b, 'aPocket', -26.5, -3), // A pocket, watching the alley
    (b) => holdAt(b, 'bSite', 10.5, -16), // warehouse, watching the west door
    (b) => holdAt(b, 'defMid', -4, -16), // mid rotator
  ];
  watch.forEach((bot, i) => posts[i % posts.length](bot));
}

// After the plant: defenders converge, attackers dig in around the site.
function planPlanted() {
  const bomb = G.bomb;
  for (const bot of G.actors) {
    if (!bot.ai || !bot.alive) continue;
    if (bot.team === 'watch') {
      sendTo(bot, nearestNode(bomb.pos.x, bomb.pos.z), { x: bomb.pos.x, z: bomb.pos.z });
    } else {
      const node = nearestNode(bot.body.pos.x, bot.body.pos.z);
      holdAt(bot, node, bomb.pos.x, bomb.pos.z);
    }
  }
}

// ---------------------------------------------------------------------------
// Buying

export function tryBuy(actor, index) {
  if (G.phase !== PHASE.BUY) return false;
  const item = CATALOG[index];
  if (!item) return false;
  const L = actor.loadout;
  if (item.kind === 'weapon') {
    const def = WEAPONS[item.key];
    if (L.owned[item.key] || actor.money < def.price) { sfx.denied(); return false; }
    actor.money -= def.price;
    L.owned[item.key] = true;
    L.primary = item.key;
    L.ammo[item.key] = { mag: def.mag, reserve: def.reserve };
    L.current = item.key;
  } else if (item.kind === 'grenade') {
    const def = GRENADES[item.key];
    const cap = item.key === 'frag' ? 2 : 1;
    if (L.grenades[item.key] >= cap || actor.money < def.price) { sfx.denied(); return false; }
    actor.money -= def.price;
    L.grenades[item.key] += 1;
  } else if (item.kind === 'armor') {
    if (actor.armor || actor.money < ARMOR_PRICE) { sfx.denied(); return false; }
    actor.money -= ARMOR_PRICE;
    actor.armor = true;
  }
  sfx.buy();
  return true;
}

// ---------------------------------------------------------------------------
// The bomb: pickup, plant, defuse

let playerChannel = false; // the human holds E (set by main.js each step)
function setPlayerChannel(on) { playerChannel = on; }

function channelStep(dt) {
  const bomb = G.bomb;
  if (bomb.state === 'carried' && bomb.carrier && bomb.carrier.alive) {
    const carrier = bomb.carrier;
    const inZone = inSite(carrier.body.pos.x, carrier.body.pos.z, 'A')
      ? 'A' : inSite(carrier.body.pos.x, carrier.body.pos.z, 'B') ? 'B' : null;
    const wants = carrier.isPlayer ? playerChannel : carrier.ai && carrier.ai.state === 'plant';
    const still = Math.hypot(carrier.body.vel.x, carrier.body.vel.z) < 0.6;
    if (inZone && wants && still && G.phase === PHASE.LIVE) {
      bomb.state = 'planting';
      bomb.site = inZone;
      bomb.channelBy = carrier;
      bomb.channel = 0;
    }
  }
  if (bomb.state === 'planting') {
    const by = bomb.channelBy;
    if (!by.alive || Math.hypot(by.body.vel.x, by.body.vel.z) > 0.9 || !inSite(by.body.pos.x, by.body.pos.z, bomb.site)) {
      bomb.state = 'carried';
      bomb.channel = 0;
      bomb.channelBy = null;
    } else {
      bomb.channel += dt;
      if (bomb.channel >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.pos = { x: by.body.pos.x, y: 0, z: by.body.pos.z };
        bomb.carrier = null;
        bomb.channelBy = null;
        bomb.timer = BOMB_TIME;
        by.money += 300;
        G.phase = PHASE.PLANTED;
        G.phaseTime = BOMB_TIME;
        setBanner('Bomb planted', `Site ${bomb.site} — 40 seconds`, 2.6);
        pushFeed(`Bomb planted at site ${bomb.site}`);
        sfx.plantDone();
        planPlanted();
      }
    }
  }
  if (bomb.state === 'planted') {
    // A Watch bot that has arrived starts defusing; match runs the clock.
    for (const bot of G.actors) {
      if (!bot.ai || !bot.alive || bot.team !== 'watch') continue;
      const near = Math.hypot(bot.body.pos.x - bomb.pos.x, bot.body.pos.z - bomb.pos.z) < 1.5;
      if (near && bot.ai.state !== 'engage') {
        bot.ai.state = 'defuse';
        bomb.state = 'defusing';
        bomb.channelBy = bot;
        bomb.channel = 0;
        break;
      }
    }
  }
  if (bomb.state === 'defusing') {
    const by = bomb.channelBy;
    const near = by && Math.hypot(by.body.pos.x - bomb.pos.x, by.body.pos.z - bomb.pos.z) < 1.8;
    if (!by || !by.alive || !near || by.ai.state === 'engage') {
      bomb.state = 'planted';
      bomb.channel = 0;
      bomb.channelBy = null;
    } else {
      bomb.channel += dt;
      if (bomb.channel >= DEFUSE_TIME) {
        endRound('watch', 'defused');
      }
    }
  }
  // Dropped-bomb pickup by any living Ember actor who walks over it.
  if (bomb.state === 'dropped') {
    for (const a of aliveActors('ember')) {
      if (Math.hypot(a.body.pos.x - bomb.pos.x, a.body.pos.z - bomb.pos.z) < 1.0) {
        bomb.state = 'carried';
        bomb.carrier = a;
        pushFeed(`${a.name} picked up the bomb`);
        break;
      }
    }
  }
}

// Called by weapons.js when an actor dies.
export function onKill(target, attacker) {
  target.diedLastRound = true;
  if (G.bomb.state === 'carried' && G.bomb.carrier === target) {
    G.bomb.state = 'dropped';
    G.bomb.pos = { x: target.body.pos.x, y: 0, z: target.body.pos.z };
    G.bomb.carrier = null;
    // The nearest Ember bot goes to recover it.
    let best = null;
    let bestD = Infinity;
    for (const a of aliveActors('ember')) {
      if (!a.ai) continue;
      const d = Math.hypot(a.body.pos.x - G.bomb.pos.x, a.body.pos.z - G.bomb.pos.z);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) sendTo(best, nearestNode(G.bomb.pos.x, G.bomb.pos.z), { x: G.bomb.pos.x, z: G.bomb.pos.z });
  }
  if (G.bomb.state === 'planting' && G.bomb.channelBy === target) {
    G.bomb.state = G.bomb.carrier ? 'carried' : 'dropped';
    if (G.bomb.state === 'dropped') G.bomb.pos = { x: target.body.pos.x, y: 0, z: target.body.pos.z };
    G.bomb.channel = 0;
    G.bomb.channelBy = null;
  }
  if (attacker && attacker.isPlayer) sfx.hit(true);
  checkElimination();
}

function checkElimination() {
  if (G.phase !== PHASE.LIVE && G.phase !== PHASE.PLANTED) return;
  if (aliveActors('ember').length === 0) {
    if (G.phase === PHASE.PLANTED) return; // the bomb can still win it
    endRound('watch', 'elimination');
  } else if (aliveActors('watch').length === 0) {
    endRound('ember', 'elimination');
  }
}

// ---------------------------------------------------------------------------
// Round and match flow

function endRound(winner, reason) {
  if (G.phase === PHASE.END || G.phase === PHASE.MATCH_END) return;
  G.roundWinner = winner;
  G.roundReason = reason;
  G.score[winner] += 1;
  const winPay = reason === 'detonation' ? 1650 : 1500;
  for (const a of G.actors) {
    a.money += a.team === winner ? winPay : 1000;
  }
  if (winner === 'ember') sfx.roundWin(); else sfx.roundLose();
  const label = winner === 'ember' ? 'Ember takes the round' : 'Watch takes the round';
  const why = {
    elimination: 'by elimination',
    detonation: 'the bomb detonated',
    defused: 'the bomb was defused',
    time: 'time expired',
  }[reason];
  setBanner(label, why, END_TIME);
  if (G.score[winner] >= G.winsNeeded) {
    G.phase = PHASE.MATCH_END;
    G.over = true;
    G.phaseTime = 999;
    setBanner(winner === 'ember' ? 'EMBER WINS THE MATCH' : 'WATCH WINS THE MATCH', `Final score ${G.score.ember} — ${G.score.watch}`, 999);
  } else {
    G.phase = PHASE.END;
    G.phaseTime = END_TIME;
  }
}

function detonate() {
  const bomb = G.bomb;
  sfx.explosion();
  // The blast is lethal at close range; the round is Ember's regardless.
  for (const a of G.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.body.pos.x - bomb.pos.x, a.body.pos.z - bomb.pos.z);
    if (d < 10) a.health = Math.max(1, a.health - (110 - d * 9));
  }
  bomb.state = 'gone';
  endRound('ember', 'detonation');
}

export function step(dt) {
  G.time += dt;
  if (G.banner && G.time > G.banner.until && G.phase !== PHASE.MATCH_END) G.banner = null;

  switch (G.phase) {
    case PHASE.BUY: {
      G.phaseTime -= dt;
      if (G.phaseTime <= 0) {
        G.phase = PHASE.LIVE;
        G.phaseTime = ROUND_TIME;
        setBanner('Round live', '', 1.4);
      }
      break;
    }
    case PHASE.LIVE: {
      G.phaseTime -= dt;
      channelStep(dt);
      if (G.phase === PHASE.LIVE && G.phaseTime <= 0) endRound('watch', 'time');
      break;
    }
    case PHASE.PLANTED: {
      channelStep(dt);
      if (G.bomb.state === 'planted' || G.bomb.state === 'defusing') {
        G.bomb.timer -= dt;
        G.phaseTime = G.bomb.timer;
        const whole = Math.ceil(G.bomb.timer);
        if (whole !== lastBeepSecond && whole <= 10) {
          lastBeepSecond = whole;
          sfx.beep(whole <= 3);
        }
        if (G.phase === PHASE.PLANTED && G.bomb.timer <= 0) detonate();
      }
      break;
    }
    case PHASE.END: {
      G.phaseTime -= dt;
      if (G.phaseTime <= 0) {
        G.round += 1;
        setupRound();
      }
      break;
    }
    default:
      break;
  }

  // Carrier bots commit: standing in a site with the bomb means plant.
  const carrier = G.bomb.carrier;
  if (G.phase === PHASE.LIVE && G.bomb.state === 'carried' && carrier && carrier.ai && carrier.alive) {
    if (inSite(carrier.body.pos.x, carrier.body.pos.z, 'A') || inSite(carrier.body.pos.x, carrier.body.pos.z, 'B')) {
      if (carrier.ai.state !== 'engage') carrier.ai.state = 'plant';
    }
  }
  // The planted-bomb beep also ticks in the last seconds before the plant.
  checkElimination();
}
