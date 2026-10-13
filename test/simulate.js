// Simulação: seleção adaptativa vs. aleatória.
// Uso: node test/simulate.js [duelos por música] [semente]
// Forças reais aleatórias; votos por Bradley-Terry com probabilidade de empate.

import { DAY, createState, applyVote, ranking, getStat, currentRd } from '../src/engine.js';
import { pickDuel, pickRandom } from '../src/matchmaker.js';
import { mulberry32, makeSong } from './helpers.js';

const PER_SONG = Number(process.argv[2]) || 20; // duelos por música (cada duelo conta para 2)
const SEED = Number(process.argv[3]) || 1;
const NEW_FRAC = 0.05; // músicas novas inseridas depois do orçamento inicial
const INTEGRATED_RD = 150; // "integrada" = sai de "Pouco testada"

function gauss(rng) {
  const u = rng() || 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function spearman(xs, ys) {
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function run(n, mode, seed) {
  const rng = mulberry32(seed);
  const truth = new Map();
  const songs = Array.from({ length: n }, (_, i) => makeSong(i));
  for (const s of songs) truth.set(s.id, gauss(rng) * 1.2);
  const state = createState(songs);
  let t = Date.UTC(2026, 0, 1);
  let vid = 0;

  const duel = () => {
    const d = mode === 'adaptativa' ? pickDuel(state, t, rng) : pickRandom(state, rng);
    const diff = truth.get(d.a) - truth.get(d.b);
    const pDraw = 0.3 * Math.exp(-Math.abs(diff));
    const pA = (1 - pDraw) / (1 + Math.exp(-diff));
    const x = rng();
    const r = x < pDraw ? 'D' : x < pDraw + pA ? 'A' : 'B';
    applyVote(state, { id: 'v' + vid++, a: d.a, b: d.b, r, t });
    t += 15000;
    if (vid % 60 === 0) t += DAY; // sessões de 60 duelos por dia
    return d;
  };

  const budget = (PER_SONG * n) / 2;
  for (let i = 0; i < budget; i++) duel();

  const rows = ranking(state, t);
  const ids = rows.map((r) => r.song.id);
  const est = new Map(rows.map((r, i) => [r.song.id, -i]));
  const rho = spearman(ids.map((id) => truth.get(id)), ids.map((id) => est.get(id)));
  const trueTop = new Set([...truth.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map((e) => e[0]));
  const top20 = ids.slice(0, 20).filter((id) => trueTop.has(id)).length / 20;
  const games = ids.map((id) => getStat(state, id).games);

  // Integração de músicas novas
  const k = Math.max(5, Math.round(n * NEW_FRAC));
  const fresh = [];
  for (let i = 0; i < k; i++) {
    const s = makeSong(100000 + i, t);
    truth.set(s.id, gauss(rng) * 1.2);
    state.songs.set(s.id, s);
    fresh.push(s.id);
  }
  const integratedAt = new Map();
  const limit = 3 * n;
  for (let i = 1; i <= limit && integratedAt.size < k; i++) {
    duel();
    for (const id of fresh) {
      if (!integratedAt.has(id) && currentRd(getStat(state, id), t) < INTEGRATED_RD) integratedAt.set(id, i);
    }
  }
  const integ = fresh.map((id) => integratedAt.get(id) ?? limit);
  const meanInteg = integ.reduce((a, b) => a + b, 0) / k;

  return { rho, top20, min: Math.min(...games), max: Math.max(...games), meanInteg, pending: k - integratedAt.size };
}

const f = (x, d = 3) => x.toFixed(d);
console.log(`Simulação — ${PER_SONG} duelos por música, semente ${SEED}`);
console.log('N    seleção     Spearman  top20  duelos(min–max)  integração (duelos até RD<150)');
for (const n of [100, 200, 500]) {
  const res = {};
  for (const mode of ['adaptativa', 'aleatória']) {
    const r = run(n, mode, SEED * 1000 + n);
    res[mode] = r;
    console.log(
      `${String(n).padEnd(4)} ${mode.padEnd(11)} ${f(r.rho).padStart(8)}  ${f(r.top20, 2).padStart(5)}  ${String(r.min).padStart(6)}–${String(r.max).padEnd(8)} ${f(r.meanInteg, 1).padStart(8)}${r.pending ? ` (${r.pending} não integradas)` : ''}`
    );
  }
  console.log(`     integração ${f(res['aleatória'].meanInteg / res.adaptativa.meanInteg, 1)}x mais rápida na adaptativa\n`);
}
