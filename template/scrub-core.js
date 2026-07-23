const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function scrollProgress(scrollY, sectionTop, sectionHeight, viewportH) {
  const distance = sectionHeight - viewportH;
  if (![scrollY, sectionTop, sectionHeight, viewportH].every(Number.isFinite)
      || distance <= 0) return 0;
  return clamp((scrollY - sectionTop) / distance, 0, 1);
}

export function applyHolds(progress, holds = []) {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const sorted = [...holds].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, range) => sum + range[1] - range[0], 0);
  if (total <= 0) return p;
  const moving = 1 - total;
  if (moving <= 0) return 0;
  let removed = 0;
  for (const [start, end] of sorted) {
    if (p < start) return clamp((p - removed) / moving, 0, 1);
    if (p <= end) return clamp((start - removed) / moving, 0, 1);
    removed += end - start;
  }
  return clamp((p - removed) / moving, 0, 1);
}

export function progressToFrame(progress, frameCount) {
  const count = Math.max(1, Math.trunc(frameCount));
  return clamp(Math.round(clamp(progress, 0, 1) * (count - 1)), 0, count - 1);
}

export function lingerEase(x, linger) {
  const p = clamp(Number.isFinite(x) ? x : 0, 0, 1);
  const strength = clamp(Number.isFinite(linger) ? linger : 0, 0, 1);
  const c = p - 0.5;
  return (1 - strength) * p + strength * (4 * c * c * c + 0.5);
}

export function progressToTime(progress, duration, margin = 0.05) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const safeMargin = Number.isFinite(margin) && margin >= 0 ? margin : 0;
  const end = Math.max(0, duration - safeMargin);
  return clamp(Number.isFinite(progress) ? progress : 0, 0, 1) * end;
}

export function selectScrubMode(config) {
  if (config?.scrub?.mode !== undefined) return config.scrub.mode;
  const video = config?.video;
  return video && typeof video === 'object' && !Array.isArray(video)
    && safeVideoPath(video.src)
    && safePosterPath(video.poster)
    && Number.isFinite(video.duration)
    && video.duration > 0
    ? 'video'
    : 'frames';
}

export function smooth(current, target, k, dt) {
  if (![current, target, k, dt].every(Number.isFinite) || k <= 0 || dt <= 0) {
    return current;
  }
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

export function alphaToK(alpha) {
  const value = clamp(Number.isFinite(alpha) ? alpha : 0, 0, 0.999999);
  return -60 * Math.log(1 - value);
}

export function coverRect(imgW, imgH, canvasW, canvasH) {
  if ([imgW, imgH, canvasW, canvasH].some((value) => !Number.isFinite(value) || value <= 0)) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const imageAspect = imgW / imgH;
  const canvasAspect = canvasW / canvasH;
  if (imageAspect > canvasAspect) {
    const sw = imgH * canvasAspect;
    return { sx: (imgW - sw) / 2, sy: 0, sw, sh: imgH };
  }
  const sh = imgW / canvasAspect;
  return { sx: 0, sy: (imgH - sh) / 2, sw: imgW, sh };
}

export function canvasSize(cssW, cssH, dpr, maxDpr = 2) {
  const ratio = clamp(Number.isFinite(dpr) ? dpr : 1, 1, maxDpr);
  return {
    width: Math.max(1, Math.round(cssW * ratio)),
    height: Math.max(1, Math.round(cssH * ratio)),
  };
}

export function frameFilename(index, pattern) {
  return pattern.replace(/\{index:(\d+)\}/, (_match, width) =>
    String(index + 1).padStart(Number(width), '0'));
}

export function overlayOpacity(progress, range, fade) {
  const [start, end] = range;
  const width = end - start;
  const ramp = fade ?? Math.min(0.05, width / 2);
  if (progress <= start || progress >= end || width <= 0) return 0;
  if (ramp <= 0) return 1;
  return clamp(Math.min((progress - start) / ramp, (end - progress) / ramp), 0, 1);
}

export function childRevealRange(range, offsetFraction) {
  const [start, end] = range;
  const width = end - start;
  const fraction = clamp(Number.isFinite(offsetFraction) ? offsetFraction : 0, 0, 1);
  return [start + fraction * width, end];
}

export function holdFrames(holds, frameCount) {
  return holds.map(([start]) =>
    progressToFrame(applyHolds(start, holds), frameCount));
}

export function recommendHeightVh(baseVh, holds = []) {
  const total = holds.reduce((sum, range) => sum + range[1] - range[0], 0);
  if (total <= 0) return { heightVh: baseVh, speedUp: 1 };
  if (total >= 1) return { heightVh: Infinity, speedUp: Infinity };
  return {
    heightVh: 100 + (baseVh - 100) / (1 - total),
    speedUp: 1 / (1 - total),
  };
}

export function decodeWindow(targetIndex, n, frameCount, direction = 0) {
  const count = Math.max(0, Math.trunc(frameCount));
  if (count === 0) return [];
  const radius = Math.max(0, Math.trunc(n));
  const size = Math.min(count, radius * 2 + 1);
  const remaining = size - 1;
  const before = direction > 0
    ? Math.floor(remaining / 4)
    : direction < 0
      ? Math.ceil(remaining * 3 / 4)
      : Math.floor(remaining / 2);
  const target = clamp(Math.trunc(targetIndex), 0, count - 1);
  const start = clamp(target - before, 0, count - size);
  return Array.from({ length: size }, (_value, offset) => start + offset);
}

function parseColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*(?:\.\d+)?))?\s*\)$/i,
  );
  if (!rgba) return null;
  const color = {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
  if ([color.r, color.g, color.b].some((channel) => channel < 0 || channel > 255)
      || color.a < 0 || color.a > 1) return null;
  return color;
}

function composite(foreground, background) {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function luminance(color) {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(colorA, colorB, compositeOver) {
  let first = parseColor(colorA);
  let second = parseColor(colorB);
  const background = parseColor(compositeOver ?? '#000000');
  if (!first || !second || !background) return NaN;
  if (first.a < 1) first = composite(first, background);
  if (second.a < 1) second = composite(second, background);
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const trustedOrigin = 'https://scroll-wizard.invalid';

function decodedVariants(value) {
  const variants = [value];
  let current = value;
  while (current.includes('%')) {
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded === current) break;
    variants.push(decoded);
    current = decoded;
  }
  return variants;
}

function hasUnsafePathSyntax(value, rejectCurrentSegments = false) {
  const variants = decodedVariants(value);
  if (!variants) return true;
  return variants.some((candidate) => {
    const path = candidate.split(/[?#]/, 1)[0];
    return candidate.trim() !== candidate
      || /[\u0000-\u001f\\]/.test(candidate)
      || candidate.startsWith('//')
      || /(^|\/)\.\.(?=\/|$)/.test(path)
      || (rejectCurrentSegments && /(^|\/)\.(?=\/|$)/.test(path));
  });
}

function safeHref(value) {
  if (typeof value !== 'string' || hasUnsafePathSyntax(value)) return false;
  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  try {
    if (hasExplicitScheme) {
      return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(value).protocol);
    }
    if (!/^(#|\/(?!\/)|\.\/|\?)/.test(value)) return false;
    return new URL(value, trustedOrigin).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function safeAssetPath(value, prefix) {
  if (typeof value !== 'string' || hasUnsafePathSyntax(value, true)) return false;
  const variants = decodedVariants(value);
  const decoded = variants[variants.length - 1];
  if (!value.startsWith(prefix) || !decoded.startsWith(prefix)
      || decoded.includes('//')) return false;
  try {
    const resolved = new URL(decoded, trustedOrigin);
    const normalized = decodeURIComponent(resolved.pathname.slice(1));
    return resolved.origin === trustedOrigin
      && !resolved.search
      && !resolved.hash
      && normalized === decoded;
  } catch {
    return false;
  }
}

function safeFramePath(value) {
  return safeAssetPath(value, 'frames/');
}

function safeVideoPath(value) {
  return safeAssetPath(value, 'media/') && /\.(mp4|webm)$/i.test(value);
}

function safePosterPath(value) {
  return safeAssetPath(value, 'media/') && /\.(webp|jpe?g|png)$/i.test(value);
}

const issue = (code, path, message) => ({ code, path, message });

export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const addError = (code, path, message) => errors.push(issue(code, path, message));

  if (!config || typeof config !== 'object') {
    return { errors: [issue('config.type', '', 'Config must be an object.')], warnings };
  }

  if (!config.brand || typeof config.brand.name !== 'string' || !config.brand.name.trim()) {
    addError('brand.name', 'brand.name', 'Brand name is required.');
  }

  const theme = config.theme ?? {};
  const colors = {};
  for (const key of ['bg', 'text', 'accent', 'surface']) {
    colors[key] = parseColor(theme[key]);
    if (!colors[key]) addError('theme.color', 'theme.' + key, 'Expected #rrggbb or rgb/rgba.');
  }
  if (!Number.isFinite(theme.radius) || theme.radius < 0) {
    addError('theme.radius', 'theme.radius', 'Radius must be a non-negative number.');
  }
  if (colors.surface && colors.surface.a < 0.45) {
    addError('theme.surface-alpha', 'theme.surface', 'Surface alpha must be at least 0.45.');
  }
  const displayFile = theme.fonts?.displayFile;
  if (displayFile !== undefined
      && !/^fonts\/(?!.*\.\.)[A-Za-z0-9._-]+\.woff2$/.test(displayFile)) {
    addError('font.path', 'theme.fonts.displayFile', 'Display font must be fonts/<name>.woff2.');
  }
  if (colors.text && colors.bg && contrastRatio(theme.text, theme.bg) < 4.5) {
    addError('contrast.text', 'theme.text', 'Text/background contrast must be at least 4.5:1.');
  }
  if (colors.text && colors.surface && colors.bg
      && contrastRatio(theme.text, theme.surface, theme.bg) < 4.5) {
    addError('contrast.cta', 'theme.surface', 'CTA text/surface contrast must be at least 4.5:1.');
  }

  if (!Number.isFinite(config.scrub?.heightVh) || config.scrub.heightVh <= 100) {
    addError('scrub.height', 'scrub.heightVh', 'Scrub height must exceed 100vh.');
  }
  if (!Number.isFinite(config.scrub?.smoothing)
      || config.scrub.smoothing <= 0 || config.scrub.smoothing >= 1) {
    addError('scrub.smoothing', 'scrub.smoothing', 'Smoothing must be in (0, 1).');
  }

  const mode = selectScrubMode(config);
  if (!['frames', 'video'].includes(mode)) {
    addError('scrub.mode', 'scrub.mode', 'Mode must be "frames" or "video".');
  }
  const linger = config.scrub?.linger;
  if (linger !== undefined && !(Number.isFinite(linger) && linger >= 0 && linger < 1)) {
    addError('scrub.linger', 'scrub.linger', 'Linger must be a number in [0, 1).');
  }
  if (mode === 'video') {
    const video = config.video ?? {};
    if (!safeVideoPath(video.src)) {
      addError('video.src', 'video.src', 'Video src must be a normalized path under media/.');
    }
    if (!safePosterPath(video.poster)) {
      addError('video.poster', 'video.poster', 'Video poster must be a normalized path under media/.');
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      addError('video.duration', 'video.duration', 'Video duration must be a positive number of seconds.');
    }
  }

  if (mode !== 'video') {
    const frames = config.frames ?? {};
    if (!Number.isInteger(frames.count) || frames.count < 1 || frames.count > 9999) {
      addError('frames.count', 'frames.count', 'Frame count must be an integer from 1 to 9999.');
    } else if (frames.count < 24 || frames.count > 400) {
      warnings.push(issue('frames.budget', 'frames.count', 'Recommended frame count is 24 to 400.'));
    }
    if (typeof frames.pattern !== 'string' || !/\{index:\d+\}/.test(frames.pattern)) {
      addError('frames.pattern', 'frames.pattern', 'Frame pattern requires an {index:N} token.');
    } else if (!safeFramePath(frames.pattern)) {
      addError('frames.pattern', 'frames.pattern',
        'Frame pattern must be a normalized path under frames/.');
    }
    if (typeof frames.poster !== 'string' || !safeFramePath(frames.poster)) {
      addError('frames.poster', 'frames.poster', 'Poster must be a path under frames/.');
    }
  }

  if (config.overlays !== undefined && !Array.isArray(config.overlays)) {
    addError('overlays.type', 'overlays', 'Overlays must be an array.');
  }
  const overlays = Array.isArray(config.overlays) ? config.overlays : [];
  const holds = [];
  overlays.forEach((overlay, index) => {
    const path = 'overlays[' + index + ']';
    if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
      addError('overlay.type', path, 'Overlay must be an object.');
      return;
    }
    const range = overlay.at;
    if (!Array.isArray(range) || range.length !== 2
        || !range.every(Number.isFinite)
        || range[0] < 0 || range[1] > 1 || range[0] >= range[1]) {
      addError('overlay.range', path + '.at', 'Overlay range must satisfy 0 <= start < end <= 1.');
    } else if (overlay.hold) {
      holds.push({ range, path });
    }
    if (overlay.position !== undefined
        && !['center', 'left', 'right'].includes(overlay.position)) {
      addError('overlay.position', path + '.position', 'Position must be center, left, or right.');
    }
    if (overlay.cta) validateCta(overlay.cta, path + '.cta', addError);
    if (overlay.stats !== undefined) {
      if (!Array.isArray(overlay.stats)) {
        addError('stats.type', path + '.stats', 'Stats must be an array.');
      } else {
        overlay.stats.forEach((stat, statIndex) => {
          if (!stat || !String(stat.value ?? '').trim() || !String(stat.label ?? '').trim()) {
            addError('stats.entry', path + '.stats[' + statIndex + ']',
              'Each stat needs non-empty value and label.');
          }
        });
      }
    }
  });

  holds.sort((a, b) => a.range[0] - b.range[0]);
  for (let index = 1; index < holds.length; index += 1) {
    if (holds[index].range[0] < holds[index - 1].range[1]) {
      addError('holds.overlap', holds[index].path + '.at', 'Hold ranges must not overlap.');
    }
  }
  const holdTotal = holds.reduce(
    (sum, hold) => sum + hold.range[1] - hold.range[0], 0,
  );
  if (holdTotal >= 1) addError('holds.total', 'overlays', 'Holds cannot cover the whole scrub.');

  if (config.process !== undefined) {
    if (!config.process || typeof config.process !== 'object' || Array.isArray(config.process)) {
      addError('process.type', 'process', 'Process must be an object.');
    } else {
      const steps = config.process.steps;
      if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) {
        addError('process.steps', 'process.steps', 'Process needs 1 to 8 steps.');
      } else {
        steps.forEach((step, index) => {
          const path = 'process.steps[' + index + ']';
          if (!step || typeof step.title !== 'string' || !step.title.trim()) {
            addError('process.step.title', path + '.title', 'Each step needs a non-empty title.');
          }
          if (!step || typeof step.body !== 'string' || !step.body.trim()) {
            addError('process.step.body', path + '.body', 'Each step needs a non-empty body.');
          }
        });
      }
    }
  }
  if (config.scrub?.parallax !== undefined && typeof config.scrub.parallax !== 'boolean') {
    addError('scrub.parallax', 'scrub.parallax', 'parallax must be a boolean.');
  }
  if (config.scrub?.cursorAccent !== undefined && typeof config.scrub.cursorAccent !== 'boolean') {
    addError('scrub.cursorAccent', 'scrub.cursorAccent', 'cursorAccent must be a boolean.');
  }

  if (config.outro?.cta) validateCta(config.outro.cta, 'outro.cta', addError);
  return { errors, warnings };
}

function validateCta(cta, path, addError) {
  if (typeof cta.label !== 'string' || !cta.label.trim()) {
    addError('cta.label', path + '.label', 'CTA label is required.');
  }
  if (!safeHref(cta.href)) {
    addError('cta.href', path + '.href', 'CTA href uses an unsupported or unsafe scheme.');
  }
}
