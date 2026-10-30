import test from 'node:test';
import assert from 'node:assert/strict';
import { createCup, currentMatch, recordWinner, cupAlive, replaceInCup, champion } from '../src/cup.js';
import { createSwiss, currentSwissMatch, recordSwiss, swissAlive, replaceInSwiss, swissDone, table } from '../src/swiss.js';
import { mulberry32 } from './helpers.js';

const ids = Array.from({ length: 30 }, (_, i) => 's' + i);

test('mata-mata: substituta assume a vaga e o torneio segue até a campeã', () => {
  const rng = mulberry32(4);
  let n = 0;
  const newId = () => 'v' + n++;
  const cup = createCup(ids, newId, rng);
  recordWinner(cup, currentMatch(cup).match.a, newId, rng); // jogo 1
  const cur = currentMatch(cup).match;
  const out = cur.b;
  const oldVid = cur.vid;
  const sub = ids.find((x) => !cup.rounds[0].some((m) => m.a === x || m.b === x));
  assert.ok(cupAlive(cup, out));
  replaceInCup(cup, out, sub, newId);
  assert.equal(currentMatch(cup).match.b, sub);
  assert.notEqual(currentMatch(cup).match.vid, oldVid);
  assert.ok(!cupAlive(cup, out));
  for (let c = currentMatch(cup); c; c = currentMatch(cup)) recordWinner(cup, c.match.b, newId, rng);
  assert.ok(champion(cup));
});

test('suíço: substituta herda pontos e campanha; tabela segue válida', () => {
  const rng = mulberry32(5);
  let n = 0;
  const newId = () => 'v' + n++;
  const sw = createSwiss(ids, newId, rng);
  for (let i = 0; i < 10; i++) recordSwiss(sw, 'A', newId, rng);
  const cur = currentSwissMatch(sw).match;
  const out = cur.a;
  const before = table(sw).find((r) => r.id === out);
  const sub = ids.find((x) => !sw.players.includes(x));
  replaceInSwiss(sw, out, sub, newId);
  const after = table(sw).find((r) => r.id === sub);
  assert.equal(after.pts, before.pts);
  assert.equal(after.w + after.d + after.l, before.w + before.d + before.l);
  assert.ok(!swissAlive(sw, out) && swissAlive(sw, sub));
  for (let c = currentSwissMatch(sw); c; c = currentSwissMatch(sw)) recordSwiss(sw, 'B', newId, rng);
  assert.ok(swissDone(sw));
  assert.equal(table(sw).length, 16);
});
