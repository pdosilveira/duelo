import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, createState, applyVote } from '../src/engine.js';
import { pickDuel, isBlocked } from '../src/matchmaker.js';
import { makeSong, mulberry32, randomResult } from './helpers.js';

test('11. nunca repete música do duelo anterior nem par em cooldown', () => {
  for (const seed of [1, 2, 3]) {
    const rng = mulberry32(seed);
    const songs = Array.from({ length: 20 }, (_, i) => makeSong(i));
    const state = createState(songs);
    let t = Date.UTC(2026, 0, 1);
    let prev = null;
    for (let i = 0; i < 400; i++) {
      const d = pickDuel(state, t, rng);
      assert.ok(d && d.a !== d.b);
      if (prev) {
        assert.ok(!prev.includes(d.a) && !prev.includes(d.b), `duelo ${i} repetiu música do anterior`);
      }
      assert.ok(!isBlocked(state, d.a, d.b, t, songs.length), `duelo ${i} usou par em cooldown`);
      applyVote(state, { id: 's' + seed + 'v' + i, a: d.a, b: d.b, r: randomResult(rng), t });
      prev = [d.a, d.b];
      t += 20000;
    }
  }
});

test('11b. sem oponente elegível, o cooldown é relaxado', () => {
  const rng = mulberry32(5);
  const songs = Array.from({ length: 3 }, (_, i) => makeSong(i));
  const state = createState(songs);
  for (let i = 0; i < 30; i++) {
    const d = pickDuel(state, 1000 + i, rng);
    assert.ok(d);
    applyVote(state, { id: 'v' + i, a: d.a, b: d.b, r: 'D', t: 1000 + i });
  }
});

test('12. música recém-adicionada aparece pelo menos 6 vezes nos 40 duelos seguintes (catálogo de 40)', () => {
  for (const seed of [10, 20, 30, 40, 50]) {
    const rng = mulberry32(seed);
    const songs = Array.from({ length: 39 }, (_, i) => makeSong(i));
    const state = createState(songs);
    const strength = new Map(songs.map((s) => [s.id, (rng() - 0.5) * 4]));
    let t = Date.UTC(2026, 0, 1);
    const vote = (i, d) => {
      const diff = (strength.get(d.a) ?? 0) - (strength.get(d.b) ?? 0);
      const pA = 1 / (1 + Math.exp(-diff));
      const x = rng();
      const r = x < 0.1 ? 'D' : x < 0.1 + 0.9 * pA ? 'A' : 'B';
      applyVote(state, { id: 's' + seed + 'v' + i, a: d.a, b: d.b, r, t });
      t += 30000;
    };
    for (let i = 0; i < 400; i++) vote(i, pickDuel(state, t, rng));

    t += 3 * DAY;
    const fresh = makeSong(1000, t);
    state.songs.set(fresh.id, fresh);
    strength.set(fresh.id, 0);
    let count = 0;
    for (let i = 0; i < 40; i++) {
      const d = pickDuel(state, t, rng);
      if (d.a === fresh.id || d.b === fresh.id) count++;
      vote(1000 + i, d);
    }
    assert.ok(count >= 6, `seed ${seed}: apareceu ${count} vezes`);
  }
});
