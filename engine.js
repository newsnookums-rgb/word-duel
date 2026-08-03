/* Words With Friends — rules engine.
 *
 * Board layout, letter values and tile counts are lifted verbatim from the
 * engine in ~/.claude/skills/scrabble/wwf.py, which has been validated square
 * by square against real games. They are WWF's, not Scrabble's: 104 tiles,
 * different letter values, 35-point bingo, no multiplier on the centre star.
 *
 * The whole game is stored as a seed plus an ordered list of moves. Both
 * phones replay that list to reach the same state, so a sync is just the move
 * list travelling across — a few hundred bytes, and impossible to half-apply.
 */

const SIZE = 15;
const CENTRE = 7;              // 0-indexed
const RACK_SIZE = 7;
const BINGO_BONUS = 35;

const VALUES = {
  A: 1, B: 4, C: 4, D: 2, E: 1, F: 4, G: 3, H: 3, I: 1, J: 10, K: 5, L: 2,
  M: 4, N: 2, O: 1, P: 4, Q: 10, R: 1, S: 1, T: 1, U: 2, V: 5, W: 4, X: 8,
  Y: 3, Z: 10, '?': 0,
};

const DISTRIBUTION = {
  A: 9, B: 2, C: 2, D: 5, E: 13, F: 2, G: 3, H: 4, I: 8, J: 1, K: 1, L: 4,
  M: 2, N: 5, O: 8, P: 2, Q: 1, R: 6, S: 5, T: 7, U: 4, V: 2, W: 2, X: 1,
  Y: 2, Z: 1, '?': 2,
};

/* Premium squares, 1-indexed exactly as wwf.py lists them, converted to
 * 0-indexed below. Keeping the source form makes them checkable by eye. */
const _TW = [[1,4],[1,12],[4,1],[4,15],[12,1],[12,15],[15,4],[15,12]];
const _DW = [[2,6],[2,10],[4,8],[6,2],[6,14],[8,4],[8,12],[10,2],[10,14],[12,8],[14,6],[14,10]];
const _TL = [[1,7],[1,9],[4,4],[4,12],[6,6],[6,10],[7,1],[7,15],[9,1],[9,15],[10,6],[10,10],[12,4],[12,12],[15,7],[15,9]];
const _DL = [[2,3],[2,13],[3,2],[3,5],[3,11],[3,14],[5,3],[5,7],[5,9],[5,13],[7,5],[7,11],[9,5],[9,11],[11,3],[11,7],[11,9],[11,13],[13,2],[13,5],[13,11],[13,14],[14,3],[14,13]];

const PREMIUM = (() => {
  const g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  const put = (list, kind) => list.forEach(([r, c]) => { g[r - 1][c - 1] = kind; });
  put(_TW, 'TW'); put(_DW, 'DW'); put(_TL, 'TL'); put(_DL, 'DL');
  return g;
})();

/* The layout has 4-fold symmetry. One wrong square silently corrupts every
 * score from here on, so assert it rather than trust the transcription. */
(function checkSymmetry() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const k = PREMIUM[r][c];
      const mirrors = [[14 - r, c], [r, 14 - c], [14 - r, 14 - c], [c, r]];
      for (const [mr, mc] of mirrors) {
        if (PREMIUM[mr][mc] !== k) {
          throw new Error(`board layout asymmetry at ${r},${c} vs ${mr},${mc}`);
        }
      }
    }
  }
  if (PREMIUM[CENTRE][CENTRE] !== null) throw new Error('centre must be plain');
  const total = Object.values(DISTRIBUTION).reduce((a, b) => a + b, 0);
  if (total !== 104) throw new Error(`tile count ${total}, expected 104`);
})();

const letterMult = (p) => (p === 'DL' ? 2 : p === 'TL' ? 3 : 1);
const wordMult   = (p) => (p === 'DW' ? 2 : p === 'TW' ? 3 : 1);

/* ------------------------------------------------------------------ bag */

/* mulberry32 — small, and uses Math.imul so it produces bit-identical output
 * on both phones. A drifting PRNG would silently deal different racks. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const a = items.slice();
  const rand = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function freshBag(seed) {
  const tiles = [];
  for (const [ch, n] of Object.entries(DISTRIBUTION)) {
    for (let i = 0; i < n; i++) tiles.push(ch);
  }
  return shuffled(tiles, seed);
}

/* ------------------------------------------------------------ board reads */

const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const at = (board, r, c) => (inBounds(r, c) ? board[r][c] : null);

/* Walk out from a square in one direction to the ends of its unbroken run. */
function runThrough(board, r, c, dr, dc) {
  let sr = r, sc = c;
  while (at(board, sr - dr, sc - dc)) { sr -= dr; sc -= dc; }
  const cells = [];
  let er = sr, ec = sc;
  while (at(board, er, ec)) { cells.push([er, ec]); er += dr; ec += dc; }
  return cells;
}

const cellsToWord = (board, cells) =>
  cells.map(([r, c]) => board[r][c].letter).join('');

/* ------------------------------------------------------ scoring one play */

/* `placed` is [{r, c, letter, blank}]. The board passed in must already have
 * them written onto it. Returns every word formed and the total score. */
function scorePlacement(board, placed) {
  const newAt = new Map(placed.map((p) => [`${p.r},${p.c}`, p]));
  const isNew = (r, c) => newAt.has(`${r},${c}`);

  let dir;
  if (placed.length === 1) {
    const { r, c } = placed[0];
    dir = runThrough(board, r, c, 0, 1).length >= 2 ? 'H' : 'V';
  } else {
    dir = placed.every((p) => p.r === placed[0].r) ? 'H' : 'V';
  }
  const [dr, dc] = dir === 'H' ? [0, 1] : [1, 0];

  const words = [];
  let total = 0;

  const scoreRun = (cells) => {
    let sum = 0, wm = 1;
    for (const [r, c] of cells) {
      const cell = board[r][c];
      const val = cell.blank ? 0 : VALUES[cell.letter];
      if (isNew(r, c)) {
        const p = PREMIUM[r][c];
        sum += val * letterMult(p);
        wm *= wordMult(p);
      } else {
        sum += val;
      }
    }
    return sum * wm;
  };

  const main = runThrough(board, placed[0].r, placed[0].c, dr, dc);
  if (main.length >= 2) {
    const pts = scoreRun(main);
    words.push({ word: cellsToWord(board, main), points: pts, cells: main });
    total += pts;
  }

  /* Each new tile may also complete a word running the other way. */
  for (const p of placed) {
    const cross = runThrough(board, p.r, p.c, dc, dr);
    if (cross.length >= 2) {
      const pts = scoreRun(cross);
      words.push({ word: cellsToWord(board, cross), points: pts, cells: cross });
      total += pts;
    }
  }

  const bingo = placed.length === RACK_SIZE;
  if (bingo) total += BINGO_BONUS;

  return { words, total, bingo };
}

/* -------------------------------------------------------- legality checks */

/* Checks shape and connectivity only — the caller checks the dictionary, so
 * that an unknown word can be reported differently from an illegal placement. */
function checkShape(board, placed, isFirstMove) {
  if (!placed.length) return 'Place at least one tile.';

  for (const p of placed) {
    if (!inBounds(p.r, p.c)) return 'Tile off the board.';
  }
  const keys = new Set(placed.map((p) => `${p.r},${p.c}`));
  if (keys.size !== placed.length) return 'Two tiles on the same square.';

  const sameRow = placed.every((p) => p.r === placed[0].r);
  const sameCol = placed.every((p) => p.c === placed[0].c);
  if (!sameRow && !sameCol) return 'Tiles must all be in one row or one column.';

  const [dr, dc] = sameRow ? [0, 1] : [1, 0];
  const line = placed.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
  let [r, c] = [line[0].r, line[0].c];
  const last = line[line.length - 1];
  while (r !== last.r || c !== last.c) {
    r += dr; c += dc;
    if (!at(board, r, c) && !keys.has(`${r},${c}`)) {
      return 'No gaps — the tiles must make one unbroken word.';
    }
  }

  if (isFirstMove) {
    if (!keys.has(`${CENTRE},${CENTRE}`)) {
      return 'The first word must cover the centre star.';
    }
    if (placed.length < 2) return 'The first word needs at least two letters.';
    return null;
  }

  const touches = placed.some((p) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => at(board, p.r + a, p.c + b))
  );
  if (!touches) return 'Your word must touch a word already on the board.';
  return null;
}

/* ------------------------------------------------------------- the replay */

/* Rebuilds the whole game from the seed and the move list. Everything the UI
 * shows is derived here, so the two phones cannot drift apart: same seed plus
 * same moves always gives the same board, racks, scores and turn. */
function replay(game, dict) {
  const board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  const bag = freshBag(game.seed);
  const racks = [[], []];
  const scores = [0, 0];
  const log = [];

  const draw = (rack) => {
    while (rack.length < RACK_SIZE && bag.length) rack.push(bag.pop());
  };
  draw(racks[0]);
  draw(racks[1]);

  let turn = 0;
  let consecutiveScoreless = 0;
  let over = null;

  for (let i = 0; i < game.moves.length; i++) {
    const mv = game.moves[i];
    const who = mv.p;

    if (mv.t === 'play') {
      const placed = mv.tiles.map((t) => ({
        r: t.r, c: t.c, letter: t.letter, blank: !!t.blank,
      }));
      for (const p of placed) board[p.r][p.c] = { letter: p.letter, blank: p.blank };

      const { words, total, bingo } = scorePlacement(board, placed);
      scores[who] += total;

      /* Spend the tiles: a blank leaves the rack as '?', not as its letter. */
      for (const p of placed) {
        const want = p.blank ? '?' : p.letter;
        const k = racks[who].indexOf(want);
        if (k >= 0) racks[who].splice(k, 1);
      }
      draw(racks[who]);

      log.push({
        p: who, kind: 'play', score: total, bingo,
        words: words.map((w) => w.word),
        main: words.length ? words[0].word : '',
      });
      consecutiveScoreless = 0;

      if (!racks[who].length && !bag.length) {
        /* Going out: the player takes the value left on the other rack, and
         * the other player loses it. */
        const stuck = racks[1 - who].reduce((s, ch) => s + VALUES[ch], 0);
        scores[who] += stuck;
        scores[1 - who] -= stuck;
        over = { reason: 'out', by: who, swing: stuck };
      }
    } else if (mv.t === 'swap') {
      for (const ch of mv.tiles) {
        const k = racks[who].indexOf(ch);
        if (k >= 0) racks[who].splice(k, 1);
      }
      draw(racks[who]);
      /* Returned tiles go back and the bag is reshuffled, keyed on the move
       * index so both phones reshuffle it identically. */
      bag.push(...mv.tiles);
      const re = shuffled(bag, (game.seed ^ (i + 1) * 0x9E3779B9) >>> 0);
      bag.length = 0;
      bag.push(...re);
      log.push({ p: who, kind: 'swap', count: mv.tiles.length, score: 0 });
      consecutiveScoreless++;
    } else if (mv.t === 'pass') {
      log.push({ p: who, kind: 'pass', score: 0 });
      consecutiveScoreless++;
    } else if (mv.t === 'resign') {
      log.push({ p: who, kind: 'resign', score: 0 });
      over = { reason: 'resign', by: who };
    }

    if (!over && consecutiveScoreless >= 6) {
      /* Nobody can move. Each player drops what is left on their rack. */
      for (const s of [0, 1]) scores[s] -= racks[s].reduce((a, ch) => a + VALUES[ch], 0);
      over = { reason: 'stalled' };
    }
    if (over) { turn = -1; break; }
    turn = 1 - who;
  }

  let winner = null;
  if (over) {
    if (over.reason === 'resign') winner = 1 - over.by;
    else winner = scores[0] === scores[1] ? -1 : (scores[0] > scores[1] ? 0 : 1);
  }

  return {
    board, bag, racks, scores, turn, log, over, winner,
    bagCount: bag.length,
    isFirstMove: game.moves.every((m) => m.t !== 'play'),
  };
}

/* Validates a candidate play against a replayed state, without mutating it. */
function tryPlay(state, placed, dict) {
  const shapeErr = checkShape(state.board, placed, state.isFirstMove);
  if (shapeErr) return { ok: false, error: shapeErr };

  const board = state.board.map((row) => row.slice());
  for (const p of placed) board[p.r][p.c] = { letter: p.letter, blank: !!p.blank };

  const { words, total, bingo } = scorePlacement(board, placed);
  if (!words.length) return { ok: false, error: 'That does not make a word.' };

  const bad = words.filter((w) => !dict.has(w.word));
  if (bad.length) {
    const list = [...new Set(bad.map((w) => w.word))].join(', ');
    return { ok: false, error: `Not a word: ${list}`, invalid: list };
  }
  return { ok: true, words, total, bingo };
}

const ENGINE = {
  SIZE, CENTRE, RACK_SIZE, BINGO_BONUS, VALUES, DISTRIBUTION, PREMIUM,
  freshBag, shuffled, rng, replay, tryPlay, scorePlacement, checkShape,
  runThrough, cellsToWord,
};

if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
if (typeof globalThis !== 'undefined') globalThis.ENGINE = ENGINE;
