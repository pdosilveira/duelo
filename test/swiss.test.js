import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwiss, currentSwissMatch, recordSwiss, swissDone, table, SWISS_ROUNDS } from '../src/swiss.js';
import { mulberry32 } from './helpers.js';

test('suíço: 4 rodadas, 32 jogos, sem revanche, pareamento por pontos', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const rng = mulberry32(seed);
    let n = 0;
    const newId = () => 'id' + n++;
    const ids = Array.from({ length: 30 }, (_, i) => 's' + i);
    assert.equal(createSwiss(ids.slice(0, 15), newId, rng), null);
    const sw = createSwiss(ids, newId, rng);
    let games = 0;
    let roundSeen = -1;
    for (let cur = currentSwissMatch(sw); cur; cur = currentSwissMatch(sw)) {
      if (cur.round !== roundSeen) {
        roundSeen = cur.round;
        // na 2ª rodada (sem empates na 1ª), vencedores enfrentam vencedores
        if (cur.round === 1 && sw.rounds[0].every((m) => m.r !== 'D')) {
          const pts = new Map(table({ ...sw, rounds: sw.rounds.slice(0, 1) }).map((r) => [r.id, r.pts]));
          for (const m of sw.rounds[1]) assert.equal(pts.get(m.a), pts.get(m.b));
        }
      }
      const x = rng();
      assert.ok(recordSwiss(sw, x < 0.15 ? 'D' : x < 0.6 ? 'A' : 'B', newId, rng));
      games++;
    }
    assert.ok(swissDone(sw));
    assert.equal(games, 32);
    assert.equal(sw.rounds.length, SWISS_ROUNDS);
    const pairs = new Set();
    for (const round of sw.rounds) {
      const inRound = round.flatMap((m) => [m.a, m.b]);
      assert.equal(new Set(inRound).size, 16, 'cada música joga 1 vez por rodada');
      for (const m of round) {
        const k = [m.a, m.b].sort().join('|');
        assert.ok(!pairs.has(k), 'sem revanche');
        pairs.add(k);
      }
    }
    const t = table(sw);
    assert.ok(t.every((r) => r.w + r.d + r.l === 4));
    assert.equal(t.reduce((s, r) => s + r.pts, 0), 32);
    for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].pts >= t[i].pts);
  }
});
