#!/usr/bin/env python3
"""Builds dict.txt, the word list the game validates against.

Base is ENABLE, which is what Words With Friends is built on. Three layers of
correction go on top, all of them earned from real games rather than guessed:

  EXTRA     short words WWF accepts that ENABLE predates (QI, ZA, OK, ...)
  ACCEPTED  words a real WWF board accepted that ENABLE lacks
  REJECTED  words in ENABLE that a real WWF board refused

ACCEPTED and REJECTED are read from the scrabble skill, which records them as
it plays, so this list improves every time a game turns one up.

    python3 build_dict.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.environ.get('WWF_DIR', os.path.expanduser('~/.claude/skills/scrabble'))
ENABLE = os.path.join(SKILL, 'enable1.txt')

EXTRA = """qi qis za zas ki kis ok po te gi ut sev bro coz dev grr yeah zen
newb selfie hashtag""".split()


def load_json(name):
    path = os.path.join(SKILL, name)
    if not os.path.exists(path):
        return set()
    with open(path) as fh:
        return {w.strip().upper() for w in json.load(fh)}


def main():
    words = set()
    with open(ENABLE, encoding='utf-8', errors='ignore') as fh:
        for line in fh:
            w = line.strip().lower()
            if w.isalpha() and 2 <= len(w) <= 15:
                words.add(w.upper())
    base = len(words)

    words |= {w.upper() for w in EXTRA}
    accepted = load_json('accepted.json')
    rejected = load_json('rejected.json')
    words |= accepted
    dropped = words & rejected
    words -= rejected

    out = sorted(words)
    with open(os.path.join(HERE, 'dict.txt'), 'w') as fh:
        fh.write('\n'.join(out))

    print(f'ENABLE base      {base}')
    print(f'+ WWF extras     {len(EXTRA)}  {" ".join(sorted(w.upper() for w in EXTRA))}')
    print(f'+ accepted       {len(accepted)}  {" ".join(sorted(accepted))}')
    print(f'- rejected       {len(dropped)}  {" ".join(sorted(dropped))}')
    print(f'= {len(out)} words, {sum(1 for w in out if len(w) == 2)} of them two letters')


if __name__ == '__main__':
    main()
