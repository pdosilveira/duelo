// Gera data/seed-sertanejo.json a partir da iTunes Search API (roda no GitHub Actions).
// Uso: node tools/build-seed.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { songId, normalizeText } from '../src/engine.js';

const ARTISTS = [
  'Gusttavo Lima', 'Henrique & Juliano', 'Jorge & Mateus', 'Marília Mendonça', 'Zé Neto & Cristiano',
  'Maiara & Maraisa', 'Luan Santana', 'Simone Mendes', 'Simone & Simaria', 'Ana Castela',
  'Matheus & Kauan', 'Bruno & Marrone', 'Chitãozinho & Xororó', 'Zezé Di Camargo & Luciano', 'Leonardo',
  'Leandro & Leonardo', 'Israel & Rodolffo', 'Hugo & Guilherme', 'Murilo Huff', 'Lauana Prado',
  'Gustavo Mioto', 'Marcos & Belutti', 'Michel Teló', 'Cristiano Araújo', 'João Neto & Frederico',
  'Fernando & Sorocaba', 'Victor & Leo', 'César Menotti & Fabiano', 'Paula Fernandes', 'Lucas Lucco',
  'Felipe Araújo', 'Diego & Victor Hugo', 'Luiza & Maurílio', 'Guilherme & Benuto', 'Clayton & Romário',
  'Day e Lara', 'Naiara Azevedo', 'Eduardo Costa', 'Daniel', 'Rionegro & Solimões',
  'Gian & Giovani', 'Milionário & José Rico', 'Tião Carreiro & Pardinho', 'Teodoro & Sampaio', 'João Paulo & Daniel',
  'Edson & Hudson', 'Jads & Jadson', 'Humberto & Ronaldo', 'Munhoz & Mariano', 'Thaeme & Thiago',
  'Zé Felipe', 'Luan Pereira', 'US Agroboy', 'Léo & Raphael', 'Hugo Henrique',
  'Henrique & Diego', 'Bruninho & Davi', 'Loubet', 'Matogrosso & Mathias', 'Jefferson Moraes',
  'George Henrique & Rodrigo', 'Pedro Paulo & Alex', 'Kleo Dibah & Rafael', 'Yasmin Santos', 'Maria Cecília & Rodolfo',
  'Rick & Renner', 'Gino & Geno', 'Chrystian & Ralf', 'Zé Ricardo & Thiago', 'Mariana Fagundes',
];
const PER_ARTIST = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function diagnose() {
  const base = 'https://itunes.apple.com/search?media=music&entity=song&country=BR&limit=1&term=gusttavo%20lima';
  for (const [label, url, headers] of [
    ['jsonp', base + '&callback=cb', { Referer: 'https://pdosilveira.github.io/duelo/' }],
    ['cors', base, { Origin: 'https://pdosilveira.github.io' }],
  ]) {
    try {
      const res = await fetch(url, { headers });
      const body = await res.text();
      console.log(`[diag ${label}] status=${res.status} type=${res.headers.get('content-type')} acao=${res.headers.get('access-control-allow-origin')} nosniff=${res.headers.get('x-content-type-options')} body=${JSON.stringify(body.trim().slice(0, 60))}`);
    } catch (e) {
      console.log(`[diag ${label}] erro ${e.message}`);
    }
    await sleep(3500);
  }
}

async function main() {
  await diagnose();
  const songs = new Map();
  const versions = new Set();
  for (const artist of ARTISTS) {
    const url = 'https://itunes.apple.com/search?media=music&entity=song&attribute=artistTerm&country=BR&limit=200&term=' + encodeURIComponent(artist);
    let results = [];
    try {
      const res = await fetch(url);
      results = (await res.json()).results || [];
    } catch (e) {
      console.log(`falha em ${artist}: ${e.message}`);
    }
    const key = normalizeText(artist);
    let n = 0;
    const baseTitle = (t) => normalizeText(String(t).replace(/\s+-\s+.*$/, ''));
    for (const r of results) {
      if (n >= PER_ARTIST) break;
      if (!r.previewUrl || !r.trackName || !normalizeText(r.artistName).includes(key)) continue;
      const id = songId(r.artistName, r.trackName);
      const dupKey = key + '|' + baseTitle(r.trackName);
      if (songs.has(id) || versions.has(dupKey)) continue;
      versions.add(dupKey);
      songs.set(id, {
        id,
        title: r.trackName,
        artist: r.artistName,
        album: r.collectionName || '',
        art: (r.artworkUrl100 || '').replace(/100x100bb/, '300x300bb'),
        preview: r.previewUrl,
        link: r.trackViewUrl || '',
        itunesId: r.trackId,
      });
      n++;
    }
    console.log(`${artist}: ${n} músicas`);
    await sleep(3500);
  }
  if (songs.size < 20) throw new Error(`poucas músicas (${songs.size})`);
  await mkdir('data', { recursive: true });
  const out = { name: 'Sertanejo', generatedAt: new Date().toISOString(), songs: [...songs.values()] };
  await writeFile('data/seed-sertanejo.json', JSON.stringify(out));
  console.log(`total: ${songs.size} músicas`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
