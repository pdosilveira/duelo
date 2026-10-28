// Modo Nota: a nota (1–10) só orienta a escolha dos duelos de ajuste.
// Não entra em nenhum cálculo de pontuação. Sem dependência do DOM.

import { getStat, currentRd } from './engine.js';

export const TUNE_DUELS = 5;

export const NOTES = [
  [10, 'Briga pra ser a maior música sertaneja da minha vida'],
  [9, 'Um absurdo de música, uma das minhas favoritas'],
  [8, 'Excelente música, marcou época'],
  [7, 'Música muito boa'],
  [6, 'Boa de ouvir'],
  [5, 'Não sou fã, mas ok'],
  [4, 'Se possível, prefiro pular essa'],
  [3, 'Música ruim'],
  [2, 'Péssima música'],
  [1, 'Uma das piores que eu já ouvi'],
];

// Fração do ranking (a partir do topo) onde cada nota costuma cair, enquanto há poucas notas.
const QUANTILE = { 10: 0.01, 9: 0.05, 8: 0.15, 7: 0.3, 6: 0.45, 5: 0.6, 4: 0.72, 3: 0.82, 2: 0.9, 1: 0.97 };
const SAME_NOTE_MIN = 3;

// Nota mais recente de cada música (por t, depois id).
export function latestNotes(notes) {
  const out = new Map();
  for (const x of notes) {
    const prev = out.get(x.song);
    if (!prev || x.t > prev.t || (x.t === prev.t && x.id > prev.id)) out.set(x.song, x);
  }
  return out;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Rating-alvo para o primeiro adversário: mediana das músicas com a mesma nota,
// ou a faixa correspondente do ranking atual. ids = músicas ativas.
export function noteTarget(state, ids, note, notes, exclude) {
  const tested = ids.filter((id) => id !== exclude && getStat(state, id).games > 0);
  const same = tested.filter((id) => notes.get(id)?.n === note).map((id) => getStat(state, id).rating);
  if (same.length >= SAME_NOTE_MIN) return median(same);
  if (!tested.length) return 1500;
  const ratings = tested.map((id) => getStat(state, id).rating).sort((a, b) => b - a);
  const i = Math.min(ratings.length - 1, Math.floor(QUANTILE[note] * ratings.length));
  return ratings[i];
}

// Adversário perto do alvo, preferindo referências confiáveis (RD baixo).
export function pickTuneOpponent(state, ids, songId, target, avoid, now, rng = Math.random) {
  const cands = ids.filter((id) => id !== songId && !avoid.has(id));
  const pool = cands.length ? cands : ids.filter((id) => id !== songId);
  if (!pool.length) return null;
  const scored = pool
    .map((id) => {
      const st = getStat(state, id);
      return { id, s: Math.abs(st.rating - target) + 0.5 * currentRd(st, now) };
    })
    .sort((a, b) => a.s - b.s || (a.id < b.id ? -1 : 1));
  const top = scored.slice(0, 5);
  return top[Math.floor(rng() * top.length)].id;
}

// Próxima música para avaliar: sem nota ainda, as menos testadas primeiro.
export function pickSongToRate(state, ids, notes, skip, rng = Math.random) {
  const pool = ids.filter((id) => !notes.has(id) && !skip.has(id));
  if (!pool.length) return null;
  let min = Infinity;
  for (const id of pool) min = Math.min(min, getStat(state, id).games);
  const least = pool.filter((id) => getStat(state, id).games === min);
  return least[Math.floor(rng() * least.length)];
}
