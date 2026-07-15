# Scroll Wizard Implementation Plan — Canonical Index

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before declaring a phase complete.

**Goal:** Implement the reviewed Scroll Wizard design as deterministic Node.js CLIs, a generated browser runtime, a validation suite, and a reusable Codex skill.

**Architecture:** Node.js ESM CLIs own project state, approval receipts, frame extraction, and transactional site generation. Pure scrub math and configuration validation are shared with a Lenis-enhanced browser runtime. Vitest covers pure and filesystem behavior; Playwright verifies the generated site; FFmpeg performs exact-count extraction.

**Tech Stack:** Node.js 20+ ESM, Vitest 4.1.10, Playwright Test 1.61.1, Lenis 1.3.25, FFmpeg/ffprobe, browser JavaScript, HTML/CSS.

---

This is the authoritative plan index. It supersedes the earlier `plan-index` and `implementation-plan` index drafts if either differs. The four task documents below remain authoritative for task details.

## Final review verdict

The revised design is ready for implementation. The final pass found no architectural blocker. Lock these clarifications into the build:

1. Hash the normalized frame inventory plus only hold ranges and `posterIndex` for the extraction receipt; theme and unrelated copy changes do not own that gate.
2. Normalize extraction manifest paths to `frames/<relative-path>` whether files currently live under `project/frames/` or `site/frames/`.
3. Hash every regular file recursively under `site/` for preview approval.
4. In reduced motion, permit the selected poster request and forbid every other sequence-frame request.
5. Set poster alt text from `brand.imageAlt`, then `brand.tagline`, then `<brand.name> hero scene`.
6. During a theme-only rebuild, copy live frames and fonts into staging; do not rename data out of the live site before commit.
7. Every light and hard gate requires explicit user approval; hard gates also require a current receipt before continuing.
8. Treat the poster `<img>` as an LCP candidate, not a guaranteed LCP selection.

## Execution order

1. [Foundation and pure scrub core](./2026-07-15-scroll-wizard.md) — Tasks 1–2
2. [CLI, extraction, receipts, and transactional scaffold](./2026-07-15-scroll-wizard-cli-pipeline.md) — Tasks 3–6
3. [Browser runtime and end-to-end verification](./2026-07-15-scroll-wizard-browser-runtime.md) — Tasks 7–10
4. [Skill behavior tests and package documentation](./2026-07-15-scroll-wizard-skill-and-docs.md) — Tasks 11–12

## Authoritative end-to-end sequence

1. Initialize the project and persist the brief and visual-reference choices.
2. Obtain explicit approval for the brief, optional keyframes, and selected video as applicable.
3. Validate the video, calculate the frame plan, extract into `project/frames/`, and verify the normalized manifest.
4. Persist holds and `posterIndex`, then approve extraction.
5. Derive, persist, and approve theme tokens.
6. Transactionally scaffold, preserving the extraction hash as frames move to `site/frames/`.
7. Run browser smoke checks, obtain preview approval over the complete site inventory, and report deploy instructions.

This order overrides the abbreviated suite-wrapper ordering in Task 10: brief, video, extraction, and theme approvals precede the first scaffold; preview approval follows browser verification.

## Cross-phase dependencies

| Consumer | Required producer |
| --- | --- |
| Extraction and status | CLI helpers, media validation, canonical hashing, frame plan |
| Scaffold transaction | Creative values, normalized frame inventory, shared config validator |
| Browser runtime | Shared scrub math, generated config, static template |
| Browser smoke suite | Runtime observability, poster fallback, reduced-motion branch |
| Integration suite | All CLIs, FFmpeg adapter, receipts, scaffold, smoke suite |
| `SKILL.md` | Verified commands, gate behavior, recovery rules, behavior-test findings |

## Final automated verification

Run from the repository root:

~~~powershell
npm ci
node --check scripts/validate-media.mjs
node --check scripts/extract-frames.mjs
node --check scripts/status.mjs
node --check scripts/scaffold-site.mjs
node --check template/scrub-core.js
node --check template/scrub-engine.js
npm test
npm run test:browser
python C:\Users\ryanl\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
npm pack --dry-run --json
git diff --check
git status --short
~~~

The implementation report must give the exact result of each command, identify any allowed FFmpeg/ffprobe or Chromium skip, summarize the manual example-site check from Task 12, and explain every remaining worktree change.

## Self-review result

- All 12 tasks map the design outputs to concrete paths and commands.
- Behavior changes use an explicit RED–GREEN test sequence.
- Receipt ownership, normalized frame paths, transactional replacement, reduced motion, and poster accessibility are covered by regression tests.
- Cross-phase ordering is explicit above; detailed Task 10 snippets are assembled in that order during implementation.
- Each task ends with a focused commit checkpoint.
