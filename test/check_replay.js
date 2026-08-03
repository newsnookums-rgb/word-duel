/* Replays the games wwf.py generated and checks engine.js agrees on every
 * move, the endgame adjustment, and that no tile is ever created or lost. */

load('./engine.js');

const games = JSON.parse(readFile(arguments[0] || './test/games.json'));
const dict = new Set(readFile('./dict.txt').split('\n').filter(Boolean));

let ok = 0;
const problems = [];
const note = (gi, msg) => problems.push(`game ${gi}: ${msg}`);

for (let gi = 0; gi < games.length; gi++) {
  const g = games[gi];
  const st = ENGINE.replay({ seed: g.seed, moves: g.moves }, dict);
  let bad = false;

  /* 1. Every move must score what wwf.py said it scored. */
  if (st.log.length !== g.expect.length) {
    note(gi, `replayed ${st.log.length} moves, expected ${g.expect.length}`); bad = true;
  }
  for (let i = 0; i < Math.min(st.log.length, g.expect.length); i++) {
    const got = st.log[i], want = g.expect[i];
    if (got.kind !== want.kind) { note(gi, `move ${i} kind ${got.kind}!=${want.kind}`); bad = true; }
    if (got.score !== want.score) {
      note(gi, `move ${i} (${want.kind}) scored ${got.score}, wwf.py said ${want.score}`);
      bad = true;
    }
    if (want.words) {
      const a = got.words.slice().sort().join('|'), b = want.words.slice().sort().join('|');
      if (a !== b) { note(gi, `move ${i} words [${a}] != [${b}]`); bad = true; }
    }
  }

  /* 2. Tiles are conserved: board + both racks + bag == 104, always. */
  let onBoard = 0;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) if (st.board[r][c]) onBoard++;
  const total = onBoard + st.racks[0].length + st.racks[1].length + st.bag.length;
  if (total !== 104) {
    note(gi, `tile leak: board ${onBoard} + racks ${st.racks[0].length}/${st.racks[1].length} + bag ${st.bag.length} = ${total}`);
    bad = true;
  }

  /* 3. Nobody holds a tile the distribution does not contain. */
  const pool = {};
  for (const [ch, n] of Object.entries(ENGINE.DISTRIBUTION)) pool[ch] = n;
  for (const side of st.racks) for (const ch of side) pool[ch]--;
  for (const ch of st.bag) pool[ch]--;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const t = st.board[r][c];
    if (t) pool[t.blank ? '?' : t.letter]--;
  }
  const wrong = Object.entries(pool).filter(([, n]) => n !== 0);
  if (wrong.length) { note(gi, `tile counts off: ${JSON.stringify(wrong)}`); bad = true; }

  /* 4. The endgame adjustment. */
  if (g.over && g.over.reason === 'out') {
    if (!st.over || st.over.reason !== 'out') {
      note(gi, `expected the game to end by going out, got ${JSON.stringify(st.over)}`); bad = true;
    } else {
      const w = g.over.by, l = 1 - w;
      const want = [0, 0];
      want[w] = g.rawScores[w] + g.over.swing;
      want[l] = g.rawScores[l] - g.over.swing;
      if (st.scores[0] !== want[0] || st.scores[1] !== want[1]) {
        note(gi, `final ${st.scores} != ${want} (raw ${g.rawScores}, swing ${g.over.swing})`);
        bad = true;
      }
    }
  } else if (!g.over) {
    if (st.scores[0] !== g.rawScores[0] || st.scores[1] !== g.rawScores[1]) {
      note(gi, `running score ${st.scores} != ${g.rawScores}`); bad = true;
    }
  }

  /* 5. Turn alternation — a player must never move twice in a row. */
  for (let i = 1; i < st.log.length; i++) {
    if (st.log[i].p === st.log[i - 1].p) { note(gi, `player moved twice at ${i}`); bad = true; }
  }

  if (!bad) ok++;
}

print(`replay: ${ok}/${games.length} full games match wwf.py end to end`);
for (const p of problems.slice(0, 15)) print('  ' + p);
if (problems.length > 15) print(`  ...and ${problems.length - 15} more`);
if (problems.length) throw new Error('replay mismatches');
