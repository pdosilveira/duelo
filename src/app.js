// Interface. Toda a lógica de ranking vive em engine.js / matchmaker.js.

import { replay, applyVote, compareVotes, ranking, mergeData, getStat, currentRd, CONFIG } from './engine.js';
import { pickDuel } from './matchmaker.js';
import { createPlayer } from './player.js';
import { search, rateLimited } from './catalog.js';

const STORAGE_KEY = 'duelo:v1';
const $ = (sel) => document.querySelector(sel);

// ---------- dados ----------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        songs: Array.isArray(d.songs) ? d.songs : [],
        votes: Array.isArray(d.votes) ? d.votes : [],
        pending: d.pending || null,
      };
    }
  } catch (e) {
    console.warn('Falha ao ler dados', e);
  }
  return { songs: [], votes: [], pending: null };
}

let data = load();
let state = replay(data.songs, data.votes);
const voteIds = new Set(data.votes.map((v) => v.id));

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    toast('Não foi possível salvar. Exporte um backup.');
  }
}

function rebuild() {
  state = replay(data.songs, data.votes);
}

try {
  navigator.storage?.persist?.();
} catch {}

const activeSongs = () => data.songs.filter((s) => !s.archived);
const songById = (id) => state.songs.get(id);

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ---------- utilidades de UI ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>',
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function cover(src, cls) {
  // div com background: falha de imagem não mostra ícone quebrado
  return el('div', { class: cls, 'aria-hidden': 'true', style: src ? `background-image:url("${encodeURI(src)}")` : null });
}

// ---------- player ----------

const player = createPlayer();
const trackOf = (song) => ({ id: song.id, url: song.preview });

function playButton(song, small = false) {
  const btn = el('button', {
    class: 'play' + (small ? ' small' : ''),
    type: 'button',
    'data-play': song.id,
    'aria-label': 'Ouvir prévia de ' + song.title,
    disabled: !song.preview,
  });
  btn.innerHTML = song.preview ? ICONS.play : ICONS.off;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    player.toggle(trackOf(song));
  });
  btn.addEventListener('keydown', (e) => e.stopPropagation());
  paintPlay(btn);
  return btn;
}

function paintPlay(btn) {
  const { id, status } = player.state;
  const mine = btn.dataset.play === id;
  if (btn.disabled) return;
  btn.classList.toggle('loading', mine && status === 'loading');
  btn.classList.toggle('error', mine && status === 'error');
  const active = mine && (status === 'playing' || status === 'loading');
  btn.innerHTML = mine && status === 'error' ? ICONS.off : active ? ICONS.pause : ICONS.play;
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
}

player.onChange(({ status }) => {
  document.querySelectorAll('[data-play]').forEach(paintPlay);
  if (status === 'error') toast('Prévia indisponível para esta faixa.');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) player.pause();
});
window.addEventListener('pagehide', () => player.pause());

// ---------- abas ----------

let currentTab = 'duel';
function showTab(tab) {
  currentTab = tab;
  player.pause();
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
  if (tab === 'duel') renderDuel();
  if (tab === 'rank') renderRanking();
  if (tab === 'songs') renderCatalog();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- duelo ----------

let locked = false;

function validPending(p) {
  if (!p || voteIds.has(p.id)) return false;
  const a = songById(p.a);
  const b = songById(p.b);
  return a && b && !a.archived && !b.archived && p.a !== p.b;
}

function ensurePending() {
  if (validPending(data.pending)) return data.pending;
  const d = pickDuel(state, Date.now());
  data.pending = d ? { id: newId(), a: d.a, b: d.b } : null;
  save();
  return data.pending;
}

function duelCard(song, side) {
  const st = getStat(state, song.id);
  const card = el(
    'div',
    {
      class: 'card',
      role: 'button',
      tabindex: '0',
      'data-side': side,
      'aria-label': `Prefiro ${song.title}, de ${song.artist}`,
    },
    el('div', { class: 'bg', style: song.art ? `background-image:url("${encodeURI(song.art)}")` : null }),
    cover(song.art, 'cover'),
    el(
      'div',
      { class: 'info' },
      el('div', { class: 'title', text: song.title }),
      el('div', { class: 'artist', text: song.artist }),
      el(
        'div',
        { class: 'meta' },
        st.games === 0
          ? el('span', { class: 'badge new', text: 'Estreando' })
          : el('span', { class: 'badge', text: st.games === 1 ? '1 duelo' : `${st.games} duelos` }),
        playButton(song)
      )
    )
  );
  card.addEventListener('click', () => vote(side));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      vote(side);
    }
  });
  return card;
}

function renderDuel() {
  const body = $('#duel-body');
  const count = $('#duel-count');
  count.textContent = state.history.count ? `${state.history.count} ${state.history.count === 1 ? 'duelo' : 'duelos'}` : '';
  body.className = 'arena';
  body.replaceChildren();

  if (activeSongs().length < 2) {
    const n = activeSongs().length;
    body.append(
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'Adicione pelo menos duas músicas' }),
        el('p', { text: n === 1 ? 'Falta só mais uma para o primeiro duelo.' : 'Busque as músicas que você quer comparar.' }),
        el('button', { class: 'btn', type: 'button', text: 'Buscar músicas', onclick: () => { showTab('songs'); $('#search-input').focus(); } })
      )
    );
    return;
  }

  const p = ensurePending();
  const a = songById(p.a);
  const b = songById(p.b);
  body.append(
    duelCard(a, 'A'),
    el('div', { class: 'tie-row' }, el('button', { class: 'tie', type: 'button', text: 'Empate', onclick: () => vote('D') })),
    duelCard(b, 'B')
  );
  body.classList.add('entering');
  locked = false;
}

function vote(r) {
  if (locked) return;
  const p = data.pending;
  if (!validPending(p)) return renderDuel();
  locked = true;
  player.pause();

  const v = { id: p.id, a: p.a, b: p.b, r, t: Date.now() };
  if (!voteIds.has(v.id)) {
    voteIds.add(v.id);
    data.votes.push(v);
    if (!state.lastVote || compareVotes(state.lastVote, v) < 0) applyVote(state, v);
    else rebuild();
  }
  data.pending = null;
  save();

  const body = $('#duel-body');
  body.classList.remove('entering');
  const cards = body.querySelectorAll('.card');
  cards.forEach((c) => {
    if (r === 'D') c.classList.add('tied');
    else c.classList.add(c.dataset.side === r ? 'chosen' : 'dimmed');
  });
  if (r === 'D') body.querySelector('.tie')?.classList.add('chosen');

  setTimeout(() => body.classList.add('leaving'), 300);
  setTimeout(() => {
    if (currentTab === 'duel') renderDuel();
    else locked = false;
  }, 480);
}

document.addEventListener('keydown', (e) => {
  if (currentTab !== 'duel' || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const map = { ArrowLeft: 'A', ArrowRight: 'B', ArrowDown: 'D' };
  if (map[e.key] && data.pending) {
    e.preventDefault();
    vote(map[e.key]);
  }
});

// ---------- ranking ----------

function renderRanking() {
  const body = $('#rank-body');
  body.replaceChildren();
  const now = Date.now();
  const rows = ranking(state, now);
  $('#rank-count').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'música' : 'músicas'}` : '';

  if (state.history.count === 0) {
    const enough = rows.length >= 2;
    body.append(
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'Nenhum duelo ainda' }),
        el('p', { text: enough ? 'O ranking aparece a partir do primeiro voto.' : 'Adicione pelo menos duas músicas para começar.' }),
        el('button', {
          class: 'btn',
          type: 'button',
          text: enough ? 'Ir para o duelo' : 'Buscar músicas',
          onclick: () => showTab(enough ? 'duel' : 'songs'),
        })
      )
    );
    return;
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) {
    lo = Math.min(lo, r.low);
    hi = Math.max(hi, r.high);
  }
  const span = Math.max(1, hi - lo);
  const pct = (x) => ((x - lo) / span) * 100;

  body.append(el('p', { class: 'legend', text: `Ordenado pela pontuação conservadora (nota − ${CONFIG.K}×incerteza). A barra mostra a faixa provável da nota.` }));
  const list = el('ol', { class: 'rank-list' });
  rows.forEach((r, i) => {
    const s = r.stat;
    const firm = r.rd < 80;
    const uncertain = r.rd >= 150;
    list.append(
      el(
        'li',
        { class: 'rank-row' },
        el('div', { class: 'rank-pos' + (uncertain ? ' uncertain' : ''), text: (uncertain ? '~' : '') + (i + 1), title: uncertain ? 'Posição incerta' : null }),
        cover(r.song.art, 'thumb'),
        el(
          'div',
          { class: 'rank-main' },
          el('div', { class: 'line1', text: r.song.title }),
          el('div', { class: 'line2', text: r.song.artist }),
          el(
            'div',
            { class: 'interval', role: 'img', 'aria-label': `Nota ${Math.round(s.rating)}, faixa de ${Math.round(r.low)} a ${Math.round(r.high)}` },
            el('div', { class: 'range', style: `left:${pct(r.low)}%;width:${Math.max(1, pct(r.high) - pct(r.low))}%` }),
            el('div', { class: 'mark', style: `left:${pct(s.rating)}%` })
          ),
          el(
            'div',
            { class: 'rank-foot' },
            el('span', { class: 'conf' + (firm ? ' firm' : ''), text: r.confidence }),
            el('span', { text: `${s.games} ${s.games === 1 ? 'duelo' : 'duelos'} (${s.w}V ${s.d}E ${s.l}D)` })
          )
        )
      )
    );
  });
  body.append(list);
}

// ---------- músicas ----------

let lastResults = [];

function addSong(song) {
  const existing = data.songs.find((s) => s.id === song.id);
  if (existing) {
    if (!existing.archived) return toast('Essa música já está no catálogo.');
    existing.archived = false;
    if (!existing.preview && song.preview) existing.preview = song.preview;
    if (!existing.art && song.art) existing.art = song.art;
    toast('Música reativada.');
  } else {
    data.songs.push({ ...song, addedAt: Date.now(), archived: false });
    toast('Adicionada ao catálogo.');
  }
  save();
  rebuild();
  renderResults();
  renderCatalog();
}

function archiveSong(id) {
  const s = data.songs.find((x) => x.id === id);
  if (!s) return;
  s.archived = true;
  if (data.pending && (data.pending.a === id || data.pending.b === id)) data.pending = null;
  if (player.state.id === id) player.pause();
  save();
  rebuild();
  renderCatalog();
  renderResults();
  toast('Arquivada. Adicione de novo para reativar.');
}

function renderResults() {
  const ul = $('#results');
  ul.replaceChildren();
  for (const song of lastResults) {
    const existing = data.songs.find((s) => s.id === song.id);
    const inCatalog = existing && !existing.archived;
    ul.append(
      el(
        'li',
        { class: 'song-row' },
        cover(song.art, 'thumb'),
        el(
          'div',
          { class: 'rank-main' },
          el('div', { class: 'line1', text: song.title }),
          el('div', { class: 'line2', text: [song.artist, song.album].filter(Boolean).join(' · ') })
        ),
        el(
          'div',
          { class: 'actions' },
          playButton(song, true),
          inCatalog
            ? el('span', { class: 'in-cat', text: 'No catálogo' })
            : el('button', { class: 'btn small', type: 'button', text: 'Adicionar', onclick: () => addSong(song) })
        )
      )
    );
  }
}

function renderCatalog() {
  const ul = $('#catalog');
  ul.replaceChildren();
  const songs = activeSongs().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  $('#cat-h').textContent = songs.length ? `Seu catálogo (${songs.length})` : 'Seu catálogo';
  if (!songs.length) {
    ul.append(el('li', { class: 'note', text: 'Nenhuma música ainda. Use a busca acima para adicionar.' }));
    return;
  }
  const now = Date.now();
  for (const song of songs) {
    const st = getStat(state, song.id);
    const info = st.games ? `${st.games} ${st.games === 1 ? 'duelo' : 'duelos'} · RD ${Math.round(currentRd(st, now))}` : 'Estreando';
    ul.append(
      el(
        'li',
        { class: 'song-row' },
        cover(song.art, 'thumb'),
        el(
          'div',
          { class: 'rank-main' },
          el('div', { class: 'line1', text: song.title }),
          el('div', { class: 'line2', text: `${song.artist} · ${info}` })
        ),
        el(
          'div',
          { class: 'actions' },
          playButton(song, true),
          el('button', { class: 'btn ghost small', type: 'button', text: 'Arquivar', onclick: () => archiveSong(song.id) })
        )
      )
    );
  }
}

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#search-input');
  const term = input.value.trim();
  const status = $('#search-status');
  if (!term) return;
  if (rateLimited()) {
    status.textContent = 'Muitas buscas seguidas. Espere um minuto e tente de novo.';
    return;
  }
  input.blur();
  status.textContent = 'Buscando…';
  try {
    lastResults = await search(term);
    status.textContent = lastResults.length ? '' : 'Nada encontrado. Tente outro termo.';
  } catch (err) {
    lastResults = [];
    status.textContent =
      err.message === 'rate' ? 'Muitas buscas seguidas. Espere um minuto e tente de novo.' : 'Não foi possível buscar agora. Verifique a conexão.';
  }
  renderResults();
});

// ---------- backup ----------

$('#export-btn').addEventListener('click', () => {
  const payload = { app: 'duelo', version: 1, exportedAt: new Date().toISOString(), songs: data.songs, votes: data.votes };
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `duelo-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!Array.isArray(incoming.songs) || !Array.isArray(incoming.votes)) throw new Error('formato');
    const beforeSongs = data.songs.length;
    const beforeVotes = data.votes.length;
    const merged = mergeData(data, incoming);
    data.songs = merged.songs;
    data.votes = merged.votes;
    voteIds.clear();
    data.votes.forEach((v) => voteIds.add(v.id));
    save();
    rebuild();
    renderCatalog();
    toast(`Backup importado: ${data.songs.length - beforeSongs} músicas e ${data.votes.length - beforeVotes} votos novos.`);
  } catch {
    toast('Arquivo de backup inválido.');
  }
});

// ---------- início ----------

showTab(activeSongs().length >= 2 ? 'duel' : 'songs');
