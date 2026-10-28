import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, getStat } from '../src/engine.js';
import { latestNotes, noteTarget, pickTuneOpponent, pickSongToRate } from '../src/tune.js';
import { makeSong, mulberry32 } from './helpers.js';

function world() {
  const songs = Array.from({ length: 30 }, (_, i) => makeSong(i));
  // i vence j sempre que i < j: força decrescente com o índice
  const votes = [];
  let t = 1000;
  for (let k = 0; k < 300; k++) {
    const i = k % 29;
    const j = i + 1 + (k % 3 === 0 ? 1 : 0);
    if (j >= 30) continue;
    votes.push({ id: 'v' + k, a: songs[i].id, b: songs[j].id, r: 'A', t: (t += 1000) });
  }
  return { songs, state: replay(songs, votes), ids: songs.map((s) => s.id) };
}

test('nota: só escolhe adversários; nota alta mira o topo, baixa mira o fundo', () => {
  const { songs, state, ids } = world();
  const fresh = makeSong(99);
  state.songs.set(fresh.id, fresh);
  const all = [...ids, fresh.id];
  const before = { ...getStat(state, fresh.id) };
  const hi = noteTarget(state, all, 10, new Map(), fresh.id);
  const lo = noteTarget(state, all, 1, new Map(), fresh.id);
  assert.ok(hi > lo + 100, `${hi} ${lo}`);
  const oppHi = pickTuneOpponent(state, all, fresh.id, hi, new Set(), 1e6, mulberry32(1));
  const oppLo = pickTuneOpponent(state, all, fresh.id, lo, new Set(), 1e6, mulberry32(1));
  assert.ok(getStat(state, oppHi).rating > getStat(state, oppLo).rating);
  assert.ok(ids.indexOf(oppHi) < 8, 'adversário da nota 10 vem do topo');
  assert.ok(ids.indexOf(oppLo) > 21, 'adversário da nota 1 vem do fundo');
  // a nota não alterou a pontuação da música
  assert.deepEqual(getStat(state, fresh.id), before);
  void songs;
});

test('nota: com 3+ músicas de mesma nota, mira a mediana delas', () => {
  const { state, ids } = world();
  const notes = latestNotes([
    { id: 'n1', song: ids[20], n: 7, t: 1 },
    { id: 'n2', song: ids[21], n: 7, t: 1 },
    { id: 'n3', song: ids[22], n: 7, t: 1 },
    { id: 'n4', song: ids[22], n: 2, t: 0 }, // mais antiga, ignorada
  ]);
  assert.equal(notes.get(ids[22]).n, 7);
  const target = noteTarget(state, ids, 7, notes, null);
  assert.equal(target, getStat(state, ids[21]).rating);
});

test('nota: próxima música é uma sem nota, das menos testadas', () => {
  const { state, ids } = world();
  const fresh = makeSong(99);
  state.songs.set(fresh.id, fresh);
  const all = [...ids, fresh.id];
  assert.equal(pickSongToRate(state, all, new Map(), new Set()), fresh.id);
  const notes = latestNotes([{ id: 'x', song: fresh.id, n: 5, t: 1 }]);
  const next = pickSongToRate(state, all, notes, new Set());
  assert.ok(next && next !== fresh.id);
  assert.equal(pickSongToRate(state, [fresh.id], notes, new Set()), null);
});
