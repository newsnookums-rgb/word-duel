"""Play complete games with wwf.py, drawing from the SAME bag engine.js builds.

Emits the move log in engine.js's format plus, for every move, the score wwf.py
computed independently. check_replay.js then replays the log and must agree on
every one — which exercises the bag, the draw order, turn alternation, scoring
and the endgame in a single pass.
"""
import json
import os
import random
import sys

sys.path.insert(0, os.environ.get('WWF_DIR',
    os.path.expanduser('~/.claude/skills/scrabble')))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wwf                                   # noqa: E402
from prng import fresh_bag, shuffled, u32     # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
words = set(open(os.path.join(HERE, '..', 'dict.txt')).read().split())
root = wwf.build_trie(words)
VALUES = wwf.VALUES

games = []
n_games = int(sys.argv[1]) if len(sys.argv) > 1 else 10

for gi in range(n_games):
    seed = (gi * 2654435761 + 12345) % (2 ** 32)
    rnd = random.Random(gi)

    bag = fresh_bag(seed)          # engine.js pops from the END
    racks = [[], []]
    for who in (0, 1):             # engine.js fills player 0 then player 1
        while len(racks[who]) < 7 and bag:
            racks[who].append(bag.pop())

    grid, zeros = {}, set()
    scores = [0, 0]
    moves, expect = [], []
    turn = 0
    scoreless = 0
    over = None

    for _step in range(200):
        premium = wwf.premiums_of(grid)
        found = wwf.generate(grid, ''.join(racks[turn]), premium, words, root,
                             frozenset(zeros))
        found.sort(key=lambda m: -m['score'])

        # Mostly play; occasionally swap or pass so those paths get exercised.
        roll = rnd.random()
        if found and roll > 0.10:
            m = rnd.choice(found[:12])
            tiles = [{'r': r - 1, 'c': c - 1, 'letter': ch,
                      'blank': (r, c) in m['wilds']}
                     for (r, c), ch in sorted(m['placed'].items())]
            moves.append({'t': 'play', 'p': turn, 'tiles': tiles})
            expect.append({'kind': 'play', 'score': m['score'],
                           'words': sorted(m['words'])})
            scores[turn] += m['score']

            for (r, c), ch in m['placed'].items():
                grid[(r, c)] = ch
                if (r, c) in m['wilds']:
                    zeros.add((r, c))
                racks[turn].remove('?' if (r, c) in m['wilds'] else ch)
            while len(racks[turn]) < 7 and bag:
                racks[turn].append(bag.pop())
            # counted on the turn's score, matching engine.js
            scoreless = scoreless + 1 if m['score'] == 0 else 0

            if not racks[turn] and not bag:
                over = {'reason': 'out', 'by': turn,
                        'swing': sum(VALUES[c] for c in racks[1 - turn])}
                break
        elif bag and roll > 0.05:
            k = rnd.randint(1, min(len(racks[turn]), len(bag)))
            picked = rnd.sample(racks[turn], k)
            moves.append({'t': 'swap', 'p': turn, 'tiles': picked})
            expect.append({'kind': 'swap', 'score': 0})
            for ch in picked:
                racks[turn].remove(ch)
            while len(racks[turn]) < 7 and bag:
                racks[turn].append(bag.pop())
            bag.extend(picked)
            # engine.js reshuffles with (seed ^ (i+1)*0x9E3779B9) >>> 0
            bag = shuffled(bag, u32(seed ^ u32(len(moves) * 0x9E3779B9)))
            scoreless += 1
        else:
            moves.append({'t': 'pass', 'p': turn})
            expect.append({'kind': 'pass', 'score': 0})
            scoreless += 1

        # WWF: three successive scoreless turns, unless the score is 0-0.
        if scoreless >= 3 and not (scores[0] == 0 and scores[1] == 0):
            over = {'reason': 'stalled',
                    'left': [sum(VALUES[c] for c in racks[i]) for i in (0, 1)]}
            break
        turn = 1 - turn

    games.append({
        'seed': seed,
        'moves': moves,
        'expect': expect,
        'rawScores': scores,          # before any endgame adjustment
        'over': over,
        'finalRacks': [sorted(racks[0]), sorted(racks[1])],
        'bagLeft': len(bag),
    })

print(json.dumps(games))
sys.stderr.write(f'{len(games)} games, '
                 f'{sum(len(g["moves"]) for g in games)} moves\n')
