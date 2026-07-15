# Scroll Wizard CLI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Implement media validation, exact-count extraction, manifest-linked resume receipts, and transactional static-site scaffolding.

**Architecture:** Each CLI exposes pure functions for Vitest and a thin direct-invocation seam. Shared filesystem helpers own canonical hashing, atomic JSON writes, and rollback. Scaffold validates a complete staging site before replacing the live site.

**Tech Stack:** Node.js 20+ ESM, ffmpeg/ffprobe, Vitest 4.1.10.

## Global Constraints

- Complete the foundation/core plan at docs/superpowers/plans/2026-07-15-scroll-wizard.md first.
- Runtime npm dependencies remain zero.
- All CLIs must work through both node scripts/<name>.mjs and the package bin mapping.
- Missing files and invalid arguments return exit code 1; undecodable media returns exit code 2.
- All paths passed to child processes are argument-array entries, never shell-concatenated strings.
- Frame filenames are one-based and four-padded.
- WebP and JPG are the only extraction formats in v1.
- Gate manifests use sorted path/hash entries and SHA-256 over canonical JSON.
- Extraction hashes only hold ranges plus posterIndex from values.json.
- Theme hashes only the theme projection.
- Preview hashes every regular file under site.
- No live site data is moved or changed before the staging site validates.

---

### Task 3: Implement media validation

**Files:**
- Create: scripts/lib/cli.mjs
- Create: scripts/validate-media.mjs
- Test: tests/unit/validate-media.test.mjs

**Interfaces:**
- Consumes: file paths and ffprobe JSON.
- Produces: isDirect(importMetaUrl), valueAfter(argv, flag, fallback), runFfprobe(file, runner), detectMediaType(probe), videoVerdict(probe), imageVerdict(probe), and main(argv, io, runner, exists).

- [ ] **Step 1: Write the failing verdict tests**

~~~javascript
import { describe, expect, it, vi } from 'vitest';
import {
  detectMediaType,
  imageVerdict,
  main,
  videoVerdict,
} from '../../scripts/validate-media.mjs';

const video = {
  streams: [{
    codec_type: 'video',
    codec_name: 'h264',
    width: 1920,
    height: 1080,
    avg_frame_rate: '30/1',
    nb_frames: '240',
  }],
  format: { duration: '8', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
};

const image = {
  streams: [{
    codec_type: 'video',
    codec_name: 'png',
    width: 1600,
    height: 900,
    avg_frame_rate: '25/1',
    nb_frames: '1',
  }],
  format: { format_name: 'image2' },
};

describe('media verdicts', () => {
  it('distinguishes image2 from timed video', () => {
    expect(detectMediaType(video)).toBe('video');
    expect(detectMediaType(image)).toBe('image');
  });

  it('returns expected video metadata', () => {
    expect(videoVerdict(video)).toMatchObject({
      valid: true,
      type: 'video',
      metadata: {
        width: 1920,
        height: 1080,
        duration: 8,
        fps: 30,
        codec: 'h264',
      },
      warnings: [],
    });
  });

  it('warns for long, short, low-resolution, and non-16:9 media', () => {
    expect(videoVerdict({
      ...video,
      streams: [{ ...video.streams[0], height: 720 }],
      format: { ...video.format, duration: '16' },
    }).warnings.map((item) => item.code)).toEqual(['video.long', 'video.height']);
    expect(videoVerdict({
      ...video,
      format: { ...video.format, duration: '1' },
    }).warnings.map((item) => item.code)).toEqual(['video.short']);
    expect(imageVerdict({
      ...image,
      streams: [{ ...image.streams[0], width: 1000, height: 1000 }],
    }).warnings.map((item) => item.code)).toEqual(['image.aspect']);
  });
});

describe('CLI failures', () => {
  it('returns 1 for missing files and 2 for ffprobe failures', async () => {
    const io = { log: vi.fn(), error: vi.fn() };
    expect(await main(['missing.mp4'], io, vi.fn(), vi.fn().mockResolvedValue(false)))
      .toBe(1);
    const runner = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed'), { stderr: 'Invalid data found' }),
    );
    expect(await main(['fake.mp4'], io, runner, vi.fn().mockResolvedValue(true))).toBe(2);
    expect(io.error).toHaveBeenLastCalledWith('Not decodable: Invalid data found');
  });
});
~~~

- [ ] **Step 2: Run the focused test and verify red**

Run: npm run test:unit -- tests/unit/validate-media.test.mjs

Expected: FAIL because scripts/validate-media.mjs does not exist.

- [ ] **Step 3: Implement shared CLI helpers**

~~~javascript
// scripts/lib/cli.mjs
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isDirect(importMetaUrl, argv1 = process.argv[1]) {
  return Boolean(argv1) && pathToFileURL(resolve(argv1)).href === importMetaUrl;
}

export function valueAfter(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  if (index === argv.length - 1 || argv[index + 1].startsWith('--')) {
    throw new Error('Missing value for ' + flag);
  }
  return argv[index + 1];
}

export function hasFlag(argv, flag) {
  return argv.includes(flag);
}
~~~

- [ ] **Step 4: Implement validate-media.mjs**

Use execFile through promisify, pass these exact ffprobe arguments, and never invoke a shell:

~~~javascript
export async function runFfprobe(file, runner = execFileAsync) {
  const { stdout } = await runner('ffprobe', [
    '-v', 'error',
    '-show_entries',
    'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames:format=duration,format_name',
    '-of', 'json',
    file,
  ]);
  return JSON.parse(stdout);
}
~~~

Implement detection and reports with this exact shape:

~~~javascript
export function detectMediaType(probe) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  if (!stream) return 'unknown';
  const formats = String(probe?.format?.format_name ?? '').split(',');
  const duration = Number(probe?.format?.duration);
  return formats.includes('image2')
    || (!Number.isFinite(duration) && String(stream.nb_frames) === '1')
    ? 'image'
    : 'video';
}

const ratio = (value) => {
  const [top, bottom] = String(value ?? '0/1').split('/').map(Number);
  return bottom ? top / bottom : 0;
};

export function videoVerdict(probe) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(probe?.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) {
    return {
      valid: false, type: 'video',
      errors: ['No decodable timed video stream.'], warnings: [], metadata: {},
    };
  }
  const warnings = [];
  if (duration > 15) warnings.push({ code: 'video.long', message: 'Duration exceeds 15 seconds.' });
  if (duration < 2) warnings.push({ code: 'video.short', message: 'Duration is under 2 seconds.' });
  if (Number(stream.height) < 1080) {
    warnings.push({ code: 'video.height', message: 'Video height is below 1080 pixels.' });
  }
  return {
    valid: true,
    type: 'video',
    errors: [],
    warnings,
    metadata: {
      width: Number(stream.width),
      height: Number(stream.height),
      duration,
      fps: ratio(stream.avg_frame_rate),
      codec: stream.codec_name,
    },
  };
}

export function imageVerdict(probe) {
  const stream = probe?.streams?.find((item) => item.codec_type === 'video');
  if (!stream || !Number(stream.width) || !Number(stream.height)) {
    return {
      valid: false, type: 'image',
      errors: ['No decodable image stream.'], warnings: [], metadata: {},
    };
  }
  const aspect = Number(stream.width) / Number(stream.height);
  const offRatio = Math.abs(aspect - 16 / 9) / (16 / 9);
  return {
    valid: true,
    type: 'image',
    errors: [],
    warnings: offRatio > 0.05
      ? [{ code: 'image.aspect', message: 'Image is more than 5% away from 16:9.' }]
      : [],
    metadata: {
      width: Number(stream.width),
      height: Number(stream.height),
      format: stream.codec_name,
    },
  };
}
~~~

main must:

1. Print usage and return 1 when no path is supplied.
2. Return 1 when exists(file) is false.
3. Run ffprobe and choose the matching verdict.
4. Print either readable text or JSON when --json is present.
5. Return 2 for malformed JSON, unknown media, or ffprobe failure, printing only the first stderr line.
6. Set process.exitCode from main only when isDirect(import.meta.url) is true.

- [ ] **Step 5: Run the tests and verify green**

Run: npm run test:unit -- tests/unit/validate-media.test.mjs

Expected: PASS for detection, warning rules, and exit codes.

- [ ] **Step 6: Commit**

~~~bash
git add scripts/lib/cli.mjs scripts/validate-media.mjs tests/unit/validate-media.test.mjs
git commit -m "feat: add ffprobe media validation"
~~~

### Task 4: Implement exact-count frame extraction

**Files:**
- Create: scripts/lib/files.mjs
- Create: scripts/extract-frames.mjs
- Test: tests/unit/extract-frames.test.mjs

**Interfaces:**
- Consumes: an input video, output directory, count, width, format, quality, and force flag.
- Produces: canonicalJson, sha256Text, sha256File, listFilesRecursive, writeJsonAtomic, replaceDirectory, parseExtractArgs, framePlan, buildFfmpegArgs, summarizeFrames, and main.

- [ ] **Step 1: Write extraction planning tests**

~~~javascript
import { describe, expect, it } from 'vitest';
import {
  buildFfmpegArgs,
  framePlan,
  parseExtractArgs,
  summarizeFrames,
} from '../../scripts/extract-frames.mjs';

describe('frame extraction planning', () => {
  it('uses exact midpoint timestamps', () => {
    expect(framePlan(8, 4)).toEqual([1, 3, 5, 7]);
  });

  it('parses defaults and validates ranges', () => {
    expect(parseExtractArgs(['in.mp4', 'frames'])).toEqual({
      input: 'in.mp4',
      outDir: 'frames',
      count: 150,
      width: 1600,
      format: 'webp',
      quality: 80,
      force: false,
    });
    expect(() => parseExtractArgs(['in.mp4', 'frames', '--count', '0']))
      .toThrow(/count/);
    expect(() => parseExtractArgs(['in.mp4', 'frames', '--format', 'png']))
      .toThrow(/format/);
  });

  it('uses one shifted fps filter and caps output count', () => {
    const args = buildFfmpegArgs({
      input: 'in.mp4',
      outputPattern: 'tmp/frame-%04d.webp',
      duration: 8,
      count: 4,
      width: 1600,
      format: 'webp',
      quality: 80,
    });
    expect(args).toEqual(expect.arrayContaining([
      '-ss', '1',
      '-frames:v', '4',
      '-c:v', 'libwebp',
      'tmp/frame-%04d.webp',
    ]));
    expect(args.join(' ')).toContain('fps=4/8:start_time=0:round=near');
  });

  it('uses the mobile budget and exact load estimate', () => {
    expect(summarizeFrames([
      { bytes: 1_000_000, width: 1280, height: 720 },
      { bytes: 1_000_000, width: 1280, height: 720 },
    ], { count: 100, width: 1280, quality: 75 })).toMatchObject({
      totalBytes: 2_000_000,
      budgetBytes: 6 * 1024 * 1024,
      estimatedSeconds: 4.15,
    });
  });
});
~~~

- [ ] **Step 2: Run the focused test and verify red**

Run: npm run test:unit -- tests/unit/extract-frames.test.mjs

Expected: FAIL because scripts/extract-frames.mjs does not exist.

- [ ] **Step 3: Implement scripts/lib/files.mjs**

Implement these exact behaviors:

~~~javascript
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

export const sha256Text = (value) =>
  createHash('sha256').update(value).digest('hex');

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.tmp-' + randomUUID();
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}
~~~

Also export pathExists, directoryNonEmpty, and listFilesRecursive. listFilesRecursive returns sorted objects shaped as {path, absolutePath}. Implement replaceDirectory(prepared, target, force) with this transaction:

1. Reject an existing target unless force is true.
2. Rename target to a unique sibling backup.
3. Rename prepared to target.
4. Delete the backup only after step 3 succeeds.
5. If step 3 fails, delete any partial target and rename the backup back.

- [ ] **Step 4: Implement extraction planning and CLI**

Use these exact constants and algorithms:

~~~javascript
export const MID_4G_BYTES_PER_SECOND = 500_000;
export const REQUEST_OVERHEAD_SECONDS = 0.15;

export function framePlan(duration, count) {
  return Array.from({ length: count }, (_value, index) =>
    (index + 0.5) * duration / count);
}

export function buildFfmpegArgs(options) {
  const half = options.duration / options.count / 2;
  const filter = [
    'fps=' + options.count + '/' + options.duration + ':start_time=0:round=near',
    'scale=' + options.width + ':-2:flags=lanczos',
  ].join(',');
  const encoder = options.format === 'webp'
    ? ['-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6',
      '-quality', String(options.quality)]
    : ['-q:v', String(Math.max(2, Math.round(31 - options.quality * 0.29)))];
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(half),
    '-i', options.input,
    '-an',
    '-vf', filter,
    '-frames:v', String(options.count),
    ...encoder,
    options.outputPattern,
  ];
}

export function summarizeFrames(frames, preset) {
  const totalBytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
  const mobile = preset.count <= 100 && preset.width <= 1280 && preset.quality <= 75;
  return {
    count: frames.length,
    width: frames[0]?.width ?? preset.width,
    height: frames[0]?.height,
    totalBytes,
    averageBytes: frames.length ? Math.round(totalBytes / frames.length) : 0,
    budgetBytes: (mobile ? 6 : 12) * 1024 * 1024,
    overBudget: totalBytes > (mobile ? 6 : 12) * 1024 * 1024,
    estimatedSeconds: Number(
      (totalBytes / MID_4G_BYTES_PER_SECOND + REQUEST_OVERHEAD_SECONDS).toFixed(2),
    ),
  };
}
~~~

parseExtractArgs must accept input/outDir plus --count, --width, --format, --quality, and --force. Validate count 1..9999, width 16..8192, quality 1..100, and format webp|jpg.

main must:

1. Reject missing input and a non-empty output without --force.
2. Probe the input and require videoVerdict.valid.
3. Create a unique temporary sibling directory.
4. Run ffmpeg once with buildFfmpegArgs.
5. Verify exactly count contiguous, nonzero frame files.
6. Probe the first output for dimensions.
7. Replace the output directory wholesale through replaceDirectory.
8. Print the JSON summary and a human-readable over-budget warning.
9. Delete the temporary directory and leave the old output untouched on every failure.

- [ ] **Step 5: Add a replacement regression test**

~~~javascript
it('leaves exactly the new format and count after forced replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scroll-wizard-replace-'));
  const target = join(root, 'frames');
  const prepared = join(root, 'prepared');
  await mkdir(target);
  await mkdir(prepared);
  await writeFile(join(target, 'frame-0002.webp'), 'old');
  await writeFile(join(prepared, 'frame-0001.jpg'), 'new');
  await replaceDirectory(prepared, target, true);
  expect(await readdir(target)).toEqual(['frame-0001.jpg']);
});
~~~

- [ ] **Step 6: Run extraction tests**

Run: npm run test:unit -- tests/unit/extract-frames.test.mjs

Expected: PASS for argument parsing, midpoint planning, ffmpeg construction, budget math, and replacement.

- [ ] **Step 7: Commit**

~~~bash
git add scripts/lib/files.mjs scripts/extract-frames.mjs tests/unit/extract-frames.test.mjs
git commit -m "feat: add transactional frame extraction"
~~~

### Task 5: Implement manifest-linked status and approvals

**Files:**
- Create: scripts/status.mjs
- Test: tests/unit/status.test.mjs

**Interfaces:**
- Consumes: project artifacts and approvals.json.
- Produces: GATES, valuesProjection(values, gate), manifestHash(entries), buildGateManifest(projectDir, gate), buildInventory(projectDir), resolveResume(inventory), approveGate(projectDir, gate), and main.

- [ ] **Step 1: Write projection and chain tests**

~~~javascript
import { describe, expect, it } from 'vitest';
import {
  manifestHash,
  resolveResume,
  valuesProjection,
} from '../../scripts/status.mjs';

const hash = (letter) => letter.repeat(64);

it('keeps extraction approval stable when theme is added', () => {
  const before = {
    posterIndex: 12,
    overlays: [{ at: [0.2, 0.4], hold: true }, { at: [0.6, 0.7] }],
  };
  const after = { ...before, theme: { bg: '#000000' } };
  expect(valuesProjection(before, 'extraction'))
    .toEqual(valuesProjection(after, 'extraction'));
  expect(valuesProjection(after, 'theme')).toEqual({ bg: '#000000' });
});

it('canonicalizes manifest entry order', () => {
  expect(manifestHash([
    { path: 'b', sha256: hash('b') },
    { path: 'a', sha256: hash('a') },
  ])).toBe(manifestHash([
    { path: 'a', sha256: hash('a') },
    { path: 'b', sha256: hash('b') },
  ]));
});

it('invalidates the entire descendant chain after brief changes', () => {
  const manifests = {
    brief: hash('z'),
    keyframes: hash('b'),
    video: hash('c'),
    extraction: hash('d'),
    theme: hash('e'),
    preview: hash('f'),
  };
  const receipts = {
    brief: { manifestHash: hash('a'), basedOn: null },
    keyframes: { manifestHash: hash('b'), basedOn: hash('a') },
    video: { manifestHash: hash('c'), basedOn: hash('b') },
    extraction: { manifestHash: hash('d'), basedOn: hash('c') },
    theme: { manifestHash: hash('e'), basedOn: hash('d') },
    preview: { manifestHash: hash('f'), basedOn: hash('e') },
  };
  const report = resolveResume({
    manifests, receipts, incomplete: [], stale: [],
    keyframePromptCount: 1, videoPromptExists: true,
  });
  expect(report.resumeStep).toBe(1);
  expect(report.unapproved).toEqual([
    'brief', 'keyframes', 'video', 'extraction', 'theme', 'preview',
  ]);
});
~~~

- [ ] **Step 2: Run status tests and verify red**

Run: npm run test:unit -- tests/unit/status.test.mjs

Expected: FAIL because scripts/status.mjs does not exist.

- [ ] **Step 3: Implement canonical gate projections**

~~~javascript
export const GATES = ['brief', 'keyframes', 'video', 'extraction', 'theme', 'preview'];

export function valuesProjection(values, gate) {
  if (gate === 'extraction') {
    return {
      holds: (values.overlays ?? [])
        .filter((overlay) => overlay.hold)
        .map((overlay) => ({ at: overlay.at })),
      posterIndex: values.posterIndex ?? 1,
    };
  }
  if (gate === 'theme') return values.theme ?? null;
  throw new Error('No values projection for gate: ' + gate);
}

export function manifestHash(entries) {
  const normalized = [...entries]
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return sha256Text(canonicalJson(normalized));
}
~~~

buildGateManifest must use these exact entries:

- brief: brief.md.
- keyframes: every active prompts/keyframe-(first|last|ref-[1-3]).txt and the matching canonical input image.
- video: input/video.mp4.
- extraction: every file under project/frames, or site/frames after scaffold, plus the virtual path values.json#extraction hashed from valuesProjection.
- theme: virtual path values.json#theme.
- preview: every regular file recursively under site, including frames, JavaScript, CSS, Lenis, config, and fonts.

No history prompt participates in a manifest.

- [ ] **Step 4: Implement recursive chain validation**

~~~javascript
export function resolveResume(inventory) {
  const unapproved = [];
  let upstreamValidHash = null;
  let chainBroken = false;

  for (const gate of GATES) {
    const skippedKeyframes = gate === 'keyframes'
      && inventory.keyframePromptCount === 0
      && inventory.videoPromptExists;
    if (skippedKeyframes) continue;

    const currentHash = inventory.manifests[gate];
    if (!currentHash) {
      if (gate === 'keyframes' && inventory.keyframePromptCount === 0) {
        return finish(2, inventory, unapproved);
      }
      return finish(GATES.indexOf(gate) + 1, inventory, unapproved);
    }

    const receipt = inventory.receipts[gate];
    const valid = !chainBroken
      && receipt?.manifestHash === currentHash
      && receipt?.basedOn === upstreamValidHash;
    if (!valid) {
      chainBroken = true;
      unapproved.push(gate);
    } else {
      upstreamValidHash = currentHash;
    }
  }

  if (unapproved.length) {
    return finish(GATES.indexOf(unapproved[0]) + 1, inventory, unapproved);
  }
  if (inventory.incomplete.length) {
    return finish(stepFor(inventory.incomplete[0]), inventory, unapproved);
  }
  if (inventory.stale.length) {
    return finish(stepFor(inventory.stale[0]), inventory, unapproved);
  }
  return finish(7, inventory, unapproved);
}
~~~

finish returns {resumeStep, staleness, incomplete, unapproved}. stepFor maps brief=1, keyframes=2, video=3, extraction=4, site/theme=5, preview=6.

buildInventory computes:

- file hashes for every current manifest;
- newest recursive mtimes for input/video.mp4, project/frames, site/frames, brief.md, values.json, site/config.json, and input/keyframes;
- incomplete keyframe roles;
- extraction stale when video is newer than active frames;
- site stale when project frames exist newer than site frames, or brief/values are newer than site/config.json;
- video-possibly stale when keyframes are newer than video.

- [ ] **Step 5: Implement approveGate and CLI**

approveGate must:

1. Reject unknown gates and incomplete manifests.
2. Find the closest preceding non-skipped gate.
3. Require that upstream receipt to match its current manifest and valid chain.
4. Write {step, manifestHash, basedOn, timestamp} through writeJsonAtomic.
5. Preserve unrelated receipts; their recursive validity changes naturally.

CLI forms:

~~~text
node scripts/status.mjs <projectDir>
node scripts/status.mjs <projectDir> --json
node scripts/status.mjs <projectDir> --approve brief
~~~

- [ ] **Step 6: Add filesystem-level approval tests**

Create a temporary complete project and verify:

~~~javascript
const briefReceipt = await approveGate(projectDir, 'brief');
expect(briefReceipt.basedOn).toBeNull();
const keyframeReceipt = await approveGate(projectDir, 'keyframes');
expect(keyframeReceipt.basedOn).toBe(briefReceipt.manifestHash);

await writeFile(join(projectDir, 'brief.md'), '# Edited brief\n');
const changed = resolveResume(await buildInventory(projectDir));
expect(changed.resumeStep).toBe(1);
expect(changed.unapproved).toEqual([
  'brief', 'keyframes', 'video', 'extraction', 'theme', 'preview',
]);
~~~

Also verify a no-keyframe project resumes at step 2 before video.txt exists and treats keyframes as skipped after video.txt exists.

- [ ] **Step 7: Run status tests**

Run: npm run test:unit -- tests/unit/status.test.mjs

Expected: PASS for manifests, projections, staleness, skipped keyframes, receipt prerequisites, and chain invalidation.

- [ ] **Step 8: Commit**

~~~bash
git add scripts/status.mjs tests/unit/status.test.mjs
git commit -m "feat: add manifest-linked resume receipts"
~~~

### Task 6: Implement transactional site scaffolding

**Files:**
- Create: scripts/scaffold-site.mjs
- Test: tests/unit/scaffold-site.test.mjs

**Interfaces:**
- Consumes: projectDir, values.json, template directory, an optional fresh project/frames directory, and an optional existing site.
- Produces: inspectFrameSet(directory), assembleConfig(defaults, values, frameSet), scaffoldProject(options), and main.

- [ ] **Step 1: Write failing frame-set and config tests**

~~~javascript
import { describe, expect, it } from 'vitest';
import {
  assembleConfig,
  inspectFrameSet,
} from '../../scripts/scaffold-site.mjs';

it('derives a contiguous single-format frame block', async () => {
  const frames = await makeFrameDir(['frame-0001.webp', 'frame-0002.webp']);
  expect(await inspectFrameSet(frames)).toEqual({
    count: 2,
    extension: 'webp',
    pattern: 'frames/frame-{index:4}.webp',
  });
});

it('rejects gaps and mixed formats', async () => {
  await expect(inspectFrameSet(
    await makeFrameDir(['frame-0001.webp', 'frame-0003.webp']),
  )).rejects.toThrow(/contiguous/);
  await expect(inspectFrameSet(
    await makeFrameDir(['frame-0001.webp', 'frame-0002.jpg']),
  )).rejects.toThrow(/single format/);
});

it('derives poster from one-based posterIndex', () => {
  const result = assembleConfig(defaultConfig, {
    ...creativeValues,
    posterIndex: 2,
  }, {
    count: 2,
    extension: 'webp',
    pattern: 'frames/frame-{index:4}.webp',
  });
  expect(result.frames.poster).toBe('frames/frame-0002.webp');
});
~~~

- [ ] **Step 2: Run scaffold tests and verify red**

Run: npm run test:unit -- tests/unit/scaffold-site.test.mjs

Expected: FAIL because scripts/scaffold-site.mjs does not exist.

- [ ] **Step 3: Implement frame-set inspection and config assembly**

inspectFrameSet must:

1. Match only frame-(four digits).(webp|jpg).
2. Reject other frame-* media, mixed extensions, gaps, duplicate indices, zero files, and counts above 9999.
3. Return {count, extension, pattern}.

assembleConfig must:

~~~javascript
export function assembleConfig(defaults, values, frameSet) {
  const posterIndex = values.posterIndex ?? 1;
  if (!Number.isInteger(posterIndex)
      || posterIndex < 1 || posterIndex > frameSet.count) {
    throw new Error('posterIndex must be within 1..' + frameSet.count);
  }
  const { posterIndex: _ignored, ...creative } = values;
  const config = {
    ...defaults,
    ...creative,
    brand: { ...defaults.brand, ...creative.brand },
    theme: {
      ...defaults.theme,
      ...creative.theme,
      fonts: { ...defaults.theme.fonts, ...creative.theme?.fonts },
    },
    scrub: { ...defaults.scrub, ...creative.scrub },
    frames: {
      count: frameSet.count,
      pattern: frameSet.pattern,
      poster: 'frames/frame-' + String(posterIndex).padStart(4, '0')
        + '.' + frameSet.extension,
    },
  };
  const report = validateConfig(config);
  if (report.errors.length) {
    throw new Error(report.errors.map((item) => item.path + ': ' + item.message).join('\n'));
  }
  return { config, warnings: report.warnings };
}
~~~

- [ ] **Step 4: Implement staging without mutating the live site**

scaffoldProject follows this exact sequence:

1. Resolve project, template, site, unique site.tmp, unique site.old, and README temporary paths.
2. If site exists without --force, fail before moving or copying anything.
3. Copy template recursively into site.tmp.
4. If project/frames exists, rename it into site.tmp/frames and remember that it must move back on failure.
5. Otherwise copy live site/frames into site.tmp/frames; never rename it out of the live site.
6. Copy live site/fonts into site.tmp/fonts when present so theme-only rebuilds preserve the local font.
7. Inspect the staged frames, read values and template/config.json, assemble config, and write staged config.
8. Verify fonts.displayFile against the staged site; append a warning if absent.
9. Stage the generated project README separately.
10. Only now rename live site to site.old, rename site.tmp to site, and atomically replace README.
11. On any failure, restore site.old, move fresh frames back to project/frames, and remove temporary paths.
12. Delete site.old only after the new site and README are in place.

At process start, recover an interrupted previous run deterministically:

- if site is missing and exactly one site.old exists, restore it;
- if site exists, delete orphan site.old/site.tmp siblings after printing a notice;
- if project/frames is missing and an orphan site.tmp/frames contains fresh frames, restore it before deleting the temp.

- [ ] **Step 5: Add rollback and theme-only regression tests**

~~~javascript
it('restores live site and fresh frames after validation failure', async () => {
  await seedLiveSite(projectDir, { marker: 'old-site' });
  await seedFreshFrames(projectDir, ['frame-0001.webp']);
  await writeInvalidValues(projectDir);

  await expect(scaffoldProject({
    projectDir,
    valuesPath: join(projectDir, 'values.json'),
    force: true,
  })).rejects.toThrow(/contrast|surface/);

  expect(await readFile(join(projectDir, 'site', 'marker.txt'), 'utf8'))
    .toBe('old-site');
  expect(await readdir(join(projectDir, 'frames'))).toEqual(['frame-0001.webp']);
});

it('copies live frames for a theme-only rebuild', async () => {
  await seedLiveSite(projectDir, { frames: ['frame-0001.webp'] });
  await writeValidValues(projectDir);
  await scaffoldProject({
    projectDir,
    valuesPath: join(projectDir, 'values.json'),
    force: true,
  });
  expect(await readdir(join(projectDir, 'site', 'frames')))
    .toEqual(['frame-0001.webp']);
});
~~~

- [ ] **Step 6: Implement CLI output**

CLI syntax:

~~~text
node scripts/scaffold-site.mjs <projectDir> --config <values.json> [--force]
~~~

Print the site path, frame count/format, poster, warnings, whether frames were fresh or inherited, and the generated README path. Return 1 on any error.

- [ ] **Step 7: Run scaffold tests**

Run: npm run test:unit -- tests/unit/scaffold-site.test.mjs

Expected: PASS for derivation, validation, fresh install, theme-only inheritance, rollback, recovery, and poster range.

- [ ] **Step 8: Run all CLI-phase unit tests**

Run: npm run test:unit -- tests/unit/validate-media.test.mjs tests/unit/extract-frames.test.mjs tests/unit/status.test.mjs tests/unit/scaffold-site.test.mjs

Expected: PASS with zero failures.

- [ ] **Step 9: Commit**

~~~bash
git add scripts/scaffold-site.mjs tests/unit/scaffold-site.test.mjs
git commit -m "feat: add transactional site scaffold"
~~~
