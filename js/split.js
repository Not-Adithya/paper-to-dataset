// Train / validation split. Pure functions, no DOM.
// Pairs from the same section (or the same paper, when there are many papers) always stay together,
// so the validation set never contains text the training set has also seen.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// fraction = share of pairs that go to validation (0 to 0.5). Same seed = same split every time.
export function splitPairs(pairs, fraction, seed = 42) {
  if (!(fraction > 0) || pairs.length < 2) return { train: pairs, validation: [], by: 'none' };
  const rand = rng(seed);
  const target = Math.max(1, Math.round(pairs.length * Math.min(fraction, 0.5)));

  const papers = new Set(pairs.map((p) => p.meta.paperId));
  const byPaper = papers.size >= 10;
  const keyOf = (p) => (byPaper ? p.meta.paperId : `${p.meta.paperId}||${p.meta.section}`);

  const groups = new Map();
  for (const p of pairs) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const valKeys = new Set();
  let n = 0;
  for (const k of shuffle([...groups.keys()], rand)) {
    if (n >= target) break;
    if (valKeys.size >= groups.size - 1) break;          // keep at least one group for training
    const size = groups.get(k).length;
    if (size > target * 2 + 1) continue;                  // a group far bigger than the target would swamp the validation set
    if (n > 0 && n + size > target * 1.25) continue;      // do not overshoot by much
    valKeys.add(k);
    n += size;
  }

  if (valKeys.size) {
    return {
      train: pairs.filter((p) => !valKeys.has(keyOf(p))),
      validation: pairs.filter((p) => valKeys.has(keyOf(p))),
      by: byPaper ? 'paper' : 'section',
    };
  }

  // fallback: one giant group, so split pair by pair
  const idx = new Set(shuffle(pairs.map((_, i) => i), rand).slice(0, target));
  return {
    train: pairs.filter((_, i) => !idx.has(i)),
    validation: pairs.filter((_, i) => idx.has(i)),
    by: 'pair',
  };
}
