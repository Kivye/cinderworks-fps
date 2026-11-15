// Cinderworks palette: one dusk-foundry look, shared by the 3D scene and the HUD.
// Six named colours only; lighting and opacity do the rest. The same names are the
// CSS custom properties in index.html, so a screenshot and its code always agree.
export const PALETTE = {
  canvas: '#17130f', // warm dark ground haze, also the page background
  surface: '#241c15', // foundry floor and wall faces
  hairline: '#3a2d20', // crates, beams, cover edges
  ink: '#efe7d8', // warm off-white: HUD text, tracer light
  muted: '#9a8a74', // secondary text, distant steel
  accent: '#ff7a1a', // molten ember: crosshair, tracers, site markers
  danger: '#ff3b30', // damage flash, planted-charge blink
  ally: '#57c785', // friendly markers and tracers
  enemy: '#ff5a4e', // hostile markers
};
