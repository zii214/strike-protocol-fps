// The look plan, in one place: a freight yard at dusk. Warm concrete and rust
// against a slate sky, one amber accent, and a team colour each — Ember amber
// for the attackers, Watch blue-grey for the defenders. The same names are the
// CSS custom properties in index.html, so the HUD and the world agree.
export const PALETTE = {
  canvas: '#17140f', // page background, fog, dusk sky
  surface: '#241f19', // panels, warehouse walls
  hairline: '#3a332a', // trim, fence lines
  ink: '#f0e8da', // HUD text, lit concrete
  muted: '#9a8f7d', // secondary text, weathered metal
  accent: '#f59a23', // amber: accents, site paint, Ember team
  concrete: '#8d8172',
  concreteDark: '#5d554a',
  rust: '#a4522c',
  metal: '#4e5a5c',
  watch: '#6f96b8', // Watch team blue-grey
  danger: '#d84b35',
  grass: '#4c4a38',
};

export const TEAM_COLORS = {
  ember: PALETTE.accent,
  watch: PALETTE.watch,
};
