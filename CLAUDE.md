# Potato Pete

A 2D side-view browser game. Pete, an orange cat, sits at the bottom center of the screen and jumps with the spacebar (or a click/tap on the canvas) to catch potatoes that fly across from either side. A quick tap is a small hop; holding longer jumps higher, with every height in between. Eating a potato scores 100 and restores 1 health; missing one costs 1. About one in twelve potatoes is golden (glows gold) and scores 300. About one in ten is bad (glows red): eating it costs 5 health and paralyzes Pete for a moment, so he usually misses the next one or two. After 30 seconds, extra potatoes start coming that Pete can't all catch. The game ends when health (10 units) runs out, and a top-ten score asks for three initials.

## Stack
Plain HTML5 Canvas + vanilla JavaScript. No build step, no dependencies. Open `index.html` in a browser to run it. The goal is to publish it online later as a static site (itch.io, GitHub Pages, Netlify).

## Files
- `index.html`: page shell, canvas, and the intro, high score, and end panels
- `style.css`: page, canvas, and panel styling
- `game.js`: all game code (input, jumping, potatoes, health, scores, drawing, loop)

## How it works
- Canvas is 960x640. Pete's feet rest at `GROUND_Y`; he only moves vertically, at `PETE_X`.
- Jumping: a press sets `jumpBuffer`, so a press just before landing still jumps. Takeoff speed is `JUMP_SPEED`. While the spacebar stays held (up to `HOLD_MAX` seconds, and only while rising), gravity is `HOLD_GRAVITY` instead of `GRAVITY`, so height grows smoothly with hold time: about 87px for a tap, about 320px for a full hold. Letting go ends the hold for that jump.
- Potatoes: `planPotato` schedules each potato's `arrival` time at Pete, its height, side, speed, and whether it's bad, about `PLAN_AHEAD` seconds in advance; `spawnPotatoes` puts it on screen just off the edge so it reaches Pete exactly then. The gap between arrivals is what a perfect jump needs (`fallTime` from the last potato's height plus `riseTime` to the new one) plus slack, so every potato is catchable. Slack shrinks and speed rises from the `_START` to the `_END` constants over `RAMP_TIME`, then speed keeps climbing by `LATE_SPEEDUP` so no run lasts forever. After `OVERLOAD_START`, each potato may bring an extra one arriving `EXTRA_GAP` seconds later, too close to catch both; the chance grows to `EXTRA_CHANCE_MAX` over `OVERLOAD_RAMP`. Extras don't become `lastPlanned`, so the regular potatoes stay catchable if Pete lets the extras go.
- Kinds: each potato's `kind` is `good`, `bad` or `golden` (`pickKind`, using `BAD_CHANCE` and `GOLDEN_CHANCE`), and `POTATO_LOOK` holds each kind's colors and glow. Golden ones score `GOLDEN_POINTS` and otherwise act like good ones. The first three are always good, and bad ones never come twice in a row.
- Eating: a potato whose center comes within `CATCH_RADIUS` of the mouth (`MOUTH_OFFSET` above the feet) is eaten, unless Pete is paralyzed. A potato `PASS_DISTANCE` past Pete is marked `missed` and fades; only good ones cost health.
- Health: `changeHealth` clamps to 0..`MAX_HEALTH`. At 0, `dying` freezes spawning for `GAME_OVER_DELAY`, then `endRun` shows the end panel.
- Runs and high scores: `newRun` (Start, Play Again, or R on the end panel) resets everything. `endRun` asks for three capital letters if `makesList` says the score ranks, then shows the list. A score of 0 isn't saved, and a new score must beat a tie to pass it. The top `MAX_SCORES` are kept in `localStorage`; only `loadScores` and `saveScores` touch storage, so those are what to replace when scores move online.
- Balance: with the current constants, simulated bots that never misjudge timing last a median of about 6½ minutes, bots with ~50ms of timing error about 2½, ~100ms about 80 seconds, and ~150ms about 50 seconds. Health works like a tug-of-war (+1 per catch, -1 per miss), so anyone catching more than half survives until the speedup and the extra potatoes tip the balance. Bots overstate what a person can do.

## Art plan
Everything is drawn with canvas shapes for now. Each element has its own function (`drawPete`, `drawPotato`, `drawCloud`, `drawHUD`, ...), and static scenery is painted once into `skyLayer` and `sceneryLayer`. The plan is to replace these with pixel-art sprites without changing the physics. When that happens, add an `assets/` folder and a small image loader.

## Conventions
- Keep game logic and drawing separate.
- Keep the project dependency-free unless there's a clear reason.
