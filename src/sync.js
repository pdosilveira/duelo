// Sincronização com o Supabase (REST). Tabelas só de inserção: votos imutáveis.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const syncEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);
const BASE = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
const PAGE = 1000;
const OVERLAP = 50; // relê alguns registros para não perder inserções concorrentes

function headers(extra = {}) {
  const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...extra };
  if (!SUPABASE_KEY.startsWith('sb_')) h.Authorization = 'Bearer ' + SUPABASE_KEY;
  return h;
}

async function req(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(BASE + path, { ...opts, headers: headers(opts.headers), signal: ctrl.signal });
    if (!res.ok) throw new Error(`sync ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function pushRows(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await req(`${table}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
  }
}

export async function pullRows(table, columns, afterSeq) {
  const out = [];
  let seq = Math.max(0, afterSeq - OVERLAP);
  for (;;) {
    const res = await req(`${table}?select=${columns}&seq=gt.${seq}&order=seq.asc&limit=${PAGE}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
    seq = rows[rows.length - 1].seq;
  }
  return out;
}

export const songToRow = (s, by) => ({
  id: s.id,
  title: s.title,
  artist: s.artist,
  album: s.album || '',
  art: s.art || '',
  preview: s.preview || '',
  link: s.link || '',
  itunes_id: s.itunesId ?? null,
  added_at: s.addedAt ?? Date.now(),
  added_by: by,
});

export const rowToSong = (r) => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  album: r.album || '',
  art: r.art || '',
  preview: r.preview || '',
  link: r.link || '',
  itunesId: r.itunes_id ?? null,
  addedAt: Number(r.added_at) || 0,
  archived: false,
});

export const voteToRow = (v) => ({ id: v.id, a: v.a, b: v.b, r: v.r, t: v.t, voter: v.voter });
export const rowToVote = (r) => ({ id: r.id, a: r.a, b: r.b, r: r.r, t: Number(r.t), voter: r.voter });
