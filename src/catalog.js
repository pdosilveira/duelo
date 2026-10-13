// Busca no iTunes Search API (JSONP, sem chave) e conversão em música do catálogo.

import { songId } from './engine.js';

const ENDPOINT = 'https://itunes.apple.com/search?media=music&entity=song&country=BR&limit=8&term=';
const RATE_LIMIT = 20; // chamadas por minuto
const calls = [];
let seq = 0;

export function rateLimited(now = Date.now()) {
  while (calls.length && now - calls[0] > 60000) calls.shift();
  return calls.length >= RATE_LIMIT;
}

function jsonp(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const name = '__duelo_cb' + ++seq;
    const script = document.createElement('script');
    let done = false;
    const finish = () => {
      done = true;
      clearTimeout(timer);
      script.remove();
      // mantém um no-op para respostas atrasadas
      window[name] = () => delete window[name];
    };
    window[name] = (data) => {
      if (done) return;
      finish();
      delete window[name];
      resolve(data);
    };
    script.onerror = () => {
      if (done) return;
      finish();
      reject(new Error('network'));
    };
    const timer = setTimeout(() => {
      if (done) return;
      finish();
      reject(new Error('timeout'));
    }, timeout);
    script.src = url + '&callback=' + name;
    document.head.appendChild(script);
  });
}

export function fromItunes(r, now = Date.now()) {
  const art = r.artworkUrl100 ? r.artworkUrl100.replace(/100x100bb/, '300x300bb') : '';
  return {
    id: songId(r.artistName, r.trackName),
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName || '',
    art,
    preview: r.previewUrl || '',
    link: r.trackViewUrl || '',
    itunesId: r.trackId,
    addedAt: now,
    archived: false,
  };
}

export async function search(term) {
  const q = term.trim();
  if (!q) return [];
  if (rateLimited()) throw new Error('rate');
  calls.push(Date.now());
  const data = await jsonp(ENDPOINT + encodeURIComponent(q));
  const seen = new Set();
  const out = [];
  for (const r of data?.results || []) {
    if (!r.trackName || !r.artistName) continue;
    const song = fromItunes(r);
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    out.push(song);
  }
  return out;
}
