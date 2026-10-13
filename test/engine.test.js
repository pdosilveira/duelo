import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, replay, applyVote, createState, currentRd, ranking, songId, normalizeText, getStat, mergeData } from '../src/engine.js';
import { makeSong, mulberry32, randomResult } from './helpers.js';

function snapshot(state) {
  const out = {};
  for (const [id, st] of [...state.stats.entries()].sort()) out[id] = { ...st };
  return out;
}

test('5. 40 duelos seguidos no mesmo dia levam o RD abaixo de 90', () => {
  const rng = mulberry32(7);
  const songs = Array.from({ length: 10 }, (_, i) => makeSong(i));
  const target = songs[0].id;
  const votes = [];
  const t0 = Date.UTC(2026, 0, 10, 12);
  for (let i = 0; i < 40; i++) {
    const opp = songs[1 + (i % 9)].id;
    votes.push({ id: 'v' + i, a: target, b: opp, r: randomResult(rng), t: t0 + i * 60000 });
  }
  const state = replay(songs, votes);
  const st = state.stats.get(target);
  assert.equal(st.games, 40);
  const rd = currentRd(st, t0 + 40 * 60000);
  assert.ok(rd < 90, `rd ${rd}`);
});

test('6. voto duplicado (mesmo id) conta uma vez só', () => {
  const [a, b] = [makeSong(1), makeSong(2)];
  const v = { id: 'x1', a: a.id, b: b.id, r: 'A', t: 10 };
  const state = replay([a, b], [v, { ...v }, v]);
  assert.equal(state.stats.get(a.id).games, 1);
  assert.equal(applyVote(state, v), false);
  assert.equal(state.stats.get(b.id).games, 1);
  assert.equal(state.history.count, 1);
});

test('7. replay determinístico, independente da ordem de chegada', () => {
  const rng = mulberry32(42);
  const songs = Array.from({ length: 12 }, (_, i) => makeSong(i));
  const votes = [];
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(rng() * 12);
    let y = Math.floor(rng() * 11);
    if (y >= x) y++;
    // alguns votos com o mesmo t para exercitar o desempate por id
    votes.push({ id: 'v' + String(i).padStart(4, '0'), a: songs[x].id, b: songs[y].id, r: randomResult(rng), t: 1000 + Math.floor(i / 3) * DAY / 10 });
  }
  const base = snapshot(replay(songs, votes));
  for (let k = 0; k < 5; k++) {
    const shuffled = votes.slice().sort(() => rng() - 0.5);
    const shuffledSongs = songs.slice().reverse();
    assert.deepEqual(snapshot(replay(shuffledSongs, shuffled)), base);
  }
});

test('8. música nova não altera o estado das existentes', () => {
  const rng = mulberry32(3);
  const songs = Array.from({ length: 6 }, (_, i) => makeSong(i));
  const votes = [];
  for (let i = 0; i < 50; i++) {
    const x = i % 6;
    const y = (x + 1 + Math.floor(rng() * 5)) % 6;
    votes.push({ id: 'v' + i, a: songs[x].id, b: songs[y].id, r: randomResult(rng), t: 1000 + i * 1000 });
  }
  const before = replay(songs, votes);
  const newcomer = makeSong(99, 30000);
  const after = replay([...songs, newcomer], votes);
  assert.deepEqual(snapshot(after), snapshot(before));
  const st = getStat(after, newcomer.id);
  assert.equal(st.rating, 1500);
  assert.equal(st.rd, 350);
  assert.equal(st.vol, 0.06);
});

test('9. uma vitória isolada não supera música consolidada no ranking conservador', () => {
  const rng = mulberry32(11);
  const songs = Array.from({ length: 8 }, (_, i) => makeSong(i));
  const [solid, ...others] = songs;
  const votes = [];
  let t = 1000;
  for (let i = 0; i < 40; i++) {
    const o = others[i % 5].id;
    votes.push({ id: 'c' + i, a: solid.id, b: o, r: rng() < 0.55 ? 'A' : 'D', t: (t += 1000) });
  }
  const lucky = others[5];
  const victim = others[6];
  votes.push({ id: 'z1', a: lucky.id, b: victim.id, r: 'A', t: (t += 1000) });
  const state = replay(songs, votes);
  const rows = ranking(state, t);
  const pos = (id) => rows.findIndex((r) => r.song.id === id);
  assert.ok(state.stats.get(lucky.id).rating > 1500);
  assert.ok(pos(solid.id) < pos(lucky.id));
  assert.equal(pos(solid.id), 0);
});

test('10. deduplicação do catálogo por normalização', () => {
  assert.equal(songId('The Beatles', 'Let It Be (Remastered 2009)'), songId('the beatles', 'Let It Be'));
  assert.equal(songId('Caetano Veloso', 'Leãozinho [Ao Vivo]'), songId('CAETANO VELOSO', 'Leaozinho'));
  assert.equal(songId('Tom Jobim', 'Águas de Março'), songId('tom jobim', 'aguas de marco'));
  assert.equal(songId('Artista', 'Título!!  '), songId('artista', 'titulo'));
  assert.notEqual(songId('Artista', 'Uma'), songId('Artista', 'Outra'));
  assert.notEqual(songId('Artista', 'ア'), songId('Artista', 'イ'));
  assert.equal(normalizeText('  Olá, (feat. X) Mundo! '), 'ola mundo');

  const local = { songs: [makeSong(1)], votes: [{ id: 'a', a: 'x', b: 'y', r: 'A', t: 1 }] };
  const incoming = { songs: [makeSong(1), makeSong(2)], votes: [{ id: 'a', a: 'x', b: 'y', r: 'B', t: 1 }, { id: 'b', a: 'x', b: 'y', r: 'D', t: 2 }] };
  const merged = mergeData(local, incoming);
  assert.equal(merged.songs.length, 2);
  assert.equal(merged.votes.length, 2);
  assert.equal(merged.votes.find((v) => v.id === 'a').r, 'A');
  assert.ok(createState(merged.songs).songs.size === 2);
});
