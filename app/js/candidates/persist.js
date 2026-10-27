// Reviewer edits (status, note) persisted in localStorage, keyed by candidate id.
// Every access is wrapped: private windows, sandboxed previews and blocked site data all throw or return nothing.

export const KEY = 'planetx.review.v1';

let ok = null; // null = unknown, true/false after the first read or write

function storage() {
  try { return window.localStorage; } catch { return null; }
}

/** @returns {Record<string, {status?:string, pipelineStatus?:string, t?:number}>} */
export function loadAll() {
  try {
    const ls = storage(); if (!ls) { ok = false; return {}; }
    const raw = ls.getItem(KEY);
    ok = true;
    let v = {};
    try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; } // corrupt entry: start over, storage itself works
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { ok = false; return {}; }
}

/** Merge one candidate's review fields into storage. Returns true if it was written. */
export function save(id, fields) {
  try {
    const ls = storage(); if (!ls) { ok = false; return false; }
    const all = loadAll();
    all[id] = { ...(all[id] || {}), ...fields, t: Date.now() };
    ls.setItem(KEY, JSON.stringify(all));
    ok = true; return true;
  } catch { ok = false; return false; }
}

export const available = () => ok !== false;
