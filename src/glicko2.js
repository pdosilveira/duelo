// Glicko-2 (Glickman, "Example of the Glicko-2 system", 2012), sem dependência do DOM.
// Extensão: períodos fracionários. `elapsed` é o tempo desde a última atualização,
// medido em períodos de classificação; a incerteza pré-período é
// φ* = sqrt(φ² + elapsed·σ'²). Com elapsed = 1 o cálculo é exatamente o do paper.

export const SCALE = 173.7178;

export const DEFAULTS = Object.freeze({ rating: 1500, rd: 350, vol: 0.06 });

export const PARAMS = Object.freeze({
  tau: 0.5,
  maxVol: 0.1,
  minRd: 40,
  maxRd: 350,
  epsilon: 1e-6,
});

export function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

// Probabilidade esperada (escala Glicko-2) de μ vencer μj, cujo desvio é φj.
export function expected(mu, muj, phij) {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

export function toMu(rating) {
  return (rating - 1500) / SCALE;
}

export function toPhi(rd) {
  return rd / SCALE;
}

// RD inflado pelo tempo sem jogos (passo 6 do paper, sem jogos).
export function inflateRd(rd, vol, elapsed, params = PARAMS) {
  const p = { ...PARAMS, ...params };
  const phi = rd / SCALE;
  const t = elapsed > 0 ? elapsed : 0;
  let phiStar = Math.sqrt(phi * phi + t * vol * vol);
  if (p.maxRd != null) phiStar = Math.min(phiStar, p.maxRd / SCALE);
  return phiStar * SCALE;
}

// Passo 5: nova volatilidade pelo algoritmo de Illinois.
export function solveVolatility(delta, phi, v, sigma, tau, epsilon = 1e-6) {
  const a = Math.log(sigma * sigma);
  const d2 = delta * delta;
  const p2 = phi * phi;
  const f = (x) => {
    const ex = Math.exp(x);
    const den = p2 + v + ex;
    return (ex * (d2 - p2 - v - ex)) / (2 * den * den) - (x - a) / (tau * tau);
  };

  let A = a;
  let B;
  if (d2 > p2 + v) {
    B = Math.log(d2 - p2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > epsilon && guard++ < 200) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

// player: {rating, rd, vol}; results: [{rating, rd, score}] com o RD do oponente
// já inflado até o momento do jogo. Retorna {rating, rd, vol}.
export function update(player, results, elapsed = 1, params = PARAMS) {
  const p = { ...PARAMS, ...params };
  const sigma = player.vol;
  if (!results || results.length === 0) {
    return { rating: player.rating, rd: inflateRd(player.rd, sigma, elapsed, p), vol: sigma };
  }

  const mu = toMu(player.rating);
  const phi = toPhi(player.rd);

  let vInv = 0;
  let sum = 0;
  for (const o of results) {
    const gj = g(toPhi(o.rd));
    const E = 1 / (1 + Math.exp(-gj * (mu - toMu(o.rating))));
    vInv += gj * gj * E * (1 - E);
    sum += gj * (o.score - E);
  }
  const v = 1 / vInv;
  const delta = v * sum;

  let sigmaNew = solveVolatility(delta, phi, v, sigma, p.tau, p.epsilon);
  if (p.maxVol != null) sigmaNew = Math.min(sigmaNew, p.maxVol);

  const t = elapsed > 0 ? elapsed : 0;
  let phiStar = Math.sqrt(phi * phi + t * sigmaNew * sigmaNew);
  if (p.maxRd != null) phiStar = Math.min(phiStar, p.maxRd / SCALE);

  let phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  if (p.minRd != null) phiNew = Math.max(phiNew, p.minRd / SCALE);
  if (p.maxRd != null) phiNew = Math.min(phiNew, p.maxRd / SCALE);

  const muNew = mu + phiNew * phiNew * sum;
  return { rating: muNew * SCALE + 1500, rd: phiNew * SCALE, vol: sigmaNew };
}
