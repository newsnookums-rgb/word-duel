/* Reconciling two copies of the same game.
 *
 * Both phones hold { seed, moves }. The move list only ever grows and the game
 * is strictly turn-based, so the longer list always contains the shorter one
 * and "more moves wins" is safe. Every tie is broken by a rule that reads the
 * same on both sides, so the two phones always pick the SAME winner instead of
 * ping-ponging copies at each other forever.
 */

/* Anything arriving off a public broker is untrusted — a truncated message, a
 * cleared retained message, or a stray publish on the same topic must not be
 * able to wedge the game. */
function sane(g) {
  if (!g || typeof g !== 'object') return false;
  if (!Number.isFinite(g.seed) || !Array.isArray(g.moves)) return false;
  if (!Array.isArray(g.players) || g.players.length !== 2) return false;
  if (g.moves.length > 400) return false;
  return g.moves.every((m) => {
    if (!m || (m.p !== 0 && m.p !== 1)) return false;
    if (m.t === 'play') {
      return Array.isArray(m.tiles) && m.tiles.length > 0 && m.tiles.length <= 7
        && m.tiles.every((t) => Number.isInteger(t.r) && Number.isInteger(t.c)
          && t.r >= 0 && t.r < 15 && t.c >= 0 && t.c < 15
          && typeof t.letter === 'string' && /^[A-Z]$/.test(t.letter));
    }
    if (m.t === 'swap') {
      return Array.isArray(m.tiles) && m.tiles.length > 0 && m.tiles.length <= 7
        && m.tiles.every((c) => typeof c === 'string'
          && ENGINE.VALUES[c] !== undefined);
    }
    return m.t === 'pass' || m.t === 'resign';
  });
}

/* Key order survives a round trip through JSON, but only if both phones built
 * the object identically — so sort the keys before comparing move lists. */
function canonical(v) {
  return JSON.stringify(v, (k, val) =>
    (val && typeof val === 'object' && !Array.isArray(val))
      ? Object.fromEntries(Object.keys(val).sort().map((x) => [x, val[x]]))
      : val);
}

function merge(mine, theirs) {
  if (!sane(theirs)) return mine;
  if (!mine) return theirs;

  /* A joiner sits on an empty placeholder until the real game arrives. It must
   * always lose, or a blank board would overwrite a game in progress. */
  const mp = !!mine.provisional, tp = !!theirs.provisional;
  if (mp !== tp) return mp ? theirs : mine;

  /* Two different games in one room: whoever is further along is the real one,
   * and a dead heat falls back to the lower id so both sides agree. */
  if (mine.id !== theirs.id) {
    if (theirs.moves.length !== mine.moves.length) {
      return theirs.moves.length > mine.moves.length ? theirs : mine;
    }
    return theirs.id < mine.id ? theirs : mine;
  }

  /* Normally the longer log wins. But if the two logs are the SAME length and
   * disagree, the game has forked — both players moved at the same index after
   * a desync. Picking "mine" on each phone would leave them permanently split,
   * each overwriting the other's copy, so the tie is broken on the content
   * itself: both sides compute the same answer and one branch is dropped. */
  let winner;
  if (theirs.moves.length !== mine.moves.length) {
    winner = theirs.moves.length > mine.moves.length ? theirs : mine;
  } else {
    const a = canonical(mine.moves), b = canonical(theirs.moves);
    winner = (a <= b) ? mine : theirs;
  }
  const out = { ...winner };
  /* Seats are merged per slot, so two devices claiming the same empty seat at
   * the same moment settle on one of them rather than each keeping its own. */
  out.players = [0, 1].map((i) => {
    const a = mine.players[i], b = theirs.players[i];
    if (a && b) return a.id === b.id ? a : (a.id < b.id ? a : b);
    return a || b || null;
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { sane, merge };
if (typeof globalThis !== 'undefined') { globalThis.sane = sane; globalThis.merge = merge; }
