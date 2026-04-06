# Math.random Audit

**Date:** 2026-04-06
**Plan:** Phase 01 Plan 01 (foundation), Task 2
**Purpose:** catalog every `Math.random` call in `engine/ptcg-server/src/` so we can either route it through `SeededRNG` or document it as a known non-reproducible site. Per design decision DD2 + DD-leak-policy of plan 01-01.

**Search command:**
```bash
grep -rn "Math.random" engine/ptcg-server/src --include="*.ts" | grep -v __tests__ | grep -v spec.ts
```

## All hits

| # | File:line | Context | Verdict |
|---|-----------|---------|---------|
| 1 | `src/game/core/arbiter.ts:28` | `Math.round(Math.random()) === 0` — base `Arbiter.resolvePrompt` coin flip | **Overridden by SeededArbiter.** SeededArbiter.resolvePrompt fully replaces this method. Verified in `src/ai/seeded-arbiter.ts`. |
| 2 | `src/game/core/arbiter.ts:46` | `Math.min(len-1, Math.round(Math.random() * len))` — base `Arbiter.shuffle()` | **Overridden by SeededArbiter.** SeededArbiter never calls the base `shuffle`; its own `seededShuffle` is invoked from the overridden `resolvePrompt`. The base method is dead code under SeededArbiter. (Bonus: the base shuffle is also algorithmically buggy — biased Fisher-Yates with possible duplicates. We don't fix it because we don't use it.) |
| 3 | `src/game/bots/bot-arbiter.ts:68` | `BotArbiter` coin flip — `Math.round(Math.random()) === 0` | **Out of scope for Env.** `BotArbiter` is the original engine bot infrastructure, not used by AI Env. AI Env uses `SeededArbiter`. No action needed for Phase 1. |
| 4 | `src/game/bots/bot-arbiter.ts:90` | `BotArbiter` shuffle — same biased shuffle as base | **Out of scope.** Same reason as #3. |
| 5 | `src/game/bots/bot-games-task.ts:39` | `Math.round(Math.random() * (allBots.length - 1))` — picks a random bot for matchmaking | **Out of scope.** Bot matchmaking is unrelated to AI Env. |
| 6 | `src/game/bots/bot-client.ts:68` | `Math.round(Math.random() * (decks.length - 1))` — picks a random deck for a bot client | **Out of scope.** Same reason as #5. |
| 7 | `src/backend/controllers/avatars.ts:292` | `Math.round(10000 * Math.random())` — random avatar suffix | **Out of scope.** Backend HTTP controller, never reached by Env. |
| 8 | `src/backend/controllers/reset-password.ts:107` | `Math.round(10000 * Math.random())` — password reset token | **Out of scope.** Auth flow, never reached by Env. |
| 9 | `src/sets/set-scarlet-and-violet/TWM Fezandipiti.ts:10` | `const result = Math.random() < 0.5;` — Fezandipiti card-internal coin flip | **REACHABLE FROM DRAGAPULT DECK** but card name is `TWM Fezandipiti`, NOT `SFA Fezandipiti ex` (which is the one in the Dragapult list). This file appears to be a different `Fezandipiti` (TWM = Twilight Masquerade vs SFA = Shrouded Fable). Need to verify in Plan 01-03 whether `TWM Fezandipiti` is referenced anywhere and whether it can fire during Dragapult mirror play. Flagged for **01-03 follow-up**. |

## Summary

- **Hits routed via SeededArbiter override:** 2 (`arbiter.ts:28`, `arbiter.ts:46`).
- **Hits in unused infrastructure (`game/bots/`, `backend/controllers/`):** 6.
- **Hits in card files reachable from Dragapult deck:** 1, possibly 0 — `TWM Fezandipiti.ts:10`. The Dragapult deck list uses `Fezandipiti ex SFA`, which is a different file. **Flag for 01-03 verification.**

## Action items

- **Plan 01-01 (this plan):** No card patches needed. Audit committed alongside debug-gate. Done.
- **Plan 01-03 (L2/L3 card validation):**
  - Confirm `Fezandipiti ex SFA` (the card actually in the Dragapult deck) does NOT use `Math.random` directly.
  - If `TWM Fezandipiti.ts` is reachable through any indirect path (e.g., an ability that triggers it), patch it to route through a `CoinFlipPrompt` so `SeededArbiter` handles it.
  - Otherwise, document in `KNOWN_CARD_BUGS.md` that the card is non-reproducible across coin flips and exclude from any deck used in self-play.
- **Plan 01-06 (final validation):** Re-run the grep and confirm no new card files have introduced `Math.random` since 01-01.

## Notes

- The base `Arbiter.shuffle()` is technically dead code under `SeededArbiter`, but it lives in `src/game/core/`. We do NOT modify it because Phase 1 explicitly avoids touching `src/game/` outside the two debug-gate exceptions in `store.ts` and `play-card-reducer.ts`. The override pattern is sufficient.
- `BotArbiter`, `bot-games-task.ts`, `bot-client.ts` are remnants of the original sandbox bot infrastructure. They are not imported by anything the AI Env uses. They could be deleted in a future cleanup phase, but that's out of scope here.
