// Interface. Toda a lógica de ranking vive em engine.js / matchmaker.js.

import { replay, applyVote, compareVotes, ranking, mergeData, getStat, currentRd, CONFIG } from './engine.js';
import { pickDuel, pickParticipants, pairByInformation } from './matchmaker.js';
import { TUNE_DUELS, NOTES, latestNotes, noteTarget, pickTuneOpponent, pickSongToRate } from './tune.js';
import { SWISS_SIZE, SWISS_ROUNDS, createSwiss, currentSwissMatch, recordSwiss, swissDone, table as swissTable } from './swiss.js';
import { CUP_SIZE, createCup, currentMatch, recordWinner, champion, roundName } from './cup.js';
import { createPlayer } from './player.js';
import { search, rateLimited, loadSeed } from './catalog.js';
import { syncEnabled, pushRows, pullRows, songToRow, rowToSong, voteToRow, rowToVote } from './sync.js';

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
        me: typeof d.me === 'string' ? d.me : null,
        cup: d.cup || null,
        swiss: d.swiss || null,
        tourMode: d.tourMode === 'swiss' ? 'swiss' : 'ko',
        notes: Array.isArray(d.notes) ? d.notes : [],
        mode: d.mode === 'note' ? 'note' : 'free',
        tune: d.tune || null,
        rateSong: d.rateSong || null,
        seq: d.seq || { votes: 0, songs: 0 },
      };
    }
  } catch (e) {
    console.warn('Falha ao ler dados', e);
  }
  return { songs: [], votes: [], pending: null, me: null, seq: { votes: 0, songs: 0 }, notes: [], mode: 'free', tune: null, rateSong: null };
}

let data = load();
// Votos sem autor são deste aparelho (anteriores à sincronização ou de backup antigo).
const isMine = (v) => !v.voter || (data.me != null && v.voter.toLowerCase() === data.me.toLowerCase());
let state; // só os meus votos: duelos e ranking pessoal
let stateAll; // votos de todo mundo: ranking geral
const voteIds = new Set(data.votes.map((v) => v.id));
rebuild();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    toast('Não foi possível salvar. Exporte um backup.');
  }
}

// Minhas notas (a mais recente de cada música). Só orientam os duelos de ajuste.
const myNotes = () => latestNotes(data.notes.filter(isMine));
const noteLabel = (n) => NOTES.find((x) => x[0] === n)?.[1] || '';

function rebuild() {
  state = replay(data.songs, data.votes.filter(isMine));
  stateAll = syncEnabled ? replay(data.songs, data.votes) : state;
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
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
  off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9H5z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>',
};

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(msg);
  if (action) {
    t.append(
      el('button', {
        type: 'button',
        text: action.label,
        onclick: () => {
          t.classList.remove('show');
          action.run();
        },
      })
    );
  }
  t.classList.toggle('has-action', Boolean(action));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
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
  if (tab === 'cup') renderCup();
  if (tab === 'rank') renderRanking();
  if (tab === 'songs') {
    renderCatalog();
    renderMe();
  }
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

function archiveButton(song) {
  const btn = el('button', { class: 'archive', type: 'button', 'aria-label': `Arquivar ${song.title}`, title: 'Arquivar (tirar dos duelos)' });
  btn.innerHTML = ICONS.archive;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!locked) archiveSong(song.id);
  });
  btn.addEventListener('keydown', (e) => e.stopPropagation());
  return btn;
}

function duelCard(song, side, { onVote = vote, archive = true } = {}) {
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
    archive ? archiveButton(song) : null,
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
  card.addEventListener('click', () => onVote(side));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onVote(side);
    }
  });
  return card;
}

function renderDuel() {
  locked = false; // a animação do voto anterior já terminou quando a tela é redesenhada
  const body = $('#duel-body');
  const count = $('#duel-count');
  count.textContent = state.history.count ? `${state.history.count} ${state.history.count === 1 ? 'duelo' : 'duelos'}` : '';
  body.className = 'arena';
  body.replaceChildren();
  $('#duel-mode').replaceChildren();

  if (syncEnabled && !data.me) {
    const input = el('input', { type: 'text', maxlength: '40', autocomplete: 'given-name', placeholder: 'Seu nome', 'aria-label': 'Seu nome' });
    const form = el(
      'form',
      { class: 'empty name-form' },
      el('h2', { text: 'Como você se chama?' }),
      el('p', { text: 'Seu nome separa seus votos no ranking geral. Use o mesmo nome se abrir em outro aparelho.' }),
      input,
      el('button', { class: 'btn', type: 'submit', text: 'Começar' })
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      setName(input.value);
    });
    body.append(form);
    return;
  }

  if (activeSongs().length < 2) {
    const n = activeSongs().length;
    body.append(
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'Adicione pelo menos duas músicas' }),
        el('p', { text: n === 1 ? 'Falta só mais uma para o primeiro duelo.' : 'Busque as músicas que você quer comparar.' }),
        seedPack ? seedButton() : null,
        el('button', { class: seedPack ? 'btn ghost' : 'btn', type: 'button', text: 'Buscar músicas', onclick: () => { showTab('songs'); $('#search-input').focus(); } })
      )
    );
    return;
  }

  renderModeSwitch();
  if (data.mode === 'note') return renderNoteMode(body);

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

// Grava um voto (idempotente pelo id) e atualiza os dois estados.
function recordVote(id, a, b, r) {
  if (voteIds.has(id)) return;
  const v = { id, a, b, r, t: Date.now() };
  if (syncEnabled) {
    v.voter = data.me;
    v._p = 1;
  }
  voteIds.add(v.id);
  data.votes.push(v);
  const inc = (st) => !st.lastVote || compareVotes(st.lastVote, v) < 0;
  if (inc(state) && (stateAll === state || inc(stateAll))) {
    applyVote(state, v);
    if (stateAll !== state) applyVote(stateAll, v);
  } else rebuild();
}

function vote(r) {
  if (locked) return;
  const p = data.pending;
  if (!validPending(p)) return renderDuel();
  locked = true;
  player.pause();

  recordVote(p.id, p.a, p.b, r);
  data.pending = null;
  save();
  scheduleSync();

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
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (currentTab === 'cup') {
    const tag = document.activeElement?.tagName;
    if (data.tourMode === 'swiss') {
      const r = { ArrowLeft: 'A', ArrowRight: 'B', ArrowDown: 'D' }[e.key];
      if (r && tag !== 'INPUT' && currentSwissMatch(data.swiss)) {
        e.preventDefault();
        swissVote(r);
      }
      return;
    }
    const side = { ArrowLeft: 'A', ArrowRight: 'B' }[e.key];
    if (side && tag !== 'INPUT' && currentMatch(data.cup)) {
      e.preventDefault();
      cupVote(side);
    }
    return;
  }
  if (currentTab !== 'duel') return;
  if (data.mode === 'note' && activeSongs().length >= 2) {
    const tag0 = document.activeElement?.tagName;
    if (tag0 === 'INPUT' || tag0 === 'TEXTAREA') return;
    if (tuneActive()) {
      const r = { ArrowLeft: 'A', ArrowRight: 'B', ArrowDown: 'D' }[e.key];
      if (r) {
        e.preventDefault();
        tuneVote(r);
      }
    } else if (/^[0-9]$/.test(e.key) && data.rateSong) {
      e.preventDefault();
      giveNote(e.key === '0' ? 10 : Number(e.key));
    }
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const map = { ArrowLeft: 'A', ArrowRight: 'B', ArrowDown: 'D' };
  if (map[e.key] && data.pending) {
    e.preventDefault();
    vote(map[e.key]);
  }
});

// ---------- modo nota ----------

function renderModeSwitch() {
  const box = $('#duel-mode');
  const seg = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Modo' });
  for (const [mode, label] of [['free', 'Duelo livre'], ['note', 'Nota']]) {
    seg.append(
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(data.mode === mode),
        text: label,
        onclick: () => {
          if (data.mode === mode) return;
          player.pause();
          data.mode = mode;
          save();
          renderDuel();
        },
      })
    );
  }
  box.replaceChildren(seg);
}

function tuneActive() {
  const t = data.tune;
  if (!t) return false;
  const s = songById(t.song);
  if (!s || s.archived || t.done >= TUNE_DUELS) {
    data.tune = null;
    save();
    return false;
  }
  return true;
}

function giveNote(n) {
  const id = data.rateSong;
  if (!id || locked) return;
  player.pause();
  const note = { id: newId(), song: id, n, t: Date.now() };
  if (syncEnabled) {
    note.voter = data.me;
    note._p = 1;
  }
  data.notes.push(note);
  data.tune = { song: id, note: n, done: 0, faced: [], pending: null };
  data.rateSong = null;
  save();
  scheduleSync();
  renderDuel();
}

const rateSkips = new Set();

function renderRateScreen(body) {
  const ids = activeSongs().map((x) => x.id);
  const notes = myNotes();
  if (!data.rateSong || notes.has(data.rateSong) || !ids.includes(data.rateSong)) {
    data.rateSong = pickSongToRate(state, ids, notes, rateSkips);
    if (!data.rateSong && rateSkips.size) {
      rateSkips.clear();
      data.rateSong = pickSongToRate(state, ids, notes, rateSkips);
    }
    save();
  }
  const song = songById(data.rateSong);
  if (!song) {
    body.append(
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'Todas as músicas já têm nota' }),
        el('p', { text: 'Adicione mais músicas ou volte para o duelo livre.' }),
        el('button', { class: 'btn', type: 'button', text: 'Duelo livre', onclick: () => { data.mode = 'free'; save(); renderDuel(); } })
      )
    );
    return;
  }
  const grid = el('div', { class: 'notes' });
  for (const [n, label] of NOTES) {
    grid.append(el('button', { type: 'button', class: 'note-btn', 'data-n': String(n), onclick: () => giveNote(n) }, el('b', { text: String(n) }), el('span', { text: label })));
  }
  body.className = 'rate';
  body.append(
    el(
      'div',
      { class: 'rate-song' },
      cover(song.art, 'rate-cover'),
      el('div', { class: 'rate-info' }, el('div', { class: 'title', text: song.title }), el('div', { class: 'artist', text: song.artist }), el('p', { class: 'muted rate-hint', text: 'Que nota você dá? Ela só serve para escolher os duelos de ajuste.' })),
      playButton(song)
    ),
    grid,
    el(
      'div',
      { class: 'rate-actions' },
      el('button', {
        class: 'btn ghost small',
        type: 'button',
        text: 'Pular',
        onclick: () => {
          player.pause();
          rateSkips.add(song.id);
          data.rateSong = null;
          renderDuel();
        },
      }),
      el('button', { class: 'btn ghost small', type: 'button', text: 'Arquivar', onclick: () => archiveSong(song.id) })
    )
  );
}

function renderNoteMode(body) {
  if (!tuneActive()) return renderRateScreen(body);
  const t = data.tune;
  const now = Date.now();
  const p = t.pending;
  const valid = p && !voteIds.has(p.id) && songById(p.a) && songById(p.b) && !songById(p.a).archived && !songById(p.b).archived;
  if (!valid) {
    const ids = activeSongs().map((x) => x.id);
    const st = getStat(state, t.song);
    // 1º duelo parte da região da nota; os seguintes acompanham a posição já ajustada
    const target = t.done === 0 ? noteTarget(state, ids, t.note, myNotes(), t.song) : st.rating;
    const opp = pickTuneOpponent(state, ids, t.song, target, new Set(t.faced), now);
    if (!opp) {
      data.tune = null;
      save();
      return renderRateScreen(body);
    }
    t.pending = Math.random() < 0.5 ? { id: newId(), a: t.song, b: opp } : { id: newId(), a: opp, b: t.song };
    save();
  }
  const song = songById(t.song);
  body.append(
    el(
      'div',
      { class: 'tune-bar' },
      el('span', { text: `Ajuste fino · duelo ${t.done + 1} de ${TUNE_DUELS}` }),
      el('span', { class: 'tune-note', text: `Sua nota: ${t.note}` })
    ),
    duelCard(songById(t.pending.a), 'A', { onVote: tuneVote }),
    el('div', { class: 'tie-row' }, el('button', { class: 'tie', type: 'button', text: 'Empate', onclick: () => tuneVote('D') })),
    duelCard(songById(t.pending.b), 'B', { onVote: tuneVote }),
    el('div', { class: 'tune-skip' }, el('button', {
      class: 'linkish',
      type: 'button',
      text: `Encerrar ajuste de “${song.title}”`,
      onclick: () => {
        data.tune = null;
        save();
        renderDuel();
      },
    }))
  );
  body.classList.add('entering');
  locked = false;
}

function tuneVote(r) {
  if (locked || !tuneActive()) return;
  const t = data.tune;
  const p = t.pending;
  if (!p) return;
  locked = true;
  player.pause();
  recordVote(p.id, p.a, p.b, r);
  t.faced.push(p.a === t.song ? p.b : p.a);
  t.done++;
  t.pending = null;
  const finished = t.done >= TUNE_DUELS;
  const title = songById(t.song)?.title;
  if (finished) data.tune = null;
  save();
  scheduleSync();

  const body = $('#duel-body');
  body.classList.remove('entering');
  body.querySelectorAll('.card').forEach((c) => {
    if (r === 'D') c.classList.add('tied');
    else c.classList.add(c.dataset.side === r ? 'chosen' : 'dimmed');
  });
  if (r === 'D') body.querySelector('.tie')?.classList.add('chosen');
  setTimeout(() => body.classList.add('leaving'), 300);
  setTimeout(() => {
    if (finished) {
      const pos = ranking(state, Date.now()).findIndex((x) => x.song.id === t.song) + 1;
      toast(`Ajuste feito: “${title}” está em ${pos}º no seu ranking.`);
    }
    if (currentTab === 'duel') renderDuel();
    else locked = false;
  }, 480);
}

// ---------- mata-mata ----------

let cupLocked = false;

// Torneios usam a mesma metodologia dos duelos individuais (sobre os meus votos).
function tourOpts() {
  const now = Date.now();
  return {
    select: (ids, k) => pickParticipants(state, ids, k, now),
    pair: (ids, forbid) => pairByInformation(state, ids, now, Math.random, forbid),
  };
}

function newCup() {
  const ids = activeSongs().map((x) => x.id);
  data.cup = createCup(ids, newId, Math.random, Date.now(), tourOpts());
  save();
  renderCup();
}

function cupVote(side) {
  if (cupLocked) return;
  const cur = currentMatch(data.cup);
  if (!cur) return;
  const { match } = cur;
  if (!songById(match.a) || !songById(match.b)) return;
  cupLocked = true;
  player.pause();
  recordVote(match.vid, match.a, match.b, side);
  recordWinner(data.cup, side === 'A' ? match.a : match.b, newId);
  save();
  scheduleSync();

  const body = $('#cup-body');
  const arena = body.querySelector('.arena');
  arena?.classList.remove('entering');
  arena?.querySelectorAll('.card').forEach((c) => c.classList.add(c.dataset.side === side ? 'chosen' : 'dimmed'));
  setTimeout(() => arena?.classList.add('leaving'), 300);
  setTimeout(() => {
    cupLocked = false;
    if (currentTab === 'cup') renderCup();
  }, 480);
}

function bracket(cup) {
  const box = el('div', { class: 'bracket' });
  const cur = currentMatch(cup);
  cup.rounds.forEach((round, r) => {
    const list = el('ol', { class: 'bracket-round' });
    round.forEach((m, i) => {
      const live = cur && cur.round === r && cur.index === i;
      const name = (id) => {
        const s = songById(id);
        const cls = m.w ? (m.w === id ? 'won' : 'lost') : '';
        return el('div', { class: 'bk-song ' + cls }, cover(s?.art, 'bk-thumb'), el('span', { text: s ? s.title : '—' }));
      };
      list.append(el('li', { class: 'bk-match' + (live ? ' live' : '') }, name(m.a), name(m.b)));
    });
    box.append(el('h3', { text: roundName(round.length) }), list);
  });
  return box;
}

function renderCup() {
  const body = $('#cup-body');
  body.replaceChildren();
  const cup = data.cup;
  const sub = $('#cup-sub');
  sub.textContent = '';

  if (syncEnabled && !data.me) {
    body.append(el('div', { class: 'empty' }, el('h2', { text: 'Escolha seu nome primeiro' }), el('button', { class: 'btn', type: 'button', text: 'Ir para o duelo', onclick: () => showTab('duel') })));
    return;
  }

  const seg = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Formato' });
  for (const [mode, label] of [['ko', 'Mata-mata'], ['swiss', 'Suíço']]) {
    seg.append(
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(data.tourMode === mode),
        text: label,
        onclick: () => {
          if (data.tourMode === mode) return;
          player.pause();
          data.tourMode = mode;
          save();
          renderCup();
        },
      })
    );
  }
  body.append(seg);
  if (data.tourMode === 'swiss') return renderSwiss(body);

  if (!cup) {
    const n = activeSongs().length;
    const enough = n >= CUP_SIZE;
    body.append(
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'Mata-mata' }),
        el('p', {
          text: enough
            ? `${CUP_SIZE} músicas sorteadas do seu catálogo, das oitavas até a final. Sem empate: alguém tem que passar. Cada jogo também conta para o ranking.`
            : `Você precisa de pelo menos ${CUP_SIZE} músicas no catálogo (tem ${n}).`,
        }),
        enough
          ? el('button', { class: 'btn', type: 'button', text: 'Sortear chaveamento', onclick: newCup })
          : el('button', { class: 'btn', type: 'button', text: 'Adicionar músicas', onclick: () => showTab('songs') })
      )
    );
    return;
  }

  const champ = champion(cup);
  if (champ) {
    const s = songById(champ);
    sub.textContent = 'Fim de jogo';
    body.append(
      el(
        'div',
        { class: 'champion' },
        el('div', { class: 'trophy', text: '🏆' }),
        cover(s?.art, 'champ-cover'),
        el('p', { class: 'champ-label', text: 'Campeã' }),
        el('h2', { text: s?.title || '—' }),
        el('p', { class: 'muted', text: s?.artist || '' }),
        el('div', { class: 'champ-actions' }, s ? playButton(s) : null, el('button', { class: 'btn', type: 'button', text: 'Novo mata-mata', onclick: newCup }))
      ),
      bracket(cup)
    );
    return;
  }

  const cur = currentMatch(cup);
  const round = cup.rounds[cur.round];
  sub.textContent = `${roundName(round.length)} · jogo ${cur.index + 1} de ${round.length}`;
  const a = songById(cur.match.a);
  const b = songById(cur.match.b);
  const arena = el('div', { class: 'arena entering' });
  if (a && b) {
    arena.append(
      duelCard(a, 'A', { onVote: cupVote, archive: false }),
      el('div', { class: 'tie-row' }, el('span', { class: 'vs', text: 'x' })),
      duelCard(b, 'B', { onVote: cupVote, archive: false })
    );
  } else {
    arena.append(el('p', { class: 'note', text: 'Uma música deste jogo não está mais disponível.' }));
  }
  body.append(
    arena,
    bracket(cup),
    el('div', { class: 'cup-reset' }, el('button', {
      class: 'btn ghost small',
      type: 'button',
      text: 'Sortear outro chaveamento',
      onclick: () => {
        if (confirm('Descartar este mata-mata e sortear outro? Os votos já dados continuam valendo no ranking.')) newCup();
      },
    }))
  );
}

// ---------- suíço ----------

let swissLocked = false;

function newSwiss() {
  data.swiss = createSwiss(activeSongs().map((x) => x.id), newId, Math.random, Date.now(), tourOpts());
  save();
  renderCup();
}

function swissVote(r) {
  if (swissLocked) return;
  const cur = currentSwissMatch(data.swiss);
  if (!cur) return;
  const { match } = cur;
  if (!songById(match.a) || !songById(match.b)) return;
  swissLocked = true;
  player.pause();
  recordVote(match.vid, match.a, match.b, r);
  recordSwiss(data.swiss, r, newId, Math.random, tourOpts());
  save();
  scheduleSync();

  const arena = $('#cup-body .arena');
  arena?.classList.remove('entering');
  arena?.querySelectorAll('.card').forEach((c) => {
    if (r === 'D') c.classList.add('tied');
    else c.classList.add(c.dataset.side === r ? 'chosen' : 'dimmed');
  });
  if (r === 'D') arena?.querySelector('.tie')?.classList.add('chosen');
  setTimeout(() => arena?.classList.add('leaving'), 300);
  setTimeout(() => {
    swissLocked = false;
    if (currentTab === 'cup') renderCup();
  }, 480);
}

const fmtPts = (p) => String(p).replace('.', ',');

function swissStandings(sw, highlight) {
  const rows = swissTable(sw);
  const list = el('ol', { class: 'standings' });
  rows.forEach((r, i) => {
    const s = songById(r.id);
    list.append(
      el(
        'li',
        { class: 'st-row' + (highlight?.has(r.id) ? ' live' : '') + (i < 3 && swissDone(sw) ? ' podium' : '') },
        el('span', { class: 'st-pos', text: String(i + 1) }),
        cover(s?.art, 'bk-thumb'),
        el('span', { class: 'st-name', text: s ? s.title : '—' }),
        el('span', { class: 'st-rec', text: `${r.w}V ${r.d}E ${r.l}D` }),
        el('b', { class: 'st-pts', text: fmtPts(r.pts) })
      )
    );
  });
  return el('div', { class: 'bracket' }, el('h3', { text: 'Classificação' }), list);
}

function renderSwiss(body) {
  const sw = data.swiss;
  const sub = $('#cup-sub');
  if (!sw) {
    const n = activeSongs().length;
    const enough = n >= SWISS_SIZE;
    body.append(
      el(
        'div',
        { class: 'empty' },
        el('h2', { text: 'Suíço' }),
        el('p', {
          text: enough
            ? `${SWISS_SIZE} músicas, ${SWISS_ROUNDS} rodadas, ninguém é eliminado. A cada rodada, quem tem a mesma pontuação se enfrenta. Vitória vale 1, empate ½. Cada jogo também conta para o ranking.`
            : `Você precisa de pelo menos ${SWISS_SIZE} músicas no catálogo (tem ${n}).`,
        }),
        enough
          ? el('button', { class: 'btn', type: 'button', text: 'Sortear 1ª rodada', onclick: newSwiss })
          : el('button', { class: 'btn', type: 'button', text: 'Adicionar músicas', onclick: () => showTab('songs') })
      )
    );
    return;
  }

  if (swissDone(sw)) {
    sub.textContent = 'Fim do torneio';
    const top = swissTable(sw).slice(0, 3);
    const podium = el('div', { class: 'podium-row' });
    // ordem visual: 2º, 1º, 3º
    for (const i of [1, 0, 2]) {
      const r = top[i];
      const s = songById(r?.id);
      podium.append(
        el(
          'div',
          { class: `podium-slot p${i + 1}` },
          el('div', { class: 'podium-medal', text: ['🥇', '🥈', '🥉'][i] }),
          cover(s?.art, 'podium-cover'),
          el('div', { class: 'podium-title', text: s?.title || '—' }),
          el('div', { class: 'podium-artist', text: s?.artist || '' }),
          el('div', { class: 'podium-pts', text: `${fmtPts(r?.pts ?? 0)} pts` }),
          s ? playButton(s, true) : null
        )
      );
    }
    body.append(
      podium,
      el('div', { class: 'champ-actions center' }, el('button', { class: 'btn', type: 'button', text: 'Novo suíço', onclick: newSwiss })),
      swissStandings(sw)
    );
    return;
  }

  const cur = currentSwissMatch(sw);
  const round = sw.rounds[cur.round];
  sub.textContent = `Rodada ${cur.round + 1} de ${SWISS_ROUNDS} · jogo ${cur.index + 1} de ${round.length}`;
  const a = songById(cur.match.a);
  const b = songById(cur.match.b);
  const pts = new Map(swissTable(sw).map((r) => [r.id, r.pts]));
  const arena = el('div', { class: 'arena entering' });
  if (a && b) {
    arena.append(
      duelCard(a, 'A', { onVote: swissVote, archive: false }),
      el('div', { class: 'tie-row' }, el('button', { class: 'tie', type: 'button', text: 'Empate', onclick: () => swissVote('D') })),
      duelCard(b, 'B', { onVote: swissVote, archive: false })
    );
  } else {
    arena.append(el('p', { class: 'note', text: 'Uma música deste jogo não está mais disponível.' }));
  }
  body.append(
    el('p', { class: 'legend swiss-info', text: `Confronto de quem tem ${fmtPts(pts.get(cur.match.a))} × ${fmtPts(pts.get(cur.match.b))} pontos` }),
    arena,
    swissStandings(sw, new Set([cur.match.a, cur.match.b])),
    el('div', { class: 'cup-reset' }, el('button', {
      class: 'btn ghost small',
      type: 'button',
      text: 'Sortear outro suíço',
      onclick: () => {
        if (confirm('Descartar este torneio e sortear outro? Os votos já dados continuam valendo no ranking.')) newSwiss();
      },
    }))
  );
}

// ---------- ranking ----------

let rankMode = syncEnabled ? 'all' : 'me';

function renderRanking() {
  const body = $('#rank-body');
  body.replaceChildren();
  const now = Date.now();
  const st = rankMode === 'all' ? stateAll : state;
  const rows = ranking(st, now);
  $('#rank-count').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'música' : 'músicas'}` : '';

  if (syncEnabled) {
    const seg = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Tipo de ranking' });
    for (const [mode, label] of [['all', 'Geral'], ['me', 'Meu']]) {
      seg.append(
        el('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(rankMode === mode),
          text: label,
          onclick: () => {
            rankMode = mode;
            renderRanking();
          },
        })
      );
    }
    body.append(seg);
    if (rankMode === 'all') {
      const voters = new Set(data.votes.map((v) => (v.voter || data.me || '').toLowerCase()).filter(Boolean));
      body.append(el('p', { class: 'legend', text: `${voters.size} ${voters.size === 1 ? 'pessoa' : 'pessoas'} · ${st.history.count} votos` }));
    }
  }

  if (st.history.count === 0) {
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
  const notesNow = myNotes();
  rows.forEach((r, i) => {
    const s = r.stat;
    const firm = r.rd < 80;
    const uncertain = r.rd >= 150;
    list.append(
      el(
        'li',
        { class: 'rank-row has-play' },
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
            el('span', { text: `${notesNow.has(r.song.id) ? `Nota ${notesNow.get(r.song.id).n} · ` : ''}${s.games} ${s.games === 1 ? 'duelo' : 'duelos'} (${s.w}V ${s.d}E ${s.l}D)` })
          )
        ),
        playButton(r.song, true)
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
    data.songs.push({ ...song, addedAt: Date.now(), archived: false, ...(syncEnabled ? { _p: 1 } : {}) });
    toast('Adicionada ao catálogo.');
  }
  save();
  scheduleSync();
  rebuild();
  renderResults();
  renderCatalog();
}

function archiveSong(id) {
  const s = data.songs.find((x) => x.id === id);
  if (!s) return;
  s.archived = true;
  if (data.pending && (data.pending.a === id || data.pending.b === id)) data.pending = null;
  if (data.tune?.song === id) data.tune = null;
  else if (data.tune?.pending && (data.tune.pending.a === id || data.tune.pending.b === id)) data.tune.pending = null;
  if (data.rateSong === id) data.rateSong = null;
  if (player.state.id === id) player.pause();
  save();
  rebuild();
  renderCatalog();
  renderResults();
  if (currentTab === 'duel') renderDuel();
  if (currentTab === 'rank') renderRanking();
  toast('Música arquivada.', {
    label: 'Desfazer',
    run: () => {
      s.archived = false;
      save();
      rebuild();
      renderCatalog();
      renderResults();
      if (currentTab === 'rank') renderRanking();
      if (currentTab === 'duel' && $('#duel-body .empty')) renderDuel();
    },
  });
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

// ---------- pacote inicial ----------

let seedPack = null;

function missingSeedSongs() {
  if (!seedPack) return [];
  return seedPack.songs.filter((x) => {
    const s = data.songs.find((y) => y.id === x.id);
    return !s || s.archived;
  });
}

function addSeed() {
  const missing = missingSeedSongs();
  if (!missing.length) return;
  const now = Date.now();
  for (const song of missing) {
    const existing = data.songs.find((s) => s.id === song.id);
    if (existing) existing.archived = false;
    else data.songs.push({ ...song, addedAt: now, archived: false, ...(syncEnabled ? { _p: 1 } : {}) });
  }
  save();
  scheduleSync();
  rebuild();
  toast(`${missing.length} músicas adicionadas.`);
  renderSeed();
  renderCatalog();
  renderResults();
  if (currentTab === 'duel') renderDuel();
}

function seedButton() {
  const n = missingSeedSongs().length;
  if (!n) return null;
  return el('button', { class: 'btn', type: 'button', text: `Adicionar pacote ${seedPack.name} (${n} músicas)`, onclick: addSeed });
}

function renderSeed() {
  const box = $('#seed');
  box.replaceChildren();
  const btn = seedButton();
  if (btn) box.append(btn);
}

loadSeed().then((pack) => {
  seedPack = pack;
  renderSeed();
  if (currentTab === 'duel' && activeSongs().length < 2) renderDuel();
});

// ---------- sincronização ----------

function setName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return toast('Digite um nome.');
  data.me = name;
  save();
  rebuild();
  renderMe();
  scheduleSync();
  renderDuel();
}

let syncing = false;
let syncAgain = false;
let syncState = 'idle'; // idle | ok | offline
let syncTimer = null;

function scheduleSync(delay = 800) {
  if (!syncEnabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!syncEnabled || !data.me) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    // votos antigos sem autor passam a ser meus
    for (const v of data.votes) {
      if (!v.voter) {
        v.voter = data.me;
        v._p = 1;
      }
    }
    // _s = já está no banco (enviada ou recebida); músicas antigas sem a marca sobem uma vez
    const songsOut = data.songs.filter((x) => !x._s);
    if (songsOut.length) {
      await pushRows('songs', songsOut.map((x) => songToRow(x, data.me)));
      songsOut.forEach((x) => {
        delete x._p;
        x._s = 1;
      });
      save();
    }
    const votesOut = data.votes.filter((v) => v._p);
    if (votesOut.length) {
      await pushRows('votes', votesOut.map(voteToRow));
      votesOut.forEach((v) => delete v._p);
      save();
    }
    for (const x of data.notes) {
      if (!x.voter) {
        x.voter = data.me;
        x._p = 1;
      }
    }
    const notesOut = data.notes.filter((x) => x._p);
    if (notesOut.length) {
      await pushRows('ratings', notesOut.map((x) => ({ id: x.id, song: x.song, n: x.n, t: x.t, voter: x.voter })));
      notesOut.forEach((x) => delete x._p);
      save();
    }

    let changed = false;
    const songRows = await pullRows('songs', 'seq,id,title,artist,album,art,preview,link,itunes_id,added_at', data.seq.songs);
    const known = new Set(data.songs.map((x) => x.id));
    for (const r of songRows) {
      data.seq.songs = Math.max(data.seq.songs, r.seq);
      if (!known.has(r.id)) {
        known.add(r.id);
        data.songs.push({ ...rowToSong(r), _s: 1 });
        changed = true;
      }
    }
    const noteIds = new Set(data.notes.map((x) => x.id));
    const noteRows = await pullRows('ratings', 'seq,id,song,n,t,voter', data.seq.ratings || 0);
    for (const r of noteRows) {
      data.seq.ratings = Math.max(data.seq.ratings || 0, r.seq);
      if (!noteIds.has(r.id)) {
        noteIds.add(r.id);
        data.notes.push({ id: r.id, song: r.song, n: Number(r.n), t: Number(r.t), voter: r.voter });
        changed = true;
      }
    }
    const voteRows = await pullRows('votes', 'seq,id,a,b,r,t,voter', data.seq.votes);
    for (const r of voteRows) {
      data.seq.votes = Math.max(data.seq.votes, r.seq);
      if (!voteIds.has(r.id)) {
        voteIds.add(r.id);
        data.votes.push(rowToVote(r));
        changed = true;
      }
    }
    save();
    syncState = 'ok';
    if (changed) {
      rebuild();
      if (currentTab === 'rank') renderRanking();
      if (currentTab === 'songs') {
        renderCatalog();
        renderSeed();
      }
      if (currentTab === 'duel' && $('#duel-body .empty')) renderDuel();
      else $('#duel-count').textContent = state.history.count ? `${state.history.count} ${state.history.count === 1 ? 'duelo' : 'duelos'}` : '';
    }
  } catch (e) {
    console.warn('Falha ao sincronizar', e);
    syncState = 'offline';
  } finally {
    syncing = false;
    renderMe();
    if (syncAgain) {
      syncAgain = false;
      scheduleSync(0);
    }
  }
}

function renderMe() {
  const box = $('#me');
  if (!box) return;
  box.replaceChildren();
  if (!syncEnabled) return;
  const pending = data.votes.filter((v) => v._p).length;
  const status =
    syncState === 'offline'
      ? `Sem conexão com o ranking geral${pending ? ` · ${pending} votos aguardando envio` : ''}`
      : syncState === 'ok'
        ? 'Sincronizado com o ranking geral'
        : 'Conectando ao ranking geral…';
  box.append(
    el('h2', { text: 'Você' }),
    el('p', { class: 'note', text: data.me ? `Votando como ${data.me}. ${status}.` : 'Escolha seu nome na aba Duelo.' })
  );
  if (data.me) {
    box.append(
      el('button', {
        class: 'btn ghost small',
        type: 'button',
        text: 'Trocar nome',
        onclick: () => {
          const name = prompt('Novo nome (seus votos antigos continuam com o nome anterior):', data.me);
          if (name != null && name.trim()) setName(name);
        },
      })
    );
  }
}

if (syncEnabled) {
  setInterval(() => {
    if (!document.hidden) syncNow();
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSync(0);
  });
  window.addEventListener('online', () => scheduleSync(0));
}

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

showTab('duel');
renderMe();
scheduleSync(0);
