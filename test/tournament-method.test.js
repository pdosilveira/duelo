import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyVote, getStat } from '../src/engine.js';
import { pickDuel, pickParticipants, pairByInformation } from '../src/matchmaker.js';
import { createCup } from '../src/cup.js';
import { createSwiss, currentSwissMatch, recordSwiss, swissDone, table } from '../src/swiss.js';
import { makeSong, mulberry32 } from './helpers.js';

// 30 músicas bem testadas (força conhecida) + 10 novas
function world(seed) {
  const rng = mulberry32(seed);
  const old = Array.from({ length: 30 }, (_, i) => makeSong(i));
  const state = createState(old);
  const strength = new Map(old.map((s, i) => [s.id, (15 - i) / 5]));
  let t = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 600; i++) {
    const d = pickDuel(state, t, rng);
    const p = 1 / (1 + Math.exp(-(strength.get(d.a) - strength.get(d.b))));
    applyVote(state, { id: 'v' + i, a: d.a, b: d.b, r: rng() < p ? 'A' : 'B', t });
    t += 20000;
  }
  const fresh = Array.from({ length: 10 }, (_, i) => makeSong(100 + i, t));
  for (const s of fresh) state.songs.set(s.id, s);
  return { rng, state, t, old: old.map((s) => s.id), fresh: fresh.map((s) => s.id) };
}

test('torneio: participantes favorecem músicas incertas (peso RD²)', () => {
  const { rng, state, t, old, fresh } = world(1);
  const ids = [...old, ...fresh];
  let freshCount = 0;
  const runs = 50;
  for (let k = 0; k < runs; k++) {
    const picked = pickParticipants(state, ids, 16, t, rng);
    assert.equal(new Set(picked).size, 16);
    freshCount += picked.filter((id) => fresh.includes(id)).length;
  }
  const avgFresh = freshCount / runs;
  assert.ok(avgFresh > 8, `média de novas por torneio: ${avgFresh} (sorteio puro daria 4)`);
});

test('torneio: emparelhamento completo, respeita proibição e prefere notas próximas', () => {
  // sem histórico (sem resfriamento nem repetição): só o ganho de informação decide
  const rng = mulberry32(2);
  const songs = Array.from({ length: 16 }, (_, i) => makeSong(i));
  const state = createState(songs);
  const t = 1e6;
  songs.forEach((s, i) => Object.assign(getStat(state, s.id), { rating: 1100 + i * 50, rd: 70, updatedAt: t }));
  const ids = songs.map((s) => s.id);
  const gap = (pairs) => pairs.reduce((s, [a, b]) => s + Math.abs(getStat(state, a).rating - getStat(state, b).rating), 0) / pairs.length;
  let infoGap = 0;
  let randGap = 0;
  for (let k = 0; k < 40; k++) {
    const pairs = pairByInformation(state, ids, t, rng);
    assert.equal(pairs.length, 8);
    assert.equal(new Set(pairs.flat()).size, 16);
    infoGap += gap(pairs);
    const sh = ids.slice().sort(() => rng() - 0.5);
    randGap += gap(Array.from({ length: 8 }, (_, i) => [sh[2 * i], sh[2 * i + 1]]));
  }
  assert.ok(infoGap < randGap * 0.8, `diferença média ${infoGap / 40} vs aleatório ${randGap / 40}`);
  const banned = (a, b) => (a === ids[0] && b === ids[1]) || (a === ids[1] && b === ids[0]);
  for (let k = 0; k < 20; k++) {
    const pairs = pairByInformation(state, ids, t, rng, banned);
    assert.ok(!pairs.some(([a, b]) => banned(a, b)));
  }
  assert.equal(pairByInformation(state, ids.slice(0, 3), t, rng), null);
});

test('torneio: mata-mata e suíço com a metodologia mantêm as regras do formato', () => {
  const { rng, state, t, old, fresh } = world(3);
  const ids = [...old, ...fresh];
  let n = 0;
  const newId = () => 'x' + n++;
  const opts = {
    select: (xs, k) => pickParticipants(state, xs, k, t, rng),
    pair: (xs, forbid) => pairByInformation(state, xs, t, rng, forbid),
  };
  const cup = createCup(ids, newId, rng, t, opts);
  assert.equal(new Set(cup.rounds[0].flatMap((m) => [m.a, m.b])).size, 16);

  const sw = createSwiss(ids, newId, rng, t, opts);
  let games = 0;
  for (let cur = currentSwissMatch(sw); cur; cur = currentSwissMatch(sw)) {
    if (cur.round === 1 && cur.index === 0 && sw.rounds[0].every((m) => m.r !== 'D')) {
      const pts = new Map(table({ ...sw, rounds: sw.rounds.slice(0, 1) }).map((r) => [r.id, r.pts]));
      for (const m of sw.rounds[1]) assert.equal(pts.get(m.a), pts.get(m.b), 'mesma pontuação');
    }
    recordSwiss(sw, rng() < 0.5 ? 'A' : 'B', newId, rng, opts);
    games++;
  }
  assert.ok(swissDone(sw));
  assert.equal(games, 32);
  const seen = new Set();
  for (const round of sw.rounds) {
    assert.equal(new Set(round.flatMap((m) => [m.a, m.b])).size, 16);
    for (const m of round) {
      const k = [m.a, m.b].sort().join('|');
      assert.ok(!seen.has(k), 'sem revanche');
      seen.add(k);
    }
  }
});
