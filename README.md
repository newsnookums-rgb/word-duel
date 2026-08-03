# Word Duel

A two-player Words With Friends game that runs in the browser, live, between
any two phones — one on iPhone, one on Android, no app store involved.

Open the link, tap **Start a new game**, send the invite link to the other
player. Moves appear on both phones within a second. Add it to your home
screen and it behaves like a normal app.

## Rules

Words With Friends, not Scrabble. The two differ in ways that change every
score, so this follows WWF throughout:

| | Words With Friends | Scrabble |
|---|---|---|
| Tiles | 104 | 100 |
| Bingo bonus | **35** | 50 |
| Centre square | plain start square | double word |
| Premium squares | 8 TW · 12 DW · 16 TL · 24 DL | different layout |
| Letter values | e.g. B=4, D=2, G=3 | B=3, D=2, G=2 |

The board layout, letter values and tile counts are taken verbatim from a
Words With Friends engine that had already been validated square by square
against real games. The dictionary is ENABLE (168,567 words), which is what
WWF is built on, plus the short words it accepts that ENABLE predates
(`QI`, `ZA`, `KI`, `OK`, `TE`, `GI`, …).

## How the live sync works

There is no server. The whole game is a **random seed plus an ordered list of
moves**, and both phones replay that list to reach the same board. Because the
state is derived rather than transmitted, a sync is just the move list — a few
kilobytes — and it can never be half-applied.

The two phones meet on a public MQTT broker at a topic derived from the room
code, and publish the game there as a *retained* message. The broker holds the
last one, so whoever opens the room next is handed the current game
immediately, even if the other phone is switched off. HiveMQ is primary and
EMQX is the fallback; both were tested for retained-message replay.

Every publish carries the whole game rather than a delta, which is what makes
a dropped message harmless — the next one re-states everything.

## Honest limitations

- **Not cheat-proof.** With no server, both phones must be able to compute the
  bag, so a determined player could read the opponent's rack out of browser
  dev tools. Fine between friends; not fine for strangers or money.
- **The room code is the only secret.** Anyone who knew it could watch the
  game on a public broker. Codes are random 6-character strings.
- **The public brokers are free and unpaid-for**, so they carry no uptime
  guarantee. If both are unreachable the game keeps working offline on each
  phone and resyncs when the connection returns.

## Tests

The rules engine is cross-checked against `wwf.py`, an independent
implementation, using JavaScriptCore as the runtime:

```sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

# scoring: every word, cross-word, blank and bingo on real positions
python3 test/gen_cases.py 80 > test/cases.json
$JSC test/check.js -- test/cases.json

# whole games: bag, draw order, turns, endgame, tile conservation
python3 test/gen_game.py 120 > test/games.json
$JSC test/check_replay.js -- test/games.json
```

Current status: **2,517/2,517 positions** and **120/120 complete games
(4,077 moves)** agree move for move. The PRNG is separately confirmed
bit-identical between the JavaScript and Python implementations, so the two
phones always deal the same racks.

`test/gen_*.py` need the reference engine; point `WWF_DIR` at it if it is not
in the default location.
