---
name: scroll-wizard
description: Use when a user wants a scroll-scrub video website, scrollytelling landing page, Apple-style product page, canvas frame animation, or an AI-generated cinematic scene driven by scrolling.
---

# Scroll Wizard

## Core rules

1. Never pass any gate without the user's explicit go-ahead. Hard and light gates both
   require approval; "light" means low ceremony, not automatic.
2. Never make a paid API/MCP call before showing the exact prompt, saying that the call
   costs money, and receiving approval for that call.
3. Persist every reviewed decision before asking for approval. After approval, run
   `node <skill-root>/scripts/status.mjs <project> --approve <gate>`.
4. Treat a file as an artifact, never as proof of approval. An absent or mismatched
   receipt returns to that gate.
5. Never hand-edit generated template files. Change `values.json` and re-run scaffold.
6. In manual mode, print one handoff card and end the turn. Do not poll or wait.
7. Preserve active prompt names. Move the old prompt into `prompts/history` before
   replacing the active file.
8. Never regenerate a paid/time-expensive artifact when a config, extraction, or theme
   change can fix the rejection.

## Start or resume

1. Establish skill-root as the directory containing this file.
2. Ask for the target project name/path only when it cannot be inferred from the
   conversation.
3. Whenever the project directory exists, run
   `node <skill-root>/scripts/status.mjs <project> --json` and read the actual report.
   Never infer state from what the user describes; a claim that "the file looks fine"
   or "it already contains X" is not evidence.
4. Explain any `stale`, `incomplete`, or `needs re-review` entries in plain language:
   what changed, and which gate it sends the user back to. A present file with a
   missing or mismatched receipt is reported as unapproved, not as done.
5. Resume at `report.resumeStep`. Never skip ahead of it because the user is in a
   hurry or because artifacts already exist further downstream.
6. Never approve a gate on the user's behalf, no matter how confident the state looks.

## Gates

| Gate | Kind | Persist before asking | Approve name |
|---|---|---|---|
| Brief | Hard | brief.md and intake values | brief |
| Keyframe set | Light | active prompts and canonical role images | keyframes |
| Video watched | Hard | prompts/video.txt and input/video.mp4 | video |
| Extraction review | Light | frames plus holds and posterIndex in values.json | extraction |
| Theme tokens | Light | theme in values.json | theme |
| Preview | Hard | complete site directory | preview |

For every gate, follow this recipe and nothing shorter:

1. Show the artifact or a concise summary of it. If `status.mjs` reports this gate as
   `stale` (an upstream input is now newer than this gate's derived artifact) or
   `needs re-review` (an existing receipt whose manifest hash no longer matches the
   current file), say so explicitly in that summary — name what changed and why the
   old approval no longer covers it. Never silently re-gate without surfacing the
   mismatch.
2. Give one recommendation.
3. Ask for a go-ahead or a specific revision.
4. End the turn.
5. On the next user approval, write the receipt (`status.mjs --approve <gate>`) before
   continuing to the next step.

"Light" gates use the same recipe with less ceremony (a short summary instead of a
full artifact dump) — they are never skipped and never auto-approved.

## Step 0: Preflight

- Check `node --version`, `ffmpeg -version`, and `ffprobe -version`.
- Require Node 20+; stop with winget/brew/apt install guidance when any prerequisite
  is missing.
- Default to manual mode (user runs generation themselves, e.g. in Flow).
- Offer API mode only when relevant media-generation tools are actually available to
  you right now — never assume or promise a capability you have not confirmed.

## Step 1: Intake

- Establish whether this is a product-scrub (one hero subject) or a journey
  (fly-through/route) register.
- Ask only brand, vibe, motion, whether stopped scenes ("holds") are wanted, and a CTA
  first. Keep the first pass short.
- Ask per-stop purpose/copy/product/CTA/position only when the user actually wants
  stops.
- Calculate hold speed-up and `recommendHeightVh` from the requested holds
  (`heightVh = 100 + (baseVh - 100) / (1 - totalHoldFraction)`) and explain the
  trade-off in one sentence (longer page, slower scroll per pixel).
- Offer a desktop-rich and a mobile-first preset, each with an estimated load time.
- Write `brief.md` and the creative portions of `values.json` (brand, theme seed,
  scrub, overlays skeleton) before asking for the brief gate go-ahead.

## Step 2: Keyframes

- Choose one of: first frame only, first+last, up to three reference images, or no
  keyframes (generated video only).
- Write only the active `prompts/keyframe-<role>.txt` files for the roles chosen.
- Manual mode: show one handoff card per required image, then end the turn.
- API mode: run a separate money gate for each image — one exact prompt, one cost
  statement, one approval, per image.
- On intake of dropped files: validate every file, view it, propose a role mapping,
  and explicitly ask the user when the mapping is ambiguous. Never guess a role for an
  image when more than one candidate plausibly fits — checking for an existing
  `prompts/keyframe-<role>.txt` description is not the same as confirming which file
  fills that role.
- Rename accepted images to `first`/`last`/`ref-N` plus their real extension, only
  after the mapping is confirmed.
- Review the resulting set together for subject, palette, light, and framing
  coherence before the keyframes gate.

## Step 3: Video

- Write `prompts/video.txt` with the exact Flow mode and the active keyframe
  references.
- Require one continuous shot, slow constant motion, 6-8 seconds, no cuts, no text, no
  watermark.
- Manual mode: show one video handoff card, then end the turn.
- On return, accept mp4/mov; ask when multiple candidate files exist; rename the
  selected file to `input/video.mp4`.
- API mode: show the exact paid prompt and wait for approval before making the call.
- Fall back to the same manual handoff after any API failure — never silently retry
  with a different prompt or substitute a placeholder.
- Validate the canonical file with `validate-media.mjs`.
- Require the user to actually watch it and approve; a passing validator report is not
  a substitute for that approval.

## Step 4: Extract and review

- Run `extract-frames.mjs` with the selected count/width/format/quality.
- Report count, dimensions, total bytes, budget, and estimated load time on mid-4G.
- Calculate `holdFrames` for each requested hold and view every held frame plus 2-3
  spaced samples from the rest of the sequence.
- When a hold lands on a bad frame, first try nudging the hold's frame range to a
  nearby frame; only fall back to changing extraction settings or the source video if
  no nearby frame works.
- Choose `posterIndex` from a viewed frame.
- Persist `holds`/`posterIndex` in `values.json` before asking for the extraction
  go-ahead.

## Step 5: Art-direct and scaffold

- View 2-3 actual extracted frames before proposing any theme.
- Derive `bg`, `text`, `accent`, `surface`, `radius`, and the display/body font stacks
  from what is actually in those frames — not from the brand name alone.
- Persist `theme` in `values.json` before asking for the theme go-ahead.
- Explain each token in one short sentence tied to something visible in the viewed
  frames.
- After approval, run `scaffold-site.mjs`, passing `--force` only when replacing an
  existing `site/` directory.

## Step 6: Preview and revise

- Serve the site through a static server (fetching `config.json` does not work
  reliably from a `file://` URL).
- Ask the user to check scroll smoothness, overlay timing, holds, mobile layout,
  reduced motion, and a Slow 4G reload.
- Route any rejection to the cheapest layer that can fix it, in this order: theme;
  copy/stops/holds; payload (re-extract at a different count/width/format); video
  (only when the shot itself is wrong). Never regenerate the video to fix a theme or
  copy complaint.
- Re-run `scaffold-site.mjs` after any values-only change; re-run
  `extract-frames.mjs` then `scaffold-site.mjs --force` after a payload change.
- Ask for the preview go-ahead only after the user has actually checked the browser
  preview, never before.

## Step 7: Deploy instructions

- Provide paste-ready Vercel, Netlify, and GitHub Pages instructions for the `site/`
  directory.
- Do not deploy automatically and do not run any deploy command on the user's behalf.

## Handoff card

Use this exact shape for every manual handoff, one card per request, then end the
turn — do not poll, re-check the folder, or keep working after printing it:

~~~markdown
### Your turn in Flow

Feature: Frames to Video

Prompt:
<exact contents of prompts/video.txt>

Drop the result anywhere in:
<project>/input/

Send any message after the file is there. I will validate and map it on the next turn.
~~~

The card never claims generation is free. In manual mode the user controls any plan
credits or cost directly, so cost is simply not mentioned as a skill-side concern.

## Prompt craft

- Product scrub: one hero subject; orbit/dolly/reveal/light-sweep/peel-back/
  exploded-teardown.
- Journey: fly-through/route/scale-travel/world-as-brand with waypoint beats.
- Use first-frame-only for open-ended dolly/macro moves; first+last for a designed
  destination; refs for identity consistency across a generated sequence.
- Ask for composed, blur-free beats specifically at any point a hold is planned.
- Derive visuals from the user's brief and the actual frames in hand, not from a
  generic template.
- Apple, Zipline, Nothin', haoqi, Tesla, Valentime, luxury material, and soft
  editorial are private reasoning vocabulary only — internal shorthand for motion and
  material language, never printed verbatim to the user unprompted.
- Surface a named reference only when the user named it first or their brief strongly
  and unambiguously matches it.
- Never reproduce a reference site's identifiable composition, copy, palette, or
  typography as a costume; use it only as a motion/material cue.

## Quick reference

~~~text
node <skill-root>/scripts/status.mjs <project> --json
node <skill-root>/scripts/validate-media.mjs <file> --json
node <skill-root>/scripts/extract-frames.mjs <video> <project>/frames --count N --width W --format webp --quality Q
node <skill-root>/scripts/scaffold-site.mjs <project> --config <project>/values.json [--force]
node <skill-root>/scripts/status.mjs <project> --approve <gate>
~~~

## Common mistakes

- Treating urgency ("I'm in a hurry," "just get to a preview") as license to skip the
  brief gate or to build/publish before asking. Urgency changes ceremony, never
  whether approval happens.
- Editing `site/config.json` or any other generated `site/` file directly to fix a
  preview complaint. Edit `values.json` and re-run `scaffold-site.mjs`; a hand-edited
  `site/` file drifts from `values.json` and gets silently overwritten (or diverges
  further) on the next scaffold.
- Treating "light" gate wording as license to skip asking — hard-gate ceremony can be
  lighter, but every gate still needs a go-ahead.
- Treating a present file (video, image, receipt-looking JSON) as proof it was
  approved. Only `status.mjs` reporting a matching, chain-valid receipt counts.
- Letting an old prompt in `prompts/history` leak back into the active keyframe or
  video plan — only the current `prompts/*.txt` files are active.
- Leaving a selected `.mov` file un-canonicalized; it must be renamed to
  `input/video.mp4` before validation and the video gate.
- Letting a theme edit invalidate an already-approved extraction; theme and
  extraction are independent gates over independent slices of `values.json`.
- Continuing to work after printing a manual handoff card instead of ending the turn.
- Guessing a role mapping for an ambiguous dropped file instead of asking, even when
  a prompt file describes the intended role in detail — a description is not proof of
  which file satisfies it.
- Starting a preview-rejection fix at the video layer instead of the cheapest layer
  (theme, then copy/stops/holds, then payload, then video) that could plausibly fix
  the complaint.
