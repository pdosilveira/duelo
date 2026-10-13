// Camada de áudio independente do ranking. Interface: play / pause / toggle / onChange.
// Um único <audio>, uma faixa por vez. Trocar de provedor = trocar a URL da faixa.

export function createPlayer(doc = document) {
  const audio = doc.createElement('audio');
  audio.setAttribute('playsinline', '');
  audio.setAttribute('webkit-playsinline', '');
  audio.preload = 'none';
  audio.style.display = 'none';
  doc.body.appendChild(audio);

  let current = null; // {id, url}
  let status = 'idle'; // idle | loading | playing | paused | error
  const listeners = new Set();

  const emit = (s) => {
    status = s;
    for (const fn of listeners) fn({ id: current?.id ?? null, status });
  };

  audio.addEventListener('playing', () => emit('playing'));
  audio.addEventListener('waiting', () => current && emit('loading'));
  audio.addEventListener('pause', () => current && status === 'playing' && emit('paused'));
  audio.addEventListener('ended', () => emit('paused'));
  audio.addEventListener('error', () => current && emit('error'));

  async function play(track) {
    if (!track?.url) {
      current = track ?? null;
      emit('error');
      return;
    }
    if (current?.id !== track.id) {
      audio.pause();
      current = { id: track.id, url: track.url };
      audio.src = track.url;
    }
    emit('loading');
    try {
      await audio.play();
    } catch (err) {
      if (err?.name !== 'AbortError') emit('error');
    }
  }

  function pause() {
    if (!audio.paused) audio.pause();
    if (current && (status === 'playing' || status === 'loading')) emit('paused');
  }

  function toggle(track) {
    if (current?.id === track?.id && (status === 'playing' || status === 'loading')) pause();
    else play(track);
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    play,
    pause,
    toggle,
    onChange,
    get state() {
      return { id: current?.id ?? null, status };
    },
  };
}
