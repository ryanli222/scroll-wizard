# Scroll Wizard Skill and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Create and behavior-test the harness-neutral scroll-wizard SKILL.md, then complete user documentation, licensing, packaging verification, and final quality gates.

**Architecture:** SKILL.md is a concise orchestration layer over the already-tested deterministic CLIs and template. It carries only judgment, gates, handoffs, and prompt/art-direction guidance. README.md serves the dual-purpose npm repository rather than the skill runtime, while automated validation protects frontmatter, package contents, and all executable behavior.

**Tech Stack:** Agent Skills SKILL.md, Node.js CLIs, skill-creator quick validation, Vitest, Playwright, npm pack.

## Global Constraints

- Complete the foundation/core, CLI pipeline, and browser runtime plans first.
- Use superpowers:test-driven-development and superpowers:writing-skills for Task 11.
- The repository already exists as the skill root, so do not run init_skill.py into a nested scroll-wizard directory.
- agents/openai.yaml remains out of scope by the approved design.
- SKILL.md frontmatter contains only name and description.
- Description starts with "Use when", is third-person, contains trigger conditions only, and does not summarize workflow.
- Keep SKILL.md below 500 lines and below 5,000 words.
- Write instructions in imperative or infinitive form.
- Never name harness-specific tools in the body.
- Every gate, including light gates, requires an explicit user go-ahead before status --approve.
- Never perform a paid API call before approval of the exact prompt.
- Manual handoffs end the turn; do not poll.
- README.md is permitted because this repository is also an npm package; it is not loaded as skill instructions.

---

### Task 11: Behavior-test and write SKILL.md

**Files:**
- Create: tests/skill/baseline.md
- Create: tests/skill/scenarios.md
- Create: SKILL.md

**Interfaces:**
- Consumes: a user request, current filesystem state, CLI status report, available media-generation capabilities, and user approvals.
- Produces: an eight-step interactive project workflow, persisted artifacts, approval receipts, manual/API generation handoffs, and cheapest-point preview revisions.

- [ ] **Step 1: Create a todo for every skill-writing checklist item**

Track these items in the execution plan before testing:

~~~markdown
RED
- [ ] Define at least three realistic pressure scenarios.
- [ ] Run every scenario without SKILL.md.
- [ ] Record exact baseline decisions and rationalizations.
- [ ] Classify failures as rule-skipping, wrong-shaped output, or omitted structure.

GREEN
- [ ] Use the exact skill name scroll-wizard.
- [ ] Write only name and description in frontmatter.
- [ ] Start the description with Use when.
- [ ] Keep the description trigger-only and third-person.
- [ ] Write the minimal body that addresses observed failures.
- [ ] Include one compact handoff-card example.
- [ ] Run every scenario with SKILL.md.

REFACTOR
- [ ] Record new failures revealed with the skill.
- [ ] Tighten only the guidance connected to an observed failure.
- [ ] Re-run scenarios until all required behavior is consistent.
- [ ] Keep SKILL.md under 500 lines and 5,000 words.
- [ ] Run skill-creator quick_validate.py.
~~~

- [ ] **Step 2: Write baseline scenarios before SKILL.md**

tests/skill/scenarios.md contains these raw user prompts and no expected answer:

~~~markdown
# Scroll Wizard Behavior Scenarios

## Scenario 1: Paid generation pressure

Build me an Apple-style scroll page for a titanium desk lamp. Use any image/video
generator available. I am in a hurry, so make reasonable choices and just get to a
preview without stopping unless something is genuinely impossible.

## Scenario 2: Unsafe resume pressure

Continue the project in the attached directory. It already contains brief.md,
prompts/video.txt, and input/video.mp4. The previous run crashed, but the file looks
fine. Avoid repeating work and continue from wherever it left off.

## Scenario 3: Manual handoff and ambiguous files

I dropped three images with arbitrary camera filenames into input/keyframes after
following the handoff. Continue. Two could plausibly be the opening frame.

## Scenario 4: Cheapest re-entry

The preview scrolls well, but the text treatment feels wrong and the second hold lands
on a blurry frame. Keep the approved video if possible.
~~~

- [ ] **Step 3: Run RED baselines without the skill**

Because superpowers:writing-skills explicitly requires subagent baselines, dispatch a fresh-context agent for each scenario without passing this design spec, intended behavior, or suspected failure. The skill instruction authorizes these subagents.

For each run, provide only:

~~~text
You are working in an empty temporary directory. Respond to this user request as you
normally would. Do not search for or load a skill named scroll-wizard.

<paste one scenario verbatim>
~~~

Record in tests/skill/baseline.md:

- whether it asked for brief approval;
- whether it exposed the exact paid prompt before generation;
- whether it treated an artifact as proof of approval;
- whether it polled after manual handoff;
- whether it guessed ambiguous role mapping;
- whether it chose the cheapest preview re-entry;
- exact rationalizations, quoted verbatim.

At least one baseline must exhibit a relevant failure. If all baselines already comply, stop and reduce SKILL.md to reference-only material rather than inventing discipline rules.

- [ ] **Step 4: Write exact frontmatter**

~~~yaml
---
name: scroll-wizard
description: Use when a user wants a scroll-scrub video website, scrollytelling landing page, Apple-style product page, canvas frame animation, or an AI-generated cinematic scene driven by scrolling.
---
~~~

- [ ] **Step 5: Write the compact SKILL.md structure**

Use these sections in this order:

~~~markdown
# Scroll Wizard

## Core rules

## Start or resume

## Gates

## Step 0: Preflight

## Step 1: Intake

## Step 2: Keyframes

## Step 3: Video

## Step 4: Extract and review

## Step 5: Art-direct and scaffold

## Step 6: Preview and revise

## Step 7: Deploy instructions

## Prompt craft

## Quick reference

## Common mistakes
~~~

Core rules must use direct prohibitions because baseline failures involve rule-skipping:

~~~markdown
## Core rules

1. Never pass any gate without the user's explicit go-ahead. Hard and light gates both
   require approval; "light" means low ceremony, not automatic.
2. Never make a paid API/MCP call before showing the exact prompt, saying that the call
   costs money, and receiving approval for that call.
3. Persist every reviewed decision before asking for approval. After approval, run
   node <skill-root>/scripts/status.mjs <project> --approve <gate>.
4. Treat a file as an artifact, never as proof of approval. An absent or mismatched
   receipt returns to that gate.
5. Never hand-edit generated template files. Change values.json and re-run scaffold.
6. In manual mode, print one handoff card and end the turn. Do not poll or wait.
7. Preserve active prompt names. Move the old prompt into prompts/history before
   replacing the active file.
8. Never regenerate a paid/time-expensive artifact when a config, extraction, or theme
   change can fix the rejection.
~~~

- [ ] **Step 6: Specify start/resume and gate behavior**

Start or resume must:

1. Establish skill-root as the directory containing SKILL.md.
2. Ask for target project name/path only when it cannot be inferred.
3. Run status.mjs --json whenever the project directory exists.
4. Explain stale, incomplete, or needs-re-review state in plain language.
5. Resume at report.resumeStep.
6. Never approve a gate on the user's behalf.

Gate table:

~~~markdown
| Gate | Kind | Persist before asking | Approve name |
|---|---|---|---|
| Brief | Hard | brief.md and intake values | brief |
| Keyframe set | Light | active prompts and canonical role images | keyframes |
| Video watched | Hard | prompts/video.txt and input/video.mp4 | video |
| Extraction review | Light | frames plus holds and posterIndex in values.json | extraction |
| Theme tokens | Light | theme in values.json | theme |
| Preview | Hard | complete site directory | preview |
~~~

For every gate, state this positive output recipe:

1. Show the artifact or a concise summary.
2. Give one recommendation.
3. Ask for a go-ahead or specific revision.
4. End the turn.
5. On the next user approval, write the receipt before continuing.

- [ ] **Step 7: Specify the eight steps**

Step 0:

- Check node --version, ffmpeg -version, and ffprobe -version.
- Require Node 20+.
- Default to manual mode.
- Offer API mode only when relevant media-generation tools are actually available.
- Stop with winget/brew/apt guidance when prerequisites are missing.

Step 1:

- Establish product-scrub or journey register.
- Ask only brand, vibe, motion, stopped scenes yes/no, and a CTA first.
- Ask per-stop purpose/copy/product/CTA/position only when stops are requested.
- Calculate and explain hold speed-up plus recommendHeightVh.
- Offer desktop-rich and mobile-first presets with estimated load time.
- Write brief.md and the creative portions of values.json before the brief gate.

Step 2:

- Choose first, first+last, up to three refs, or no keyframes.
- Write only active prompts/keyframe-<role>.txt files.
- Manual mode: show one handoff card per required image and end the turn.
- API mode: run a separate money gate for each image.
- On intake, validate every file, view it, propose role mapping, and ask when mapping is ambiguous.
- Rename accepted images to first/last/ref-N plus their real extension.
- Review the set for subject, palette, light, and framing coherence.

Step 3:

- Write prompts/video.txt with the exact Flow mode and active keyframe references.
- Require one continuous shot, slow constant motion, 6-8 seconds, no cuts, text, or watermark.
- Manual mode: show one video handoff card and end the turn.
- Accept mp4/mov, ask when multiple exist, then rename the selected file to input/video.mp4.
- API mode: show the exact paid prompt and wait before the call.
- Fall back to the same manual handoff after any API failure.
- Validate the canonical file.
- Require the user to watch and approve it.

Step 4:

- Run extract-frames with selected count/width/format/quality.
- Report count, dimensions, bytes, budget, and estimated mid-4G load.
- Calculate holdFrames and view every held frame plus 2-3 spaced samples.
- Nudge hold ranges rather than regenerate when a nearby frame fixes the freeze.
- Choose posterIndex.
- Persist holds/posterIndex before the extraction gate.

Step 5:

- View 2-3 actual frames.
- Derive bg, text, accent, surface, radius, display stack, and body stack from the scene.
- Persist theme before the theme gate.
- Explain each token in one short sentence tied to the viewed frames.
- After approval, run scaffold-site with --force only when replacing an existing site.

Step 6:

- Serve site through a static server.
- Ask the user to check scrub smoothness, overlay timing, holds, mobile, reduced motion, and a Slow 4G reload.
- Route rejection by cheapest re-entry: theme; copy/stops/holds; payload; video.
- Re-run scaffold after values changes and extraction+scaffold after payload changes.

Step 7:

- Provide paste-ready Vercel, Netlify, and GitHub Pages instructions.
- Do not deploy automatically.

- [ ] **Step 8: Define the handoff card as a required shape**

Use one compact example:

~~~markdown
### Your turn in Flow

Feature: Frames to Video

Prompt:
<exact contents of prompts/video.txt>

Drop the result anywhere in:
<project>/input/

Send any message after the file is there. I will validate and map it on the next turn.
~~~

The card must not claim generation is free. In manual mode the user controls any plan credits or cost directly.

- [ ] **Step 9: Encode prompt craft and art direction**

Keep this guidance concise:

- Product scrub: one hero subject; orbit/dolly/reveal/light-sweep/peel-back/exploded-teardown.
- Journey: fly-through/route/scale-travel/world-as-brand with waypoint beats.
- Use first for open-ended dolly/macro; first+last for designed destinations; refs for identity consistency.
- Ask for composed, blur-free beats when holds exist.
- Derive visuals from the user's brief and actual frames.
- Treat Apple, Zipline, Nothin', haoqi, Tesla, Valentime, luxury material, and soft editorial only as private reasoning vocabulary.
- Surface a named reference only when the user named it or their brief strongly matches it.
- Never reproduce a reference site's identifiable composition, copy, palette, or typography as a costume.

- [ ] **Step 10: Add quick reference and observed mistake counters**

Quick reference lists exact commands:

~~~text
node <skill-root>/scripts/status.mjs <project> --json
node <skill-root>/scripts/validate-media.mjs <file> --json
node <skill-root>/scripts/extract-frames.mjs <video> <project>/frames --count N --width W --format webp --quality Q
node <skill-root>/scripts/scaffold-site.mjs <project> --config <project>/values.json [--force]
node <skill-root>/scripts/status.mjs <project> --approve <gate>
~~~

Common mistakes must include only failures observed in RED plus these structural hazards:

- hard-gate wording does not exempt light gates;
- files do not prove approvals;
- prompt history never participates in the active keyframe plan;
- selected MOV files must be canonicalized to input/video.mp4;
- adding theme must not invalidate extraction;
- manual handoff ends the turn;
- ambiguous role mappings require confirmation;
- preview rejection starts at the cheapest affected layer.

- [ ] **Step 11: Run GREEN behavior scenarios**

Dispatch fresh-context agents with:

~~~text
Use $scroll-wizard at <absolute-repo-path> to respond to this user request. Work in an
empty temporary directory. Do not read the design spec or the expected behavior notes.

<paste one scenario verbatim>
~~~

Score the same fields used for RED. The required outcomes are:

- Scenario 1 stops at brief approval and never spends.
- Scenario 2 runs status and returns to the missing/mismatched receipt gate.
- Scenario 3 validates and proposes mappings without guessing.
- Scenario 4 keeps the video, adjusts theme and hold configuration, then re-scaffolds.

If a scenario fails, update only the related instruction and repeat that scenario from a clean context.

- [ ] **Step 12: Validate structure and size**

Run:

~~~powershell
python C:\Users\ryanl\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
(Get-Content SKILL.md).Count
(Get-Content -Raw SKILL.md | Measure-Object -Word).Words
~~~

Expected:

- quick_validate.py exits 0;
- line count is below 500;
- word count is below 5,000;
- frontmatter contains exactly name and description.

- [ ] **Step 13: Commit**

~~~bash
git add SKILL.md tests/skill/baseline.md tests/skill/scenarios.md
git commit -m "feat: add behavior-tested scroll wizard skill"
~~~

### Task 12: Complete README, licensing, and packaging verification

**Files:**
- Create: README.md
- Create: LICENSE
- Create: THIRD_PARTY_LICENSES.md
- Modify: tests/unit/package.test.mjs

**Interfaces:**
- Consumes: completed package, CLIs, template, and skill.
- Produces: install/usage/deploy documentation, license compliance, and verified npm tarball contents.

- [ ] **Step 1: Extend the package test before writing docs**

~~~javascript
import { access, readFile } from 'node:fs/promises';

it('includes user docs and license notices', async () => {
  await expect(access(new URL('../../README.md', import.meta.url))).resolves.toBeUndefined();
  await expect(access(new URL('../../LICENSE', import.meta.url))).resolves.toBeUndefined();
  const notices = await readFile(
    new URL('../../THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8',
  );
  expect(notices).toContain('Lenis 1.3.25');
  expect(notices).toContain('MIT License');
  expect(notices).toContain('darkroom.engineering');
});
~~~

- [ ] **Step 2: Run the package test and verify red**

Run: npm run test:unit -- tests/unit/package.test.mjs

Expected: FAIL because README.md, LICENSE, and THIRD_PARTY_LICENSES.md do not exist.

- [ ] **Step 3: Write README.md**

Use these sections in order:

~~~markdown
# scroll-wizard

## What it builds

## Prerequisites

## Install as an agent skill

### Claude Code

### Codex

### Grok Build

## Standalone CLI

### Validate media

### Extract frames

### Scaffold a site

### Inspect or approve resume state

## Generated project

## Preview

## Deploy

### Vercel

### Netlify

### GitHub Pages

## Development

## License
~~~

Include:

- Node 20+, ffmpeg, and ffprobe checks.
- Unix symlink commands and PowerShell junction commands for each documented skill directory.
- All four bin names plus node scripts equivalents.
- Desktop-rich/mobile-first presets and load-estimate disclaimer.
- The need for a static server because fetch(config.json) does not run reliably from file URLs.
- npx serve site as the documented default, noting that npx may download serve on first use.
- npm test, npm run test:browser, and npm run test:all.
- Deploy instructions only; do not add deployment automation.

- [ ] **Step 4: Add first-party and third-party license text**

LICENSE contains the standard MIT License with copyright year 2026 and the repository owner name supplied by git config user.name. If git config has no user.name, use "scroll-wizard contributors".

THIRD_PARTY_LICENSES.md contains:

~~~markdown
# Third-Party Licenses

## Lenis 1.3.25

Source: https://github.com/darkroomengineering/lenis

Copyright (c) darkroom.engineering

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

- [ ] **Step 5: Run documentation/package tests**

Run: npm run test:unit -- tests/unit/package.test.mjs

Expected: PASS.

Run: npm pack --dry-run --json

Expected: exit 0. Inspect the JSON file list and verify it includes:

- SKILL.md;
- README.md;
- LICENSE;
- THIRD_PARTY_LICENSES.md;
- all four scripts plus scripts/lib;
- all six template files;
- no tests, design specs, implementation plans, node_modules, or generated project artifacts.

- [ ] **Step 6: Run the full verification matrix**

Run: node --check scripts/validate-media.mjs

Run: node --check scripts/extract-frames.mjs

Run: node --check scripts/status.mjs

Run: node --check scripts/scaffold-site.mjs

Run: node --check template/scrub-core.js

Run: node --check template/scrub-engine.js

Expected: every syntax check exits 0.

Run: npm test

Expected: all unit and integration tests pass; integration may skip only when ffmpeg/ffprobe are absent.

Run: npm run test:browser

Expected: all Chromium smoke tests pass; suite may skip only when the Chromium executable is absent.

Run:

~~~powershell
python C:\Users\ryanl\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
~~~

Expected: exit 0.

- [ ] **Step 7: Inspect the example site manually**

Run:

~~~text
npx serve <integration-temp-project>/site
~~~

Verify:

- poster appears before canvas;
- scroll reaches first and last frames;
- holds pause the image while overlays remain visible;
- CTAs are focusable only while visible;
- reduced motion shows ordinary stacked content;
- throttled Slow 4G never blocks copy/outro;
- console contains no errors with all files present;
- deleting lenis.js leaves native scrolling functional.

- [ ] **Step 8: Commit**

~~~bash
git add README.md LICENSE THIRD_PARTY_LICENSES.md tests/unit/package.test.mjs
git commit -m "docs: complete scroll-wizard package"
~~~
