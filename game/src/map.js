// Cinderyard: a decommissioned freight yard at dusk, drawn here as data. The
// world builder turns these boxes into geometry; physics and the bots read
// the same list, so what you see is exactly what collides and what blocks a
// sight line. Layout, top-down (x east, z south, metres):
//
//   north (-z): Watch spawn behind the two sites.
//   Site A (west): an open pocket of container stacks, watched from A main.
//   Site B (east): inside the warehouse — a west door, a south door, crates.
//   Mid: a long lane past the weighbridge hut, splitting to both sites.
//   Alleys down both edges reward a quiet lurk. Ember spawn is south.
//
// kind picks the material in world.js: wall, container (with a colour),
// crate (low ones are step-on cover), fence, hut.

function box(cx, cz, w, d, h, kind, color) {
  return {
    x0: cx - w / 2, x1: cx + w / 2, y0: 0, y1: h, z0: cz - d / 2, z1: cz + d / 2,
    cx, cz, w, d, h, kind, color: color ?? null,
  };
}

export const COLLIDERS = [
  // Perimeter fence walls.
  box(0, -35, 72, 2, 4, 'wall'),
  box(0, 35, 72, 2, 4, 'wall'),
  box(-35, 0, 2, 72, 4, 'wall'),
  box(35, 0, 2, 72, 4, 'wall'),

  // Site A: container stacks around the pocket.
  box(-26, -24, 6, 2.6, 2.6, 'container', 'rust'),
  box(-18, -24, 6, 2.6, 2.6, 'container', 'metal'),
  box(-22, -14.5, 2.6, 6, 2.6, 'container', 'sand'),
  box(-27, -16, 2.2, 2.2, 1.1, 'crate'), // step-on cover
  box(-15, -19, 2.2, 2.2, 2.2, 'crate'),
  box(-29, -27, 2.2, 2.2, 1.1, 'crate'),

  // The wall between mid and A, with the A-main gap at z -20..-15.
  box(-11, -22.5, 0.8, 5, 3, 'wall'),
  box(-11, -12.5, 0.8, 5, 3, 'wall'),

  // Warehouse (site B): walls with a west door (z -19..-13) and a south
  // door (x 23..25). Interior crates below.
  box(13.5, -23, 1, 8, 3.4, 'wall'), // west wall, north segment
  box(13.5, -10, 1, 6, 3.4, 'wall'), // west wall, south segment
  box(22, -27.5, 18, 1, 3.4, 'wall'), // north wall
  box(30.5, -16, 1, 16, 3.4, 'wall'), // east wall
  box(18, -7.5, 10, 1, 3.4, 'wall'), // south wall, west segment
  box(28, -7.5, 6, 1, 3.4, 'wall'), // south wall, east segment
  box(20, -20, 2.4, 2.4, 2.4, 'crate'),
  box(25, -14, 2.4, 2.4, 1.1, 'crate'),
  box(17, -13, 2, 2, 1.1, 'crate'),

  // Mid: the weighbridge hut (solid) and crate cover on the lane.
  box(0, -6, 7, 6, 3, 'hut'),
  box(-2, -19.5, 2.2, 2.2, 2.2, 'crate'),
  box(3, -20, 2.2, 2.2, 1.1, 'crate'),
  box(2.5, 2, 2.4, 2.4, 1.1, 'crate'),
  box(-3, 8, 2.2, 2.2, 2.2, 'crate'),
  box(-7, -13, 0.6, 8, 2.2, 'fence'),
  box(7, -13, 0.6, 8, 2.2, 'fence'),

  // The container across mid's south mouth: rush mid and you split around it.
  box(0, 14, 6, 2.6, 2.6, 'container', 'metal'),

  // Alleys.
  box(-30, 2, 2.4, 2.4, 2.2, 'crate'), // west alley
  box(-29, -8, 2, 2, 1.1, 'crate'),
  box(30, 4, 2.4, 2.4, 2.2, 'crate'), // east alley
  box(28, 12, 6, 2.6, 2.6, 'container', 'rust'),

  // Spawn cover.
  box(-8, 20, 2.4, 2.4, 1.1, 'crate'),
  box(8, 20, 2.4, 2.4, 2.2, 'crate'),
  box(-6, -30, 2.2, 2.2, 1.1, 'crate'),
  box(10, -31, 2.2, 2.2, 1.1, 'crate'),
];

// Meshes the hitscan may strike: world.js fills this with the visible boxes.
export const SHOOTABLES = [];

export const SITES = {
  A: { name: 'A', cx: -22, cz: -20, r: 5.2 },
  B: { name: 'B', cx: 22, cz: -17, r: 5.2 },
};

export function inSite(x, z, site) {
  const s = SITES[site];
  return Math.abs(x - s.cx) <= s.r && Math.abs(z - s.cz) <= s.r;
}

export const SPAWNS = {
  ember: [
    { x: -3, z: 29, yaw: 0 }, // yaw 0 faces -z (north), three.js camera convention
    { x: 0, z: 30, yaw: 0 },
    { x: 3, z: 29, yaw: 0 },
    { x: 6, z: 30, yaw: 0 },
  ],
  watch: [
    { x: -3, z: -31, yaw: Math.PI },
    { x: 0, z: -32, yaw: Math.PI },
    { x: 3, z: -31, yaw: Math.PI },
    { x: 6, z: -32, yaw: Math.PI },
  ],
};

// The bots' road map: named nodes and walkable edges (both ways). Every edge
// was checked against the colliders above — a straight walk between its ends
// stays out of the boxes, with body radius to spare.
export const NODES = {
  atkSpawn: [0, 29],
  atkWest: [-13, 24],
  atkEast: [13, 24],
  westAlleyS: [-29, 9],
  westAlley: [-26.5, -3],
  aPocket: [-24, -21],
  aSite: [-20, -18],
  aMain: [-13.5, -17],
  midS: [0, 8],
  midSW: [-5.5, 14],
  midSE: [5.5, 14],
  midWest: [-6, -5],
  midEast: [6, -5],
  midN: [-4, -16],
  midNE: [5, -19],
  bMainN: [10, -24],
  bMain: [10.5, -16],
  bSite: [21, -17],
  bSiteE: [26, -21],
  bDoorIn: [24, -10.5],
  bDoor: [24, -3],
  eastAlley: [32, 4],
  eastMid: [32, 16],
  eastAlleyS: [22, 17],
  defSpawn: [0, -30],
  defMid: [-5, -26],
  defA: [-13, -28],
  defB: [14, -27],
};

const EDGES = [
  ['atkSpawn', 'atkWest'], ['atkSpawn', 'atkEast'],
  ['atkSpawn', 'midSW'], ['atkSpawn', 'midSE'],
  ['midSW', 'midS'], ['midSE', 'midS'], ['midSW', 'midWest'], ['midSE', 'midEast'],
  ['atkWest', 'westAlleyS'], ['atkWest', 'midS'],
  ['westAlleyS', 'westAlley'], ['westAlley', 'aPocket'],
  ['aPocket', 'aSite'], ['aSite', 'aMain'],
  ['aMain', 'midN'], ['aMain', 'aPocket'], ['aMain', 'defA'],
  ['midS', 'midWest'], ['midS', 'midEast'],
  ['midWest', 'midN'], ['midEast', 'midNE'],
  ['midN', 'midNE'], ['midN', 'defMid'],
  ['midNE', 'bMain'], ['bMainN', 'bMain'], ['bMainN', 'defB'],
  ['bMain', 'bSite'], ['bSite', 'bSiteE'], ['bSite', 'bDoorIn'],
  ['bDoorIn', 'bDoor'], ['bDoor', 'eastAlley'],
  ['eastAlley', 'eastMid'], ['eastMid', 'eastAlleyS'],
  ['eastAlleyS', 'atkEast'], ['eastAlleyS', 'midS'],
  ['defSpawn', 'defMid'], ['defSpawn', 'defB'], ['defSpawn', 'defA'],
  ['defMid', 'defA'], ['defMid', 'midN'],
];

export const GRAPH = (() => {
  const graph = {};
  for (const id of Object.keys(NODES)) graph[id] = [];
  for (const [a, b] of EDGES) {
    graph[a].push(b);
    graph[b].push(a);
  }
  return graph;
})();

// Nearest node to a point, by straight-line distance.
export function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, [nx, nz]] of Object.entries(NODES)) {
    const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Breadth-first route between two nodes: an array of node ids, ends included.
export function route(from, to) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of GRAPH[cur]) {
      if (prev[next] === undefined) {
        prev[next] = cur;
        if (next === to) {
          const path = [to];
          let p = cur;
          while (p !== null) { path.unshift(p); p = prev[p]; }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [from];
}
