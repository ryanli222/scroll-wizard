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

Trust the report's backward-compatible state: a valid v1 `keyframes` receipt maps to
`storyboard`, and `stills-preview` is skipped only for a legacy project that has a v1
video but no beat prompts. Do not recreate or re-approve a receipt that status reports
as valid.

## Gates

| Gate | Kind | Persist before asking | Approve name |
|---|---|---|---|
| Brief | Hard | brief.md and intake values | brief |
| Storyboard | Light | active beat prompts, beat stills, and Pencil-reviewed overlays in values.json | storyboard |
| Stills preview | Light | stable beat-frame preview + reviewed overlays (legacy-only skip when a v1 video has no beat prompts) | stills-preview |
| Video watched | Hard | prompts/video.txt and input/video.mp4 | video |
| Extraction review | Light | frames + holds/posterIndex (frames mode) or media/ re-encode report (video mode) | extraction |
| Theme tokens | Light | theme in values.json | theme |
| Preview | Hard | complete site directory | preview |

For every gate, follow this recipe and nothing shorter:

1. Show the artifact or a concise summary of it. If `status.mjs` reports this gate as
   `stale` (an upstream input is now newer than this gate's derived artifact) or
   `needs re-review` (an existing receipt whose manifest hash no longer matches the
   current file), say so explicitly in that summary â€” name what changed and why the
   old approval no longer covers it. Never silently re-gate without surfacing the
   mismatch.
2. Give one recommendation.
3. Ask for a go-ahead or a specific revision.
4. End the turn.
5. On the next user approval, write the receipt (`status.mjs --approve <gate>`) before
   continuing to the next step.

"Light" gates use the same recipe with less ceremony (a short summary instead of a
full artifact dump) â€” they are never skipped and never auto-approved. The only
light-gate exception is `stills-preview` when `status.mjs` explicitly reports that
legacy skip; never infer the exception from files or project history.

## Step 0: Preflight

- Check `node --version`, `ffmpeg -version`, and `ffprobe -version`.
- Require Node 20+; stop with winget/brew/apt install guidance when any prerequisite
  is missing.
- Default to manual mode (user runs generation themselves, e.g. in Flow).
- Offer API mode only when relevant media-generation tools are actually available to
  you right now â€” never assume or promise a capability you have not confirmed.

## Step 1: Intake

- Establish whether this is a product-scrub (one hero subject) or a journey
  (fly-through/route) register.
- Ask brand, vibe, motion, stopped scenes ("holds"), and CTA. Also collect claim count,
  section count, whether the story has a process, and catalog-item count.
- Run `plan-generation.mjs beats` with those density inputs. Explain the resulting
  3-to-10 beat recommendation, let the user override it, and persist the confirmed
  count in `values.json`; the user, not the heuristic, has final control.
- Ask for Free, Cheapest, Balanced, or Quality-first plus an exact hard cap in integer
  micros. Explain the choice and initialize `budget.json` with `budget.mjs init` before
  any paid call. Show the explicit allocation command:
  `node <skill-root>/scripts/budget.mjs <project> init --preset <preset> --cap-micros <cap> --still-micros <still> --video-micros <video> --reroll-micros <reroll>`.
  Explain how the three integer-micro allocations fit within the cap before running
  it. Free has a zero cap and uses only user-provided/manual assets.
- Ask for the payload preset. Always state its estimated bytes and mid-4G load time;
  never describe a preset as merely "desktop" or "mobile" without the payload cost.
- Ask per-stop purpose/copy/product/CTA/position only when the user actually wants
  stops.
- For product-scrub, default `scrub.linger` to `0.35`, align holds with feature beats,
  and plan orbit/dolly/light-sweep/peel-back motion around one hero product on clean
  ground. Journey remains the fly-through/route register.
- Calculate hold speed-up and `recommendHeightVh` from the requested holds
  (`heightVh = 100 + (baseVh - 100) / (1 - totalHoldFraction)`) and explain the
  trade-off in one sentence (longer page, slower scroll per pixel).
- Write `brief.md` and the creative portions of `values.json` (brand, theme seed,
  generation choice, confirmed beat count, scrub, overlays skeleton) before asking for
  the brief gate go-ahead.

## Step 2: Storyboard

Before the free-text outline is approved, ask exactly:

> How should the page finish visually?
>
> 1. **Final-frame hold** — the scrub reaches its last frame and the page ends there.
> 2. **Solid text continuation** — scrolling past the scrub reveals a solid theme-background statement with centered text.

This choice never navigates to another URL. It only determines which sections follow `scrub-hero` on the same document. Persist it through `sections`: Final-frame hold ends the explicit array with `{ "type": "scrub-hero" }`; Solid text continuation appends `{ "type": "statement", "text": "<approved ending copy>" }` directly after it. Ask for and persist the approved ending copy before storyboard approval. Do not add a separate `endingMode` field.
- Draft a free text-only outline for the confirmed beat count. Ask for explicit
  approval of the free text-only outline and end the turn before acquiring stills or
  making any paid generation call.
- Write one active `prompts/keyframe-beat-<n>.txt` per beat. Beat 1 is the video's
  first-frame anchor and the final beat is its last-frame anchor when the later route
  supports those capabilities.
- Collect stills into `input/keyframes/beat-<n>.<ext>`. Manual mode prints one handoff
  card and ends the turn. API mode uses a separate per-image money gate: show the exact
  prompt/provider/model/maximum quote/remaining-after-call/expected result, receive
  approval, reserve with `budget.mjs reserve`, then `settle` or mark `unknown`.
- On intake of dropped files: validate every file, view it, propose a role mapping,
  and explicitly ask the user when the mapping is ambiguous. Never guess a role for an
  image when more than one candidate plausibly fits â€” checking for an existing
  `prompts/keyframe-beat-<n>.txt` description is not the same as confirming which file
  fills that role.
- Probe Pencil once with `get_editor_state`. If unavailable, say so and fall back to
  numeric `values.json` overlay editing; never claim Pencil review occurred.
- When Pencil is available, create one canvas per beat with the still as background
  and title/body/stats/CTA as editable nodes. Iterate through screenshots with the
  user. Persist approved copy, `position`, normalized `at` ranges, and `hold` flags in
  `values.json` before asking for the `storyboard` gate go-ahead.

## Step 3: Stills preview (no video-generation cost)

- Run `stills-to-frames.mjs`, scaffold the frames-mode site, and review the accepted
  stills with live overlays. Still acquisition obeys the ledger; this conversion adds
  no video-generation cost, and Free uses user-provided/manual assets only.
- Offer this result as a shippable No-video endpoint before offering video. Persist the
  stable beat-frame preview and reviewed overlays, then ask for the `stills-preview`
  gate go-ahead.

## Step 4: Video and budget menu

- Preflight the current session and persist route JSON containing only verified
  capabilities, availability, and current prices. Never infer provider availability
  from this table or from a user claim:

  | Route | Cost character |
  |---|---|
  | Manual handoff (Flow or user's own tool) | User's plan credits (default) |
  | Veo / Seedance / Kling API | Current verified per-clip pricing and capability limits |
  | Higgsfield API | Per-clip, typically pricier |
  | Shorter/lower-res variant (4-6 s, 720p) | Cheapest paid |
  | No video - ship the stills site | Free |

- Always include Manual and No video as unconditional menu entries; include API routes
  only when they are callable now. Run `plan-generation.mjs routes` against the
  persisted preflight JSON, inside the ledger's remaining hard budget, and show ranked
  eligible routes plus every excluded reason. Never rank providers informally.
- After route selection, write `prompts/video.txt` with one continuous slow shot, no
  cuts/text/watermark, and only references supported by that route. Unsupported middle
  beats guide prompt/timing but are not claimed as frame-locked.
- Manual mode prints the exact video handoff card and ends the turn. For every paid
  generation or reroll, show the exact prompt/provider/model/maximum quote,
  remaining-after-call, and expected result; receive approval; reserve before calling;
  then `settle` the actual cost or mark an interrupted/billing-uncertain call `unknown`.
  When a failed call is definitively unbilled, settle it with actual cost 0 to release
  the reservation. Reconcile unknown calls before retrying. There are no automatic
  rerolls.
- At the cap, stop and preserve current work. State the exact additional micros and
  which visible weakness that purchase is likely to improve; explicitly say quality is
  not guaranteed and never raise the cap automatically. Offer the current stills site,
  a cheaper verified route, unused-budget reallocation, or an explicit exact cap raise.
- For No video, persist `generation.video: false`; only the video gate skips. Otherwise
  canonicalize the chosen mp4/mov as `input/video.mp4`, validate it, require the user to
  watch it, and ask for the `video` gate go-ahead.

## Step 5: Derive playback

- After video approval, default to balanced blob-video playback:
  `node <skill-root>/scripts/reencode-video.mjs <project>/input/video.mp4 <project>/media --gop 8 --crf 23 --width 1600`.
- Offer `--all-intra` only with its larger-payload and slower-load warning. Frames mode
  remains available when preferred or when measured video seeking performs poorly.
- With No video, keep the beat-derived frames from `stills-to-frames`; skip only the
  video gate and still complete extraction. For video-to-frames fallback, use
  `extract-frames.mjs`, calculate holds, inspect held/spaced samples, and choose a viewed
  `posterIndex`.
- Report the JSON payload summary, dimensions, total bytes, budget, and estimated
  mid-4G load time. Persist holds/posterIndex for frames mode or the `media/` re-encode
  report for video mode before asking for the `extraction` gate go-ahead.

## Step 6: Art-direct and scaffold

- View 2-3 actual beat frames, or the video poster plus representative approved beats,
  before proposing any theme.
- Derive `bg`, `text`, `accent`, `surface`, `radius`, and the display/body font stacks
  from what is actually in those frames â€” not from the brand name alone.
- Persist `theme` in `values.json` before asking for the theme go-ahead.
- Explain each token in one short sentence tied to something visible in the viewed
  frames.
- After approval, run `scaffold-site.mjs`, passing `--force` only when replacing an
  existing `site/` directory.

## Step 7: Preview and revise

- Serve the site through a static server (fetching `config.json` does not work
  reliably from a `file://` URL).
- Ask the user to check scroll smoothness, overlay timing, holds, reduced motion, and a
  Slow 4G reload. On mobile, use the same stills/video and verify no horizontal
  overflow, safe-area padding, readable overlays, touch-sized CTAs, coarse-pointer seek
  tuning, iOS first-gesture priming, and height-only resize stability. Never add a
  portrait-generation route.
- Route any rejection to the cheapest layer that can fix it, in this order: theme;
  copy/stops/holds; playback payload (re-encode video or re-derive frames); video only
  when the shot itself is wrong. Never regenerate video to fix theme or copy.
- Re-run `scaffold-site.mjs` after values-only changes. After payload changes, rerun the
  selected derivation command and then `scaffold-site.mjs --force`.
- Ask for the preview go-ahead only after the user has actually checked the browser
  preview, never before.

## Step 8: Deploy instructions

- Provide paste-ready Vercel, Netlify, and GitHub Pages instructions for the `site/`
  directory.
- Do not deploy automatically and do not run any deploy command on the user's behalf.

## Handoff card

Use this exact shape for every manual handoff, one card per request, then end the
turn â€” do not poll, re-check the folder, or keep working after printing it:

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
  editorial are private reasoning vocabulary only â€” internal shorthand for motion and
  material language, never printed verbatim to the user unprompted.
- Surface a named reference only when the user named it first or their brief strongly
  and unambiguously matches it.
- Never reproduce a reference site's identifiable composition, copy, palette, or
  typography as a costume; use it only as a motion/material cue.

## Quick reference

~~~text
node <skill-root>/scripts/status.mjs <project> --json
node <skill-root>/scripts/validate-media.mjs <file> --json
node <skill-root>/scripts/plan-generation.mjs beats --claims 4 --sections 5
node <skill-root>/scripts/plan-generation.mjs routes <routes.json> --budget-micros N --preset balanced --duration 8 --resolution 720p
node <skill-root>/scripts/budget.mjs <project> status
node <skill-root>/scripts/stills-to-frames.mjs <project> --width 1600 --quality 80
node <skill-root>/scripts/reencode-video.mjs <project>/input/video.mp4 <project>/media --crf 23 --width 1600
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
- Treating "light" gate wording as license to skip asking â€” hard-gate ceremony can be
  lighter, but every gate still needs a go-ahead.
- Treating a present file (video, image, receipt-looking JSON) as proof it was
  approved. Only `status.mjs` reporting a matching, chain-valid receipt counts.
- Letting an old prompt in `prompts/history` leak back into the active keyframe or
  video plan â€” only the current `prompts/*.txt` files are active.
- Leaving a selected `.mov` file un-canonicalized; it must be renamed to
  `input/video.mp4` before validation and the video gate.
- Letting a theme edit invalidate an already-approved extraction; theme and
  extraction are independent gates over independent slices of `values.json`.
- Continuing to work after printing a manual handoff card instead of ending the turn.
- Guessing a role mapping for an ambiguous dropped file instead of asking, even when
  a prompt file describes the intended role in detail â€” a description is not proof of
  which file satisfies it.
- Starting a preview-rejection fix at the video layer instead of the cheapest layer
  (theme, then copy/stops/holds, then payload, then video) that could plausibly fix
  the complaint.
- Treating an available video provider as permission to skip the adaptive storyboard
  or the shippable stills preview. Provider availability changes the Step 4 menu, not
  the seven-gate order.
- Ranking remembered provider names/prices instead of preflighting runtime route JSON
  and running `plan-generation.mjs routes` against the remaining ledger budget.
- Starting a paid call after conversational approval but before durable reservation,
  or retrying an `unknown` call before reconciliation.
- Raising the cap automatically or promising that extra spend will improve quality;
  state the exact shortfall and likely targeted improvement without a guarantee.
- Generating separate portrait media instead of fixing the same-media responsive
  layout and seek behavior.
