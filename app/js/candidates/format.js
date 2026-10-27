// Pure helpers for the candidate panel (no DOM): formatting, filtering, sorting, export.
// Importable from Node for tests.

export const STATUSES = ['Candidate', 'Follow-up', 'Likely', 'Matched', 'Rejected'];
/** Statuses a human reviewer may assign. Matched / Likely are set by the pipeline. */
export const USER_STATUSES = ['Follow-up', 'Rejected'];
export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Candidate', label: 'Unmatched' },
  { id: 'Matched', label: 'Matched' },
  { id: 'Likely', label: 'Likely' },
];
export const SORTS = [
  { id: 'id', label: 'Id' },
  { id: 'shift', label: 'Shift' },
  { id: 'band', label: 'Band' },
  { id: 'status', label: 'Status' },
];

export const pad2 = n => String(n).padStart(2, '0');
export const fmtRA = h => {
  h = ((h % 24) + 24) % 24;
  let H = Math.floor(h), m = Math.round((h - H) * 60);
  if (m === 60) { m = 0; H = (H + 1) % 24; }
  return `${H}h ${pad2(m)}m`;
};
export const fmtDec = d => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}°`;

/** Status the pipeline gave this candidate, before any human review. */
export function pipelineStatus(c) {
  if (c.pipelineStatus) return c.pipelineStatus;
  return USER_STATUSES.includes(c.status) ? 'Candidate' : c.status;
}

/** Index of the position to show for a (1-based) scan id: clamps to the last available entry (older data had fewer
 * entries than scans). The entry at that index may be null: the server emits one `pos` entry per scan, null where the
 * mover was not observed. */
export function posIndex(c, scan) {
  const n = (c.pos || []).length;
  if (!n) return -1;
  return Math.max(0, Math.min(scan || 1, n) - 1);
}
/** Position [raH, decD] in a (1-based) scan, or null when the mover was not observed in it. */
export function posAt(c, scan) {
  const k = posIndex(c, scan);
  return k < 0 ? null : (c.pos[k] || null);
}
/** The observed positions only, in scan order. */
export const observed = c => (c.pos || []).filter(Boolean);
/** True when the candidate has at least one observed position. */
export const hasPos = c => !!(c && c.pos && c.pos.some(Boolean));
/** Position in that scan, else the nearest observed one (earlier scans win ties); null when never observed. */
export function nearestPos(c, scan) {
  const p = posAt(c, scan); if (p) return p;
  const pos = c.pos || [], k = posIndex(c, scan);
  if (k < 0) return null;
  for (let d = 1; d < pos.length; d++) {
    if (pos[k - d]) return pos[k - d];
    if (pos[k + d]) return pos[k + d];
  }
  return null;
}
/** Position text for the panel: RA, Dec in that scan, or why there is none. */
export function fmtPos(c, scan) {
  if (!hasPos(c)) return '—';
  const p = posAt(c, scan);
  return p ? `${fmtRA(p[0])}, ${fmtDec(p[1])}` : `not observed in Scan ${scan || 1}`;
}

/** Angular shift first→last observed position, in degrees. */
export function shiftDeg(c) {
  const p = observed(c);
  if (p.length < 2) return 0;
  const a = p[0], b = p[p.length - 1];
  let dra = b[0] - a[0];
  if (dra > 12) dra -= 24; else if (dra < -12) dra += 24;
  return Math.hypot(dra * 15 * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]);
}
export function fmtShift(c) {
  const sh = shiftDeg(c), n = observed(c).length;
  if (!n) return '—';
  const v = sh < 1 ? `${(sh * 60).toFixed(1)}′` : `${sh.toFixed(2)}°`;
  return `${v} over ${n} scan${n === 1 ? '' : 's'}`;
}
export const bandMicron = c => { const v = parseFloat(String(c.band || '').replace(',', '.')); return isNaN(v) ? Infinity : v; };

/** Short label for the list row: the part of the tag before ' · '. */
export const shortTag = c => String(c.tag || c.name || c.id).split(' · ')[0];
/** Two-digit number shown in the list, from the id ('c03' → '03'). */
// Pipeline candidates are c01, c02…; ones added from the Field view have position ids (f-70.4235+19.2830) and show as "F".
export const shortId = c => { const m = String(c.id).match(/^c(\d+)$/); return m ? pad2(+m[1]) : String(c.id).startsWith('f-') ? 'F' : String(c.id); };

export function matches(c, f) {
  if (f.status && f.status !== 'all' && c.status !== f.status) return false;
  const q = String(f.query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [c.id, c.name, c.tag, c.status, c.band, c.note, c.match].filter(Boolean).join(' ').toLowerCase();
  return q.split(/\s+/).every(w => hay.includes(w));
}

const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
export function sortList(list, sort) {
  const out = list.slice();
  const cmp = {
    id: byId,
    shift: (a, b) => shiftDeg(a) - shiftDeg(b) || byId(a, b),          // slowest first: slow movers are the interesting ones
    band: (a, b) => bandMicron(a) - bandMicron(b) || byId(a, b),
    status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || byId(a, b),
  }[sort] || byId;
  return out.sort(cmp);
}
export const visible = (cands, f) => sortList((cands || []).filter(c => matches(c, f || {})), (f || {}).sort);

// ---------- export ----------
export function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const CSV_COLUMNS = ['id', 'name', 'status', 'pipeline_status', 'tag', 'match', 'peak_band', 'shift_arcmin', 'n_scans',
  'ra_hours_first', 'dec_deg_first', 'ra_hours_last', 'dec_deg_last', 'note', 'simulated'];

export function exportRow(c) {
  const p = observed(c), a = p[0] || [], b = p[p.length - 1] || [];
  return {
    id: c.id, name: c.name, status: c.status, pipeline_status: pipelineStatus(c), tag: c.tag, match: c.match || '',
    peak_band: c.band, shift_arcmin: +(shiftDeg(c) * 60).toFixed(3), n_scans: p.length,
    ra_hours_first: a[0], dec_deg_first: a[1], ra_hours_last: b[0], dec_deg_last: b[1],
    note: c.note || '', simulated: !!c.simulated,
  };
}
export function toCSV(list) {
  const lines = [CSV_COLUMNS.join(',')];
  list.forEach(c => { const r = exportRow(c); lines.push(CSV_COLUMNS.map(k => csvField(r[k])).join(',')); });
  return lines.join('\r\n') + '\r\n';
}
export function toJSON(list, meta = {}) {
  return JSON.stringify({
    ...meta,
    count: list.length,
    candidates: list.map(c => ({ ...exportRow(c), pos: c.pos || [] })),
  }, null, 2);
}
