// Estado derivado: votos imutáveis → replay determinístico → estatísticas por música.
// Sem dependência do DOM.

import { DEFAULTS, PARAMS, update, inflateRd } from './glicko2.js';

export const DAY = 86400000;

export const CONFIG = Object.freeze({
  periodDays: 30, // 1 período de classificação
  K: 2, // pontuação conservadora = rating − K·RD
  recentWindow: 30, // janela de rotatividade (duelos)
});

const PERIOD_MS = CONFIG.periodDays * DAY;

// ---------- identidade das músicas ----------

export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Para títulos sem nenhum caractere latino (ex.: japonês), a normalização ficaria
// vazia e colidiria; nesse caso usa o texto original em minúsculas.
function keyPart(s) {
  return normalizeText(s) || String(s ?? '').toLowerCase().trim();
}

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function songId(artist, title) {
  return 's' + cyrb53(keyPart(artist) + '|' + keyPart(title)).toString(36);
}

// ---------- votos ----------

export function compareVotes(a, b) {
  if (a.t !== b.t) return a.t - b.t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isValidVote(v) {
  return (
    v != null &&
    typeof v.id === 'string' &&
    typeof v.a === 'string' &&
    typeof v.b === 'string' &&
    v.a !== v.b &&
    (v.r === 'A' || v.r === 'B' || v.r === 'D') &&
    Number.isFinite(v.t)
  );
}

export function pairKey(a, b) {
  return a < b ? a + '|' + b : b + '|' + a;
}

// ---------- estado ----------

function newStat(song) {
  const added = Number.isFinite(song.addedAt) ? song.addedAt : 0;
  return {
    rating: DEFAULTS.rating,
    rd: DEFAULTS.rd,
    vol: DEFAULTS.vol,
    games: 0,
    w: 0,
    d: 0,
    l: 0,
    addedAt: added,
    lastDuel: null,
    updatedAt: added,
  };
}

export function createState(songs = []) {
  const map = new Map();
  for (const s of songs) map.set(s.id, s);
  return {
    songs: map,
    stats: new Map(),
    seen: new Set(),
    lastVote: null,
    history: { count: 0, recent: [], pairs: new Map(), last: null },
  };
}

export function getStat(state, id) {
  let st = state.stats.get(id);
  if (!st) {
    const song = state.songs.get(id);
    if (!song) return null;
    st = newStat(song);
    state.stats.set(id, st);
  }
  return st;
}

function elapsedPeriods(from, to) {
  return Math.max(0, to - from) / PERIOD_MS;
}

// Aplica um voto ao estado (as duas músicas a partir dos valores pré-duelo).
// Retorna false se duplicado ou inválido. Deve ser chamado em ordem (t, id).
export function applyVote(state, vote, params = PARAMS) {
  if (!isValidVote(vote) || state.seen.has(vote.id)) return false;
  const sa = getStat(state, vote.a);
  const sb = getStat(state, vote.b);
  if (!sa || !sb) return false;
  state.seen.add(vote.id);

  const ea = elapsedPeriods(sa.updatedAt, vote.t);
  const eb = elapsedPeriods(sb.updatedAt, vote.t);
  const scoreA = vote.r === 'A' ? 1 : vote.r === 'B' ? 0 : 0.5;

  const aOpp = { rating: sa.rating, rd: inflateRd(sa.rd, sa.vol, ea, params), score: 1 - scoreA };
  const bOpp = { rating: sb.rating, rd: inflateRd(sb.rd, sb.vol, eb, params), score: scoreA };

  const na = update(sa, [bOpp], ea, params);
  const nb = update(sb, [aOpp], eb, params);

  Object.assign(sa, na);
  Object.assign(sb, nb);
  for (const [st, s] of [[sa, scoreA], [sb, 1 - scoreA]]) {
    st.games++;
    if (s === 1) st.w++;
    else if (s === 0) st.l++;
    else st.d++;
    st.lastDuel = vote.t;
    st.updatedAt = Math.max(st.updatedAt, vote.t);
  }

  const h = state.history;
  h.count++;
  h.recent.push([vote.a, vote.b]);
  if (h.recent.length > CONFIG.recentWindow) h.recent.shift();
  const key = pairKey(vote.a, vote.b);
  const p = h.pairs.get(key) || { n: 0, lastIndex: 0, lastT: 0 };
  p.n++;
  p.lastIndex = h.count;
  p.lastT = vote.t;
  h.pairs.set(key, p);
  h.last = [vote.a, vote.b];

  state.lastVote = vote;
  return true;
}

export function sortVotes(votes) {
  return votes.filter(isValidVote).sort(compareVotes);
}

export function replay(songs, votes, params = PARAMS) {
  const state = createState(songs);
  for (const v of sortVotes(votes)) applyVote(state, v, params);
  return state;
}

// ---------- leitura ----------

export function currentRd(stat, now, params = PARAMS) {
  return inflateRd(stat.rd, stat.vol, elapsedPeriods(stat.updatedAt, now), params);
}

export function confidence(rd) {
  if (rd < 80) return 'Posição firme';
  if (rd < 150) return 'Ainda ajustando';
  return 'Pouco testada';
}

export function ranking(state, now, K = CONFIG.K) {
  const rows = [];
  for (const song of state.songs.values()) {
    if (song.archived) continue;
    const stat = getStat(state, song.id);
    const rd = currentRd(stat, now);
    rows.push({
      song,
      stat,
      rd,
      score: stat.rating - K * rd,
      low: stat.rating - K * rd,
      high: stat.rating + K * rd,
      confidence: confidence(rd),
    });
  }
  rows.sort(
    (x, y) =>
      y.score - x.score ||
      y.stat.rating - x.stat.rating ||
      (x.song.id < y.song.id ? -1 : x.song.id > y.song.id ? 1 : 0)
  );
  return rows;
}

// ---------- backup ----------

export function mergeData(local, incoming) {
  const songs = new Map();
  for (const s of local.songs || []) songs.set(s.id, s);
  for (const s of incoming.songs || []) {
    if (s && typeof s.id === 'string' && !songs.has(s.id)) songs.set(s.id, s);
  }
  const votes = new Map();
  for (const v of local.votes || []) votes.set(v.id, v);
  for (const v of incoming.votes || []) {
    if (isValidVote(v) && !votes.has(v.id)) votes.set(v.id, v);
  }
  return { songs: [...songs.values()], votes: [...votes.values()] };
}
