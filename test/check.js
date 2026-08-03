/* Cross-checks engine.js scoring against wwf.py, position by position.
 * Run with: jsc test/check.js -- cases.json */

load('./engine.js');

const path = arguments[0] || './test/cases.json';
const cases = JSON.parse(readFile(path));

const blankBoard = () =>
  Array.from({ length: 15 }, () => new Array(15).fill(null));

let pass = 0;
const fails = [];

for (let i = 0; i < cases.length; i++) {
  const tc = cases[i];
  const board = blankBoard();
  for (const t of tc.boardBefore) board[t.r][t.c] = { letter: t.letter, blank: t.blank };

  const isFirst = tc.boardBefore.length === 0;
  const shapeErr = ENGINE.checkShape(board, tc.placed, isFirst);

  for (const t of tc.placed) board[t.r][t.c] = { letter: t.letter, blank: t.blank };
  const got = ENGINE.scorePlacement(board, tc.placed);

  const gotWords = got.words.map((w) => w.word).sort();
  const wantWords = tc.words.slice().sort();

  const problems = [];
  if (shapeErr) problems.push(`checkShape rejected a legal move: ${shapeErr}`);
  if (got.total !== tc.score) problems.push(`score ${got.total} != ${tc.score}`);
  if (gotWords.join('|') !== wantWords.join('|')) {
    problems.push(`words [${gotWords}] != [${wantWords}]`);
  }
  if (got.bingo !== (tc.used === 7)) problems.push(`bingo flag wrong`);

  if (problems.length) {
    fails.push({ i, problems, placed: tc.placed, want: tc.score, got: got.total });
  } else {
    pass++;
  }
}

print(`scoring: ${pass}/${cases.length} positions match wwf.py`);
for (const f of fails.slice(0, 12)) {
  print(`  case ${f.i}: ${f.problems.join('; ')}`);
  print(`    placed ${JSON.stringify(f.placed)}`);
}
if (fails.length > 12) print(`  ...and ${fails.length - 12} more`);
if (fails.length) throw new Error(`${fails.length} scoring mismatches`);
