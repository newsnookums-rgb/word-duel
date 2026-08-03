/* The pass-out ending, which random games almost never reach on their own.
 *
 * Zynga: "The game could also end if three successive turns have occurred with
 * no scoring and as long as the score is not zero-zero." */

load('./engine.js');
const dict = new Set(readFile('./dict.txt').split('\n').filter(Boolean));

let checks = 0, fails = 0;
const bad = [];
const ok = (cond, what) => { checks++; if (!cond) { fails++; bad.push(what); } };

/* Finds a real opening word from the rack a given seed deals, laid left to
 * right from the centre so it covers the star. */
function openingPlay(seed) {
  const st = ENGINE.replay({ seed, moves: [] }, dict);
  const rack = st.racks[0].filter((c) => c !== '?');
  const seen = new Set();
  const out = [];
  (function perm(chosen, left) {
    if (chosen.length >= 2) {
      const w = chosen.join('');
      if (!seen.has(w)) {
        seen.add(w);
        if (dict.has(w)) out.push(chosen.slice());
      }
    }
    if (chosen.length >= 5 || out.length) return;
    for (let i = 0; i < left.length; i++) {
      perm(chosen.concat(left[i]), left.slice(0, i).concat(left.slice(i + 1)));
      if (out.length) return;
    }
  })([], rack);
  if (!out.length) return null;
  return {
    t: 'play', p: 0,
    tiles: out[0].map((letter, i) => ({ r: 7, c: 7 + i, letter, blank: false })),
  };
}

let seed = null, opener = null;
for (let s = 1; s < 400 && !opener; s++) { opener = openingPlay(s); if (opener) seed = s; }
ok(!!opener, 'could not find any seed with a playable opening word');

const pass = (p) => ({ t: 'pass', p });
const run = (moves) => ENGINE.replay({ seed, moves }, dict);

/* 1. Three passes from 0-0 must NOT end the game. */
let st = run([pass(0), pass(1), pass(0)]);
ok(!st.over, 'three passes ended a 0-0 game — the zero-zero guard is missing');
st = run([pass(0), pass(1), pass(0), pass(1), pass(0), pass(1)]);
ok(!st.over, 'six passes ended a 0-0 game');

/* 2. Once someone has scored, three scoreless turns end it — and not before. */
const scored = run([opener]);
ok(scored.scores[0] > 0, 'the opening word scored nothing, test is not meaningful');
ok(!scored.over, 'the game ended on the opening move');

ok(!run([opener, pass(1), pass(0)]).over, 'ended after only two scoreless turns');

const ended = run([opener, pass(1), pass(0), pass(1)]);
ok(!!ended.over, 'did not end after three scoreless turns');
ok(ended.over && ended.over.reason === 'stalled', 'wrong end reason');

/* 3. Each player drops their own leftover rack in that ending. */
if (ended.over) {
  const left = [0, 1].map((i) =>
    ended.racks[i].reduce((a, ch) => a + ENGINE.VALUES[ch], 0));
  const raw = run([opener, pass(1), pass(0)]).scores;
  ok(ended.scores[0] === raw[0] - left[0] && ended.scores[1] === raw[1] - left[1],
    `stalled scoring wrong: ${ended.scores} vs ${raw} minus ${left}`);
}

/* 4. A scoring turn resets the counter: two passes, then a word, then two
 *    more passes is five scoreless-ish turns but never three in a row. */
ok(!run([pass(0), pass(1), opener, pass(1), pass(0)]).over,
  'a scoring play did not reset the scoreless counter');
ok(!!run([pass(0), pass(1), opener, pass(1), pass(0), pass(1)]).over,
  'did not end on the third scoreless turn after the reset');

/* 5. Swaps count as scoreless turns, same as passes. */
const s1 = run([opener]);
const swapMove = (p) => ({ t: 'swap', p, tiles: [s1.racks[p][0]] });
const bySwaps = run([opener, swapMove(1), pass(0), swapMove(1)]);
ok(!!bySwaps.over, 'swaps did not count toward the scoreless counter');

/* 6. Resignation ends it immediately and the other player wins. */
const res = run([opener, { t: 'resign', p: 1 }]);
ok(res.over && res.over.reason === 'resign', 'resign did not end the game');
ok(res.winner === 0, 'resigning player was not recorded as the loser');

print(`endgame: ${checks - fails}/${checks} rules hold (seed ${seed}, opener ${
  opener ? opener.tiles.map((t) => t.letter).join('') : '-'})`);
for (const b of bad) print('  ' + b);
if (fails) throw new Error(`${fails} endgame rule failures`);
