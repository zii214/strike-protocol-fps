// The single state store. Every module reads and writes this one object; there
// is no other global. It holds the match (scores, money, round), the phase
// machine's timers, the bomb, the actor registry and the event queues the HUD
// drains. Rendering state (meshes, materials) lives in the modules that own it.

export const PHASE = {
  BUY: 'buy', // frozen at spawn, buy menu open
  LIVE: 'live', // round running, bomb not planted
  PLANTED: 'planted', // bomb ticking
  END: 'end', // banner up, brief pause before the next round
  MATCH_END: 'match-end',
};

export const G = {
  phase: PHASE.BUY,
  phaseTime: 0, // seconds left in the current phase
  round: 1,
  winsNeeded: 7,
  score: { ember: 0, watch: 0 },
  roundWinner: null, // 'ember' | 'watch' | null
  roundReason: '', // 'elimination' | 'detonation' | 'defused' | 'time'
  time: 0, // simulation clock, seconds since match start
  actors: [], // every combatant, player first; see makeActor
  player: null, // the actor the local human drives
  bomb: {
    state: 'carried', // 'carried' | 'dropped' | 'planting' | 'planted' | 'defusing'
    carrier: null, // actor holding it, when carried
    pos: { x: 0, y: 0, z: 0 }, // world position when dropped or planted
    site: null, // 'A' | 'B' once planted (or being planted)
    channel: 0, // seconds of plant/defuse progress
    channelBy: null, // actor doing the channelling
    timer: 0, // seconds to detonation once planted
  },
  targetSite: 'A', // the site the Ember bots commit to this round
  noises: [], // {x, z, radius, team} gunshot/explosion events, drained by bots
  smokes: [], // live smoke clouds {x, y, z, r, until} that block sight lines
  feed: [], // kill feed entries {text, t} the HUD drains
  banner: null, // {title, sub, until} centre-screen message
  over: false,
};

let nextActorId = 1;

// An actor is one combatant: a physics body, a team, health and a loadout.
// The player is an actor too (isPlayer), just without a visible mesh.
export function makeActor(team, name, isPlayer) {
  const actor = {
    id: nextActorId++,
    team, // 'ember' | 'watch'
    name,
    isPlayer: Boolean(isPlayer),
    alive: true,
    health: 100,
    armor: false,
    money: isPlayer ? 800 : 800,
    kills: 0,
    deaths: 0,
    body: null, // physics body, set by physics.makeBody
    yaw: 0, // facing, radians (bots; the player keeps its own in player.js)
    loadout: null, // weapons.js createLoadout
    ai: null, // bots.js brain, null for the player
    group: null, // three.js group for bots, null for the player
    hitMeshes: [], // meshes the hitscan tests, tagged with part + actor
    lastDamageFrom: null,
    lastDamageAt: -9,
  };
  G.actors.push(actor);
  return actor;
}

export function aliveActors(team) {
  return G.actors.filter((a) => a.alive && (team === undefined || a.team === team));
}

export function resetMatchState() {
  G.phase = PHASE.BUY;
  G.phaseTime = 0;
  G.round = 1;
  G.score.ember = 0;
  G.score.watch = 0;
  G.roundWinner = null;
  G.roundReason = '';
  G.time = 0;
  G.over = false;
  for (const a of G.actors) {
    a.money = 800;
    a.kills = 0;
    a.deaths = 0;
  }
}

export function pushFeed(text) {
  G.feed.push({ text, t: G.time });
  if (G.feed.length > 6) G.feed.shift();
}

export function pushNoise(x, z, radius, team) {
  G.noises.push({ x, z, radius, team });
}

export function setBanner(title, sub, seconds) {
  G.banner = { title, sub, until: G.time + seconds };
}
