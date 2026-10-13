import { songId } from '../src/engine.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSong(i, addedAt = 0) {
  const title = 'Faixa ' + i;
  const artist = 'Artista ' + (i % 7);
  return { id: songId(artist, title), title, artist, addedAt, archived: false };
}

export function randomResult(rng, pDraw = 0.15) {
  const x = rng();
  return x < pDraw ? 'D' : x < (1 + pDraw) / 2 ? 'A' : 'B';
}
