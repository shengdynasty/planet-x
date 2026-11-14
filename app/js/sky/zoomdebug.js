// DEBUG ONLY (branch feat/sky-deep-zoom): a readout at the centre of the screen showing how far in you are.
// Delete this file and its three lines in sky/index.js to remove it.
export function createZoomDebug(stage) {
  const el = document.createElement('div');
  el.className = 'sky-zoomdebug'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<i></i><b data-r="deg"></b><small data-r="sub"></small><small data-r="hd"></small>';
  stage.appendChild(el);
  const q = r => el.querySelector(`[data-r="${r}"]`);
  const fmt = d => d >= 10 ? d.toFixed(1) : d >= 1 ? d.toFixed(2) : d.toFixed(3);
  return {
    update({ fovV, aspect, heightPx, mix, state, hd }) {
      const fovH = 2 * Math.atan(Math.tan(fovV * Math.PI / 360) * aspect) * 180 / Math.PI;
      q('deg').textContent = `${fmt(fovV)}° tall · ${fmt(fovH)}° wide`;
      const as = fovV * 3600 / Math.max(1, heightPx); // arcseconds of sky under one screen pixel (centre, small-angle)
      const layer = state === 'ready' ? `tiles ${Math.round(mix * 100)}%` : state === 'failed' ? 'tiles failed' : state === 'loading' ? 'tiles loading' : 'NASA map';
      if (hd) q('hd').textContent = hd.state === 'ready' ? `HD level ${hd.level || '-'} · ${hd.visible} on screen · ${hd.drawn} drawn · ${hd.cached} cached · ${hd.loading} loading` : `HD tiles ${hd.state}`;
      q('sub').textContent = `${as >= 60 ? (as / 60).toFixed(1) + '′' : as.toFixed(1) + '″'} per screen px · ${layer}`;
    },
  };
}
