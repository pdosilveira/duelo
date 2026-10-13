import test from 'node:test';
import assert from 'node:assert/strict';
import { update, DEFAULTS } from '../src/glicko2.js';
import { DAY, replay, currentRd, songId } from '../src/engine.js';
import { makeSong } from './helpers.js';

test('1. exemplo oficial do Glickman (2012)', () => {
  const r = update(
    { rating: 1500, rd: 200, vol: 0.06 },
    [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ],
    1,
    { minRd: null }
  );
  assert.ok(Math.abs(r.rating - 1464.06) < 0.01, `rating ${r.rating}`);
  assert.ok(Math.abs(r.rd - 151.52) < 0.01, `rd ${r.rd}`);
  assert.ok(Math.abs(r.vol - 0.05999) < 0.00001, `vol ${r.vol}`);
});

test('2. empate: entre iguais não move rating e reduz RD; contra mais forte sobe; contra mais fraco desce', () => {
  const p = { ...DEFAULTS };
  const r = update(p, [{ rating: 1500, rd: 350, score: 0.5 }], 0);
  assert.ok(Math.abs(r.rating - 1500) < 1e-9);
  assert.ok(r.rd < 350);

  const weak = { rating: 1500, rd: 100, vol: 0.06 };
  const strong = { rating: 1700, rd: 100, vol: 0.06 };
  const w2 = update(weak, [{ ...strong, score: 0.5 }], 0);
  const s2 = update(strong, [{ ...weak, score: 0.5 }], 0);
  assert.ok(w2.rating > weak.rating);
  assert.ok(s2.rating < strong.rating);
});

test('3. música com RD alto move mais que uma estabelecida', () => {
  const opp = { rating: 1500, rd: 100, score: 1 };
  const fresh = update({ rating: 1500, rd: 350, vol: 0.06 }, [opp], 0);
  const settled = update({ rating: 1500, rd: 60, vol: 0.06 }, [opp], 0);
  assert.ok(fresh.rating - 1500 > 3 * (settled.rating - 1500));
});

test('4. sem duelo, o RD cresce com o tempo e respeita o teto', () => {
  const songs = [makeSong(1), makeSong(2), makeSong(3)];
  const votes = [];
  for (let i = 0; i < 60; i++) {
    votes.push({ id: 'v' + i, a: songs[i % 3].id, b: songs[(i + 1) % 3].id, r: 'D', t: 1000 + i });
  }
  const st = replay(songs, votes).stats.get(songs[0].id);
  const t0 = 2000;
  const rd0 = currentRd(st, t0);
  const rd30 = currentRd(st, t0 + 30 * DAY);
  const rd365 = currentRd(st, t0 + 365 * DAY);
  const rdFar = currentRd(st, t0 + 1e5 * DAY);
  assert.ok(rd0 < 120, `rd0 ${rd0}`);
  assert.ok(rd30 > rd0 && rd365 > rd30, `${rd0} ${rd30} ${rd365}`);
  assert.ok(rdFar <= 350 + 1e-9);
  // Música sem nenhum duelo também é inflada e limitada ao teto.
  const s = makeSong(9, 0);
  const fresh = replay([s], []).stats;
  assert.equal(fresh.size, 0);
  assert.ok(songId(s.artist, s.title) === s.id);
});
