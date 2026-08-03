"""Play random games with the validated wwf.py engine and dump every position
it scored, so engine.js can be checked against it move for move."""
import json
import os
import random
import sys

sys.path.insert(0, os.environ.get('WWF_DIR',
    os.path.expanduser('~/.claude/skills/scrabble')))
import wwf  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DICT = os.path.join(HERE, '..', 'dict.txt')

words = set(open(DICT).read().split())
root = wwf.build_trie(words)

cases = []
for game_seed in range(int(sys.argv[1]) if len(sys.argv) > 1 else 12):
    random.seed(game_seed)
    bag = []
    for ch, n in wwf.DISTRIBUTION.items():
        bag += [ch] * n
    random.shuffle(bag)

    grid, zeros = {}, set()
    rack = [bag.pop() for _ in range(7)]

    for _turn in range(60):
        premium = wwf.premiums_of(grid)
        moves = wwf.generate(grid, ''.join(rack), premium, words, root,
                             frozenset(zeros))
        if not moves:
            break
        moves.sort(key=lambda m: -m['score'])
        # Spread across the score range so the tests are not all big plays.
        m = random.choice(moves[:25])

        cases.append({
            'boardBefore': [
                {'r': r - 1, 'c': c - 1, 'letter': ch, 'blank': (r, c) in zeros}
                for (r, c), ch in sorted(grid.items())
            ],
            'placed': [
                {'r': r - 1, 'c': c - 1, 'letter': ch,
                 'blank': (r, c) in m['wilds']}
                for (r, c), ch in sorted(m['placed'].items())
            ],
            'score': m['score'],
            'words': sorted(m['words']),
            'used': m['used'],
        })

        for (r, c), ch in m['placed'].items():
            grid[(r, c)] = ch
            if (r, c) in m['wilds']:
                zeros.add((r, c))
            rack.remove('?' if (r, c) in m['wilds'] else ch)
        while len(rack) < 7 and bag:
            rack.append(bag.pop())

print(json.dumps(cases))
sys.stderr.write(f'{len(cases)} cases\n')
