// Ranking de artistas a partir da pontuação (duelos) das músicas. Sem dependência do DOM.

import { normalizeText, currentRd, getStat, CONFIG } from './engine.js';

export const TOP_N = 5; // considera as 5 melhores músicas de cada artista
const PRIOR_SONGS = 2; // "músicas fantasmas" na média: puxa para o meio quem tem poucas
const PRIOR_RD = 200; // incerteza dessas músicas fantasmas

const key = (s) => normalizeText(s).replace(/ e /g, ' ').replace(/\s+/g, ' ').trim();

// Créditos de cada música. Classifica cada nome de artista do catálogo, do mais curto ao mais longo:
// - sem "&" nem vírgula ("Daniel Caesar", "Lucca e Mateus") → artista;
// - com vírgula, ou formado só por artistas já conhecidos ("Marília Mendonça & Maiara & Maraisa") → parceria;
// - contém artista conhecido + nome desconhecido: parceria, salvo se tiver 6+ músicas ("Leandro & Leonardo");
// - não contém nenhum conhecido ("Bruno & Barretto") → artista.
// Parcerias contam para cada artista contido (o nome mais longo vence quando se sobrepõem).
export function creditArtists(songs) {
  const names = new Map(); // chave → nome exibido (grafia mais frequente)
  const count = new Map();
  const spell = new Map();
  for (const s of songs) {
    const k = key(s.artist);
    if (!k) continue;
    count.set(k, (count.get(k) || 0) + 1);
    spell.set(s.artist, (spell.get(s.artist) || 0) + 1);
    const cur = names.get(k);
    if (!cur || spell.get(s.artist) > spell.get(cur)) names.set(k, s.artist);
  }
  const findIn = (k, pool) => {
    const taken = [];
    for (const b of pool) {
      if (b === k) continue;
      const i = (' ' + k + ' ').indexOf(' ' + b + ' ');
      if (i < 0) continue;
      const sp = [i, i + b.length];
      if (!taken.some((t) => sp[0] < t.sp[1] && t.sp[0] < sp[1])) taken.push({ b, sp });
    }
    return taken;
  };
  const real = []; // mantido do mais longo ao mais curto para a busca
  for (const k of [...names.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) {
    const shown = names.get(k);
    if (!/[&,]/.test(shown)) {
      real.push(k);
      continue;
    }
    if (shown.includes(',')) continue;
    const inside = findIn(k, real);
    if (!inside.length) {
      real.push(k);
      continue;
    }
    let rest = ' ' + k + ' ';
    for (const t of inside) rest = rest.replace(' ' + t.b + ' ', ' ');
    if (rest.trim() && count.get(k) >= 6) real.push(k);
  }
  real.sort((a, b) => b.length - a.length);
  const realSet = new Set(real);
  const credits = new Map();
  for (const s of songs) {
    const k = key(s.artist);
    const out = realSet.has(k) ? [k] : findIn(k, real).map((t) => t.b);
    credits.set(s.id, (out.length ? out : [k]).map((b) => names.get(b)));
  }
  return credits;
}

export function confidenceArtist(u) {
  if (u < 50) return 'Posição firme';
  if (u < 80) return 'Ainda ajustando';
  return 'Pouco testado';
}

// rows: músicas ativas. Retorna artistas ordenados pela pontuação conservadora.
export function rankArtists(state, songs, now, K = CONFIG.K) {
  const credits = creditArtists(songs);
  const byArtist = new Map();
  for (const s of songs) {
    const st = getStat(state, s.id);
    const item = { song: s, rating: st.rating, rd: currentRd(st, now), games: st.games };
    for (const a of credits.get(s.id) || []) {
      if (!byArtist.has(a)) byArtist.set(a, []);
      byArtist.get(a).push(item);
    }
  }
  const all = songs.map((s) => getStat(state, s.id).rating);
  const mean = all.length ? all.reduce((x, y) => x + y, 0) / all.length : 1500;
  const out = [];
  for (const [name, items] of byArtist) {
    items.sort((x, y) => y.rating - x.rating);
    const top = items.slice(0, TOP_N);
    const n = top.length + PRIOR_SONGS;
    const mu = (top.reduce((s, x) => s + x.rating, 0) + PRIOR_SONGS * mean) / n;
    const u = Math.sqrt(top.reduce((s, x) => s + x.rd * x.rd, 0) + PRIOR_SONGS * PRIOR_RD * PRIOR_RD) / n;
    out.push({ name, songs: items, best: items[0].song, score: mu - K * u, rating: mu, u, low: mu - K * u, high: mu + K * u, games: items.reduce((s, x) => s + x.games, 0), confidence: confidenceArtist(u) });
  }
  out.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  return out;
}
