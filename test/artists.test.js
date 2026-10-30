import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, getStat, songId, replay } from '../src/engine.js';
import { creditArtists, rankArtists } from '../src/artists.js';
import { pickOpponentFor } from '../src/matchmaker.js';
import { mulberry32 } from './helpers.js';

const song = (artist, title) => ({ id: songId(artist, title), artist, title, addedAt: 0 });

test('artistas: parcerias contam para cada artista; duplas continuam duplas', () => {
  const songs = [
    song('Jorge & Mateus', 'A'),
    song('Jorge & Mateus', 'A2'),
    song('Jorge & Mateus', 'A3'),
    song('Gusttavo Lima', 'B'),
    song('Xand Avião & Gusttavo Lima', 'C'),
    song('Leandro & Leonardo', 'D'),
    song('Leandro & Leonardo', 'D2'),
    song('Leandro & Leonardo', 'D3'),
    song('Leandro & Leonardo', 'D4'),
    song('Leandro & Leonardo', 'D5'),
    song('Leandro & Leonardo', 'D6'),
    song('Leonardo', 'E'),
    song('Os Barões da Pisadinha & Fernando & Sorocaba', 'F'),
    song('Fernando & Sorocaba', 'G'),
    song('Fernando & Sorocaba', 'G2'),
    song('Fernando & Sorocaba', 'G3'),
    song('Os Barões da Pisadinha', 'H'),
    song('Matogrosso e Mathias', 'I'),
    song('Xand Avião', 'J'),
    song('Gustavo Mioto', 'K'),
    song('Gustavo Mioto & Anitta', 'L'),
    song('Daniel', 'M'),
    song('Daniel Caesar', 'N'),
    song('George Henrique & Rodrigo & Jorge e Mateus', 'O'),
  ];
  const c = creditArtists(songs);
  const of = (t) => c.get(songs.find((s) => s.title === t).id).sort();
  assert.deepEqual(of('A'), ['Jorge & Mateus']);
  assert.deepEqual(of('C'), ['Gusttavo Lima', 'Xand Avião']);
  assert.deepEqual(of('D'), ['Leandro & Leonardo']);
  assert.deepEqual(of('F'), ['Fernando & Sorocaba', 'Os Barões da Pisadinha']);
  assert.deepEqual(of('I'), ['Matogrosso e Mathias']);
  assert.deepEqual(of('L'), ['Gustavo Mioto']);
  assert.deepEqual(of('N'), ['Daniel Caesar']);
  assert.deepEqual(of('O'), ['Jorge & Mateus']);
});

test('artistas: um único hit não passa quem tem 5 músicas fortes e testadas', () => {
  const songs = [...['1', '2', '3', '4', '5', '6'].map((t) => song('Dupla Forte', t)), song('Um Hit', 'x'), song('Fraco', 'y')];
  const state = createState(songs);
  const set = (s, rating, rd) => Object.assign(getStat(state, s.id), { rating, rd, updatedAt: 0, games: 10 });
  songs.slice(0, 6).forEach((s, i) => set(s, 1700 - i * 10, 60));
  set(songs[6], 1800, 250); // um hit, pouco testado
  set(songs[7], 1300, 60);
  const rows = rankArtists(state, songs, 0);
  assert.deepEqual(rows.map((r) => r.name), ['Dupla Forte', 'Um Hit', 'Fraco']);
  assert.equal(rows[0].best.title, '1');
  assert.equal(rows[0].songs.length, 6);
});

test('calibrar: adversária respeita a metodologia (nunca a própria, evita repetidas)', () => {
  const songs = Array.from({ length: 20 }, (_, i) => song('A' + (i % 4), 'T' + i));
  const state = replay(songs, []);
  const rng = mulberry32(3);
  const anchor = songs[0].id;
  const used = new Set();
  for (let i = 0; i < 5; i++) {
    const o = pickOpponentFor(state, anchor, 1e6, rng, used);
    assert.ok(o && o !== anchor && !used.has(o));
    used.add(o);
  }
  assert.equal(used.size, 5);
});
