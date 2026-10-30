// Torneio suíço: 16 músicas, 4 rodadas, ninguém é eliminado.
// Quem tem a mesma pontuação se enfrenta; sem revanche. Sem dependência do DOM.

export const SWISS_SIZE = 16;
export const SWISS_ROUNDS = 4;

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const met = (sw, x, y) => sw.rounds.some((round) => round.some((m) => (m.a === x && m.b === y) || (m.a === y && m.b === x)));

export function table(sw) {
  const rows = new Map(sw.players.map((id) => [id, { id, pts: 0, w: 0, d: 0, l: 0, opp: [] }]));
  for (const round of sw.rounds) {
    for (const m of round) {
      if (!m.r) continue;
      const A = rows.get(m.a);
      const B = rows.get(m.b);
      A.opp.push(m.b);
      B.opp.push(m.a);
      if (m.r === 'A') (A.pts += 1), A.w++, B.l++;
      else if (m.r === 'B') (B.pts += 1), B.w++, A.l++;
      else (A.pts += 0.5), (B.pts += 0.5), A.d++, B.d++;
    }
  }
  for (const r of rows.values()) r.buch = r.opp.reduce((s, o) => s + rows.get(o).pts, 0); // força dos adversários
  return [...rows.values()].sort((x, y) => y.pts - x.pts || y.buch - x.buch || y.w - x.w || sw.players.indexOf(x.id) - sw.players.indexOf(y.id));
}

// Emparelha em ordem de classificação, sem revanche (com retrocesso).
function pairRound(sw, newId, rng) {
  const order = table(sw).map((r) => r.id);
  const pairs = [];
  const used = new Set();
  const solve = () => {
    const first = order.find((id) => !used.has(id));
    if (first == null) return true;
    used.add(first);
    for (const opp of order) {
      if (used.has(opp) || met(sw, first, opp)) continue;
      used.add(opp);
      pairs.push([first, opp]);
      if (solve()) return true;
      pairs.pop();
      used.delete(opp);
    }
    used.delete(first);
    return false;
  };
  if (!solve()) return false;
  sw.rounds.push(pairs.map(([x, y]) => (rng() < 0.5 ? { a: x, b: y, r: null, vid: newId() } : { a: y, b: x, r: null, vid: newId() })));
  return true;
}

export function createSwiss(ids, newId, rng = Math.random, now = Date.now()) {
  if (ids.length < SWISS_SIZE) return null;
  const players = shuffle(ids, rng).slice(0, SWISS_SIZE);
  const sw = { id: newId(), createdAt: now, players, rounds: [] };
  pairRound(sw, newId, rng); // 1ª rodada: ordem sorteada
  return sw;
}

export function currentSwissMatch(sw) {
  if (!sw) return null;
  const r = sw.rounds.length - 1;
  const i = sw.rounds[r].findIndex((m) => !m.r);
  return i < 0 ? null : { round: r, index: i, match: sw.rounds[r][i] };
}

export const swissDone = (sw) => Boolean(sw) && sw.rounds.length === SWISS_ROUNDS && !currentSwissMatch(sw);

// r: 'A' | 'B' | 'D' para o jogo atual. Fecha a rodada e emparelha a próxima.
export function recordSwiss(sw, r, newId, rng = Math.random) {
  const cur = currentSwissMatch(sw);
  if (!cur || !['A', 'B', 'D'].includes(r)) return false;
  cur.match.r = r;
  if (!currentSwissMatch(sw) && sw.rounds.length < SWISS_ROUNDS) pairRound(sw, newId, rng);
  return true;
}
