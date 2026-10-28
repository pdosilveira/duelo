import test from 'node:test';
import assert from 'node:assert/strict';
import { createCup, currentMatch, recordWinner, champion, roundName } from '../src/cup.js';
import { mulberry32 } from './helpers.js';

test('mata-mata: 16 músicas distintas, 15 jogos até a campeã', () => {
  const rng = mulberry32(9);
  let n = 0;
  const newId = () => 'id' + n++;
  const ids = Array.from({ length: 40 }, (_, i) => 's' + i);
  assert.equal(createCup(ids.slice(0, 15), newId, rng), null);
  const cup = createCup(ids, newId, rng);
  const first = cup.rounds[0].flatMap((m) => [m.a, m.b]);
  assert.equal(new Set(first).size, 16);
  assert.equal(roundName(cup.rounds[0].length), 'Oitavas de final');
  let games = 0;
  const vids = new Set();
  for (let cur = currentMatch(cup); cur; cur = currentMatch(cup)) {
    vids.add(cur.match.vid);
    assert.equal(recordWinner(cup, 'intruso', newId, rng), false);
    assert.ok(recordWinner(cup, rng() < 0.5 ? cur.match.a : cur.match.b, newId, rng));
    games++;
  }
  assert.equal(games, 15);
  assert.equal(vids.size, 15);
  assert.deepEqual(cup.rounds.map((r) => r.length), [8, 4, 2, 1]);
  assert.ok(first.includes(champion(cup)));
  // vencedores avançam: cada música da rodada seguinte venceu na anterior
  for (let r = 1; r < cup.rounds.length; r++) {
    const winners = new Set(cup.rounds[r - 1].map((m) => m.w));
    for (const m of cup.rounds[r]) assert.ok(winners.has(m.a) && winners.has(m.b));
  }
});
