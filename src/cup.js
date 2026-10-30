// Mata-mata: chaveamento de 16 músicas, das oitavas à final. Sem dependência do DOM.

export const CUP_SIZE = 16;

export function roundName(matches) {
  return { 8: 'Oitavas de final', 4: 'Quartas de final', 2: 'Semifinal', 1: 'Final' }[matches] || `Rodada de ${matches * 2}`;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeRound(ids, newId, rng) {
  const round = [];
  for (let i = 0; i < ids.length; i += 2) {
    const [a, b] = rng() < 0.5 ? [ids[i], ids[i + 1]] : [ids[i + 1], ids[i]];
    round.push({ a, b, w: null, vid: newId() });
  }
  return round;
}

// ids: músicas elegíveis. Retorna null se não houver 16.
// opts.select(ids, k) escolhe os participantes e opts.pair(ids) monta as oitavas
// (no app: a mesma metodologia dos duelos). Depois, a chave é fixa.
export function createCup(ids, newId, rng = Math.random, now = Date.now(), opts = {}) {
  if (ids.length < CUP_SIZE) return null;
  const picked = opts.select ? opts.select(ids, CUP_SIZE) : shuffle(ids, rng).slice(0, CUP_SIZE);
  const pairs = opts.pair ? opts.pair(picked) : null;
  const seeded = pairs ? pairs.flat() : picked;
  return { id: newId(), createdAt: now, rounds: [makeRound(seeded, newId, rng)] };
}

export function currentMatch(cup) {
  if (!cup) return null;
  const r = cup.rounds.length - 1;
  const i = cup.rounds[r].findIndex((m) => !m.w);
  return i < 0 ? null : { round: r, index: i, match: cup.rounds[r][i] };
}

export function champion(cup) {
  const last = cup?.rounds[cup.rounds.length - 1];
  return last && last.length === 1 && last[0].w ? last[0].w : null;
}

// Registra o vencedor do jogo atual; quando a rodada fecha, cria a próxima.
export function recordWinner(cup, winner, newId, rng = Math.random) {
  const cur = currentMatch(cup);
  if (!cur || (winner !== cur.match.a && winner !== cur.match.b)) return false;
  cur.match.w = winner;
  const round = cup.rounds[cur.round];
  if (round.every((m) => m.w) && round.length > 1) {
    cup.rounds.push(makeRound(round.map((m) => m.w), newId, rng));
  }
  return true;
}

// A música ainda disputa o mata-mata? (está na rodada atual e não foi eliminada)
export function cupAlive(cup, id) {
  if (!cup || champion(cup)) return false;
  const last = cup.rounds[cup.rounds.length - 1];
  return last.some((m) => (m.w ? m.w === id : m.a === id || m.b === id));
}

// Substituta assume a vaga em todo o chaveamento; jogos ainda não disputados ganham id de voto novo.
export function replaceInCup(cup, oldId, newIdSong, newId) {
  for (const round of cup.rounds) {
    for (const m of round) {
      const hit = m.a === oldId || m.b === oldId;
      if (m.a === oldId) m.a = newIdSong;
      if (m.b === oldId) m.b = newIdSong;
      if (m.w === oldId) m.w = newIdSong;
      if (hit && !m.w) m.vid = newId();
    }
  }
}

export const cupPlayed = (cup) => cup.rounds.reduce((n, r) => n + r.filter((m) => m.w).length, 0);
