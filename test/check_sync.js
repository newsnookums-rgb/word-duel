/* Properties the merge has to hold, or the two phones never settle.
 *
 * The critical one is symmetry: each phone runs merge() with its own copy as
 * `mine`, so if merge(a,b) and merge(b,a) disagreed they would trade copies
 * back and forth forever. */

load('./engine.js');
load('./sync.js');

/* Key order differs between the two spread paths, so compare canonically. */
const canon = (o) => JSON.stringify(o, (k, v) =>
  (v && typeof v === 'object' && !Array.isArray(v))
    ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]]))
    : v);

let checks = 0, fails = 0;
const bad = [];
function ok(cond, what) {
  checks++;
  if (!cond) { fails++; bad.push(what); }
}

const P = (id, name) => ({ id, name });
const play = (p, r, c, letter) => ({ t: 'play', p, tiles: [{ r, c, letter, blank: false }] });

const game = (over) => Object.assign({
  id: 'g1', room: 'ABC123', seed: 42, players: [P('devA', 'A'), P('devB', 'B')],
  moves: [],
}, over || {});

/* ---- garbage must never win ---- */
const good = game();
for (const junk of [null, undefined, 42, 'hello', {}, { seed: 1 },
                    { seed: 1, moves: 'no', players: [null, null] },
                    { seed: NaN, moves: [], players: [null, null] },
                    { seed: 1, moves: [], players: [null] },
                    { seed: 1, moves: [{ t: 'play', p: 5, tiles: [] }], players: [null, null] },
                    { seed: 1, moves: [{ t: 'play', p: 0, tiles: [{ r: 99, c: 0, letter: 'A' }] }], players: [null, null] },
                    { seed: 1, moves: [{ t: 'play', p: 0, tiles: [{ r: 1, c: 1, letter: 'aa' }] }], players: [null, null] },
                    { seed: 1, moves: [{ t: 'swap', p: 0, tiles: ['9'] }], players: [null, null] },
                    { seed: 1, moves: [{ t: 'nonsense', p: 0 }], players: [null, null] }]) {
  ok(canon(merge(good, junk)) === canon(good), `garbage won: ${JSON.stringify(junk)}`);
  ok(sane(junk) === false, `sane() accepted junk: ${JSON.stringify(junk)}`);
}
ok(sane(good) === true, 'sane() rejected a valid game');

/* ---- provisional always loses ---- */
const prov = game({ id: 'pending', seed: 1, players: [null, null], provisional: true });
const real = game({ moves: [play(0, 7, 7, 'H')] });
ok(canon(merge(prov, real)) === canon(real), 'provisional did not yield to the real game');
ok(canon(merge(real, prov)) === canon(real), 'real game lost to a provisional');

/* ---- longer move list wins ---- */
const short = game({ moves: [play(0, 7, 7, 'H')] });
const long = game({ moves: [play(0, 7, 7, 'H'), play(1, 8, 7, 'I')] });
ok(merge(short, long).moves.length === 2, 'shorter log won');
ok(merge(long, short).moves.length === 2, 'shorter log won (reversed)');

/* ---- idempotence ---- */
ok(canon(merge(long, long)) === canon(long), 'merge(a,a) changed a');

/* ---- seat claiming: both devices grab seat 1 at the same moment ---- */
const base = game({ players: [P('devA', 'A'), null] });
const claimX = game({ players: [P('devA', 'A'), P('devX', 'X')] });
const claimY = game({ players: [P('devA', 'A'), P('devY', 'Y')] });
const r1 = merge(claimX, claimY), r2 = merge(claimY, claimX);
ok(canon(r1) === canon(r2), 'simultaneous seat claims did not converge');
ok(r1.players[1].id === 'devX', 'seat tie-break is not the lower id');
ok(merge(base, claimY).players[1].id === 'devY', 'an empty seat was not filled');

/* ---- SYMMETRY, exhaustively over a pile of shapes ---- */
const shapes = [
  prov, real, short, long, base, claimX, claimY,
  game({ id: 'g2', moves: [play(0, 7, 7, 'Z')] }),
  game({ id: 'g0', moves: [play(0, 7, 7, 'Q')] }),
  game({ id: 'g2', moves: [] }),
  game({ moves: [play(0, 7, 7, 'H'), { t: 'pass', p: 1 }, { t: 'swap', p: 0, tiles: ['A', '?'] }] }),
  game({ moves: [{ t: 'resign', p: 1 }] }),
  game({ players: [null, P('devB', 'B')] }),
  game({ players: [null, null] }),
];
for (let i = 0; i < shapes.length; i++) {
  for (let j = 0; j < shapes.length; j++) {
    const ab = merge(shapes[i], shapes[j]);
    const ba = merge(shapes[j], shapes[i]);
    ok(canon(ab) === canon(ba), `asymmetric merge at ${i},${j}`);
    /* And a second round must be a no-op — the phones have settled. */
    ok(canon(merge(ab, ba)) === canon(ab), `did not settle at ${i},${j}`);
  }
}

print(`sync: ${checks - fails}/${checks} properties hold`);
for (const b of bad.slice(0, 10)) print('  ' + b);
if (fails) throw new Error(`${fails} sync property failures`);
