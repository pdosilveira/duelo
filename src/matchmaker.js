// Seleção de duelos: âncora por RD² × rotatividade; oponente por ganho de informação.
// Sem dependência do DOM.

import { g, expected, toMu, toPhi } from './glicko2.js';
import { DAY, getStat, currentRd, pairKey } from './engine.js';

export const MM = Object.freeze({
  explore: 0.1,
  rotK: 1.5,
  power: 3,
  cooldownMin: 15,
  cooldownMax: 300,
  cooldownDays: 21,
});

export function weightedPick(items, weightFn, rng = Math.random) {
  const w = items.map((x) => {
    const v = weightFn(x);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const total = w.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= w[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

// Redução esperada de variância (escala Glicko-2) de A e de B num duelo entre eles.
export function pairGain(ra, phiA, rb, phiB) {
  const muA = toMu(ra);
  const muB = toMu(rb);
  const eA = expected(muA, muB, phiB);
  const eB = expected(muB, muA, phiA);
  const gB = g(phiB);
  const gA = g(phiA);
  const redA = phiA * phiA - 1 / (1 / (phiA * phiA) + gB * gB * eA * (1 - eA));
  const redB = phiB * phiB - 1 / (1 / (phiB * phiB) + gA * gA * eB * (1 - eB));
  return redA + redB;
}

export function cooldownLength(n) {
  return Math.min(MM.cooldownMax, Math.max(MM.cooldownMin, 2 * n));
}

export function isBlocked(state, a, b, now, n) {
  const h = state.history;
  const p = h.pairs.get(pairKey(a, b));
  if (!p) return false;
  return h.count - p.lastIndex < cooldownLength(n) && now - p.lastT < MM.cooldownDays * DAY;
}

// Retorna {a, b} (esquerda/direita já sorteadas) ou null se houver menos de 2 músicas.
export function pickDuel(state, now, rng = Math.random) {
  const ids = [];
  for (const s of state.songs.values()) if (!s.archived) ids.push(s.id);
  ids.sort();
  const n = ids.length;
  if (n < 2) return null;

  const h = state.history;
  const appear = new Map();
  for (const [a, b] of h.recent) {
    appear.set(a, (appear.get(a) || 0) + 1);
    appear.set(b, (appear.get(b) || 0) + 1);
  }
  const rot = (id) => 1 / (1 + MM.rotK * (appear.get(id) || 0));

  const info = new Map();
  for (const id of ids) {
    const st = getStat(state, id);
    const rd = currentRd(st, now);
    info.set(id, { rating: st.rating, rd, phi: toPhi(rd) });
  }

  const exclude = new Set(n >= 4 && h.last ? h.last : []);
  const pool = ids.filter((id) => !exclude.has(id));
  const opponents = (anchor, cooldown) =>
    ids.filter((id) => id !== anchor && !exclude.has(id) && !(cooldown && isBlocked(state, anchor, id, now, n)));

  const anchorWeight = (id) => info.get(id).rd ** 2 * rot(id);

  let first = null;
  let anchor = null;
  let cands = [];
  const remaining = pool.slice();
  while (remaining.length) {
    const pick = weightedPick(remaining, anchorWeight, rng);
    if (first == null) first = pick;
    const c = opponents(pick, true);
    if (c.length) {
      anchor = pick;
      cands = c;
      break;
    }
    remaining.splice(remaining.indexOf(pick), 1);
  }
  if (anchor == null) {
    // Nenhum par fora do cooldown: relaxa o cooldown.
    anchor = first;
    cands = opponents(anchor, false);
  }

  let opp;
  if (rng() < MM.explore) {
    opp = cands[Math.floor(rng() * cands.length)];
  } else {
    const A = info.get(anchor);
    opp = weightedPick(
      cands,
      (id) => {
        const B = info.get(id);
        const enc = h.pairs.get(pairKey(anchor, id))?.n || 0;
        return (pairGain(A.rating, A.phi, B.rating, B.phi) * rot(id) * (1 / (1 + enc))) ** MM.power;
      },
      rng
    );
  }

  return rng() < 0.5 ? { a: anchor, b: opp } : { a: opp, b: anchor };
}

// Seleção uniforme (usada só na simulação, como base de comparação).
export function pickRandom(state, rng = Math.random) {
  const ids = [];
  for (const s of state.songs.values()) if (!s.archived) ids.push(s.id);
  if (ids.length < 2) return null;
  const i = Math.floor(rng() * ids.length);
  let j = Math.floor(rng() * (ids.length - 1));
  if (j >= i) j++;
  return { a: ids[i], b: ids[j] };
}
