import {
  alphaToK,
  applyHolds,
  canvasSize,
  coverRect,
  decodeWindow,
  frameFilename,
  lingerEase,
  overlayOpacity,
  pointToPixel,
  progressToFrame,
  progressToTime,
  scrollProgress,
  selectScrubMode,
  smooth,
  validateConfig,
} from './scrub-core.js';
import { assembleSections, currentPoster } from './sections-core.js';
import { renderSections } from './section-renderer.js';

const sectionContainer = document.getElementById('site-sections');
const scrub = document.getElementById('scrub');
const poster = document.getElementById('poster');
const scrubVideo = document.getElementById('scrub-video');
const canvas = document.getElementById('scrub-canvas');
const overlayLayer = document.getElementById('overlay-layer');
const loadProgress = document.getElementById('load-progress');
const loader = document.getElementById('loader');
const outro = document.getElementById('outro');
const fatalError = document.getElementById('fatal-error');
const footerBrand = document.getElementById('footer-brand');
const progressBar = document.getElementById('progress-bar');

// Raw, hand-authored v2 configs with no direction predate generated presets.
// Give only those undirected configs the calm minimal runtime; any explicit
// direction must carry scaffolded references/directions.json runtime data.
const LEGACY_DIRECTION_RUNTIME = Object.freeze({
  motion: Object.freeze({
    ease: 'cubic-bezier(0.23, 1, 0.32, 1)',
    springBounce: 0,
    revealTravelPx: 16,
  }),
  chromeStyle: 'quiet',
  scrimStrength: 0.5,
});

// 849-byte, single-frame 16x16 baseline H.264 MP4. It gives iOS a local,
// playable source for gesture priming without fetching the configured video.
const VIDEO_PRIME_SRC = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMPbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjl0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAGxbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABXG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAARxzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAe/+EAFmdCwB7ZHsBEAAADAAQAAAMACDxYuSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAACQAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAASAAAAAQAAABRzdGNvAAAAAAAAAAEAAAM/AAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDIAAAAIZnJlZQAAABptZGF0AAAADmWIhAV///8PRQABQt+A';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function linkButton(cta, className) {
  const link = element('a', className, cta.label);
  link.href = cta.href;
  return link;
}

function renderOverlay(data, index, total) {
  const variant = data.variant ?? 'bare';
  const anchor = data.anchor ?? 'bottom';
  const classes = [
    'overlay',
    'overlay--' + variant,
    'overlay--' + (data.position ?? 'center'),
    'overlay--anchor-' + anchor,
  ];
  if (data.showIndex) classes.push('overlay--show-index');
  if (data.kicker) classes.push('overlay--show-kicker');
  const panel = element('article', classes.join(' '));
  const content = element('div', 'overlay__content');
  panel.dataset.overlayIndex = String(index);
  panel.inert = true;
  content.append(element('span', 'overlay__index',
    String(index + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')));
  if (variant === 'annotation') {
    panel.dataset.point = JSON.stringify(data.point);
    panel.append(element('span', 'overlay__leader'));
  }
  if (data.kicker) content.append(element('span', 'overlay__kicker', data.kicker));
  if (data.title) content.append(element('h2', 'overlay__title', data.title));
  if (data.body) content.append(element('p', 'overlay__body', data.body));
  if (data.stats?.length) {
    const list = element('div', 'stats');
    for (const stat of data.stats) {
      const chip = element('div', 'stat');
      chip.append(
        element('strong', 'stat__value', stat.value),
        element('span', 'stat__label', stat.label),
      );
      list.append(chip);
    }
    content.append(list);
  }
  if (data.cta) content.append(linkButton(data.cta, 'overlay__cta'));
  panel.append(content);
  return { node: panel, content };
}

function applyTheme(config) {
  if (config.direction !== undefined && config.directionPreset === undefined) {
    throw new Error(
      'Direction "' + config.direction + '" requires generated directionPreset data. '
      + 'Run scaffold-site so references/directions.json is serialized into config.json.',
    );
  }
  const theme = config.theme;
  const runtime = config.directionPreset ?? LEGACY_DIRECTION_RUNTIME;
  const motion = runtime.motion ?? LEGACY_DIRECTION_RUNTIME.motion;
  const root = document.documentElement.style;
  root.setProperty('--bg', theme.bg);
  root.setProperty('--text', theme.text);
  root.setProperty('--muted', theme.muted ?? theme.text);
  root.setProperty('--accent', theme.accent);
  root.setProperty('--surface', theme.surface);
  root.setProperty('--radius', theme.radius + 'px');
  root.setProperty('--border-style', theme.borderStyle ?? 'solid');
  if (theme.fonts?.display) root.setProperty('--display', theme.fonts.display);
  if (theme.fonts?.body) root.setProperty('--body', theme.fonts.body);
  if (theme.fonts?.mono) root.setProperty('--mono', theme.fonts.mono);
  root.setProperty('--ease', motion.ease ?? LEGACY_DIRECTION_RUNTIME.motion.ease);
  root.setProperty('--spring-bounce', String(
    motion.springBounce ?? LEGACY_DIRECTION_RUNTIME.motion.springBounce,
  ));
  root.setProperty('--reveal-travel', String(
    motion.revealTravelPx ?? LEGACY_DIRECTION_RUNTIME.motion.revealTravelPx,
  ) + 'px');
  root.setProperty('--scrim-strength', String(
    runtime.scrimStrength ?? LEGACY_DIRECTION_RUNTIME.scrimStrength,
  ));
  root.setProperty(
    '--chrome-style', runtime.chromeStyle ?? LEGACY_DIRECTION_RUNTIME.chromeStyle,
  );
  const direction = config.direction ?? 'minimal';
  document.body.classList.add('dir-' + direction);
  document.body.dataset.chromeStyle = runtime.chromeStyle
    ?? LEGACY_DIRECTION_RUNTIME.chromeStyle;
  scrub.style.setProperty('height', config.scrub.heightVh + 'vh');
}

function renderCopy(config) {
  const overlays = config.overlays ?? [];
  const overlayNodes = overlays.map((data, index) => {
    const { node, content } = renderOverlay(data, index, overlays.length);
    overlayLayer.append(node);
    return { data, node, content };
  });
  footerBrand.textContent = config.brand.name;
  return overlayNodes;
}

function showFatalError(error) {
  fatalError.textContent = error instanceof Error ? error.message : String(error);
  fatalError.hidden = false;
}

async function loadPoster(config) {
  poster.src = selectScrubMode(config) === 'video'
    ? config.video.poster
    : config.frames.poster;
  poster.alt = config.brand.imageAlt || config.brand.tagline
    || (config.brand.name + ' hero scene');
  try {
    await poster.decode();
  } catch {
    // decode() can reject even for images that will still load (e.g. some
    // formats/engines); fall back to the load event, but don't wait forever
    // for an image that has already finished failing.
    if (poster.complete && poster.naturalWidth === 0) {
      throw new Error('Poster image failed to load.');
    }
    // decode() can also reject for an image that already finished loading
    // successfully (some formats/engines); waiting for a 'load' event that
    // already fired would hang forever, so treat this as already loaded.
    if (poster.complete && poster.naturalWidth > 0) return;
    await new Promise((resolve, reject) => {
      poster.addEventListener('load', resolve, { once: true });
      poster.addEventListener('error', () => {
        reject(new Error('Poster image failed to load.'));
      }, { once: true });
    });
  }
}

async function loadFont(config) {
  const displayFile = config.theme.fonts?.displayFile;
  if (!displayFile) return;
  try {
    const face = new FontFace('ScrollWizardDisplay', 'url("' + displayFile + '")');
    await face.load();
    document.fonts.add(face);
    const fallback = config.theme.fonts?.display ?? 'serif';
    document.documentElement.style.setProperty(
      '--display', 'ScrollWizardDisplay, ' + fallback,
    );
  } catch (error) {
    console.warn('Display font failed to load:', error.message);
  }
}

function applyReducedMotion(overlayNodes) {
  for (const { node, content } of overlayNodes) {
    node.inert = false;
    node.style.opacity = '1';
    content.style.setProperty('--reveal', '1');
    node.style.pointerEvents = 'none';
  }
}

class FrameStore {
  constructor(config, onProgress) {
    this.config = config;
    this.onProgress = onProgress;
    this.blobs = new Array(config.frames.count);
    this.failed = new Set();
    this.warned = new Set();
    this.bitmaps = new Map();
    this.pendingBitmaps = new Map();
    this.pendingFetches = new Map();
    this.desired = new Set();
    this.radius = 12;
    this.loaded = 0;
  }

  url(index) {
    return frameFilename(index, this.config.frames.pattern);
  }

  fetchOne(index) {
    if (this.blobs[index] || this.failed.has(index)) return Promise.resolve();
    // In-flight dedupe: preloadAll and ensureBitmap can request the same
    // index concurrently; without this, this.loaded would increment once
    // per call instead of once per unique frame.
    if (this.pendingFetches.has(index)) return this.pendingFetches.get(index);
    const promise = (async () => {
      try {
        const response = await fetch(this.url(index));
        if (!response.ok) throw new Error('HTTP ' + response.status);
        this.blobs[index] = await response.blob();
      } catch (error) {
        this.failed.add(index);
        this.warnOnce(index, error);
      } finally {
        this.pendingFetches.delete(index);
        this.loaded += 1;
        this.onProgress(this.loaded / this.config.frames.count);
      }
    })();
    this.pendingFetches.set(index, promise);
    return promise;
  }

  warnOnce(index, error) {
    if (this.warned.has(index)) return;
    this.warned.add(index);
    console.warn('Frame ' + (index + 1) + ' failed:', error.message);
  }

  async preloadAll(concurrency = 6) {
    const count = this.config.frames.count;
    let next = 0;
    const worker = async () => {
      while (next < count) {
        const index = next;
        next += 1;
        await this.fetchOne(index);
      }
    };
    const workerCount = Math.max(1, Math.min(concurrency, count));
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  async ensureBitmap(index) {
    if (this.bitmaps.has(index)) return this.bitmaps.get(index);
    if (this.pendingBitmaps.has(index)) return this.pendingBitmaps.get(index);
    const promise = (async () => {
      if (!this.blobs[index]) {
        if (this.failed.has(index)) return undefined;
        await this.fetchOne(index);
      }
      const blob = this.blobs[index];
      if (!blob) return undefined;
      let bitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch (error) {
        this.failed.add(index);
        this.warnOnce(index, error);
        return undefined;
      }
      if (this.desired.has(index)) {
        this.bitmaps.set(index, bitmap);
      } else {
        bitmap.close();
      }
      return bitmap;
    })();
    this.pendingBitmaps.set(index, promise);
    try {
      return await promise;
    } finally {
      this.pendingBitmaps.delete(index);
    }
  }

  async reconcile(target, direction) {
    const desired = new Set(
      decodeWindow(target, this.radius, this.config.frames.count, direction),
    );
    this.desired = desired;
    for (const [index, bitmap] of this.bitmaps) {
      if (!desired.has(index)) {
        bitmap.close();
        this.bitmaps.delete(index);
      }
    }
    const ordered = [...desired].sort((a, b) => {
      const aAhead = direction >= 0 ? a - target : target - a;
      const bAhead = direction >= 0 ? b - target : target - b;
      return Math.abs(aAhead) - Math.abs(bAhead);
    });
    await Promise.allSettled(ordered.map((index) => this.ensureBitmap(index)));
  }

  nearest(target, direction = 0) {
    let bestIndex;
    let bestDistance = Infinity;
    for (const index of this.bitmaps.keys()) {
      const distance = Math.abs(index - target);
      if (distance > bestDistance) continue;
      if (distance === bestDistance && bestIndex !== undefined) {
        const currentAhead = direction >= 0 ? index - target : target - index;
        const bestAhead = direction >= 0 ? bestIndex - target : target - bestIndex;
        if (currentAhead <= bestAhead) continue;
      }
      bestDistance = distance;
      bestIndex = index;
    }
    return bestIndex === undefined
      ? undefined
      : { index: bestIndex, bitmap: this.bitmaps.get(bestIndex) };
  }

  destroy() {
    for (const bitmap of this.bitmaps.values()) bitmap.close();
    this.bitmaps.clear();
    this.pendingBitmaps.clear();
  }
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const size = canvasSize(rect.width, rect.height, devicePixelRatio);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
    return true;
  }
  return false;
}

function drawCover(context, source) {
  const crop = coverRect(
    source.width, source.height,
    context.canvas.width, context.canvas.height,
  );
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.drawImage(
    source,
    crop.sx, crop.sy, crop.sw, crop.sh,
    0, 0, context.canvas.width, context.canvas.height,
  );
}

function positionAnnotations(sourceW, sourceH, boxW, boxH) {
  for (const node of overlayLayer.querySelectorAll('.overlay--annotation')) {
    let point;
    try {
      point = JSON.parse(node.dataset.point);
    } catch {
      continue;
    }
    const { x, y } = pointToPixel(point, sourceW, sourceH, boxW, boxH);
    const content = node.querySelector('.overlay__content');
    if (!content || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    // offset* is layout geometry before the reveal transform. Basing the leader
    // on it keeps the endpoint stable while the inner label animates.
    const left = content.offsetLeft;
    const top = content.offsetTop;
    const right = left + content.offsetWidth;
    const bottom = top + content.offsetHeight;
    const startX = x >= (left + right) / 2 ? right : left;
    const startY = Math.min(bottom - 8, Math.max(top + 8, y));
    const dx = x - startX;
    const dy = y - startY;

    node.style.setProperty('--px', x.toFixed(1) + 'px');
    node.style.setProperty('--py', y.toFixed(1) + 'px');
    node.style.setProperty('--leader-x', startX.toFixed(1) + 'px');
    node.style.setProperty('--leader-y', startY.toFixed(1) + 'px');
    node.style.setProperty('--leader-len', Math.hypot(dx, dy).toFixed(1) + 'px');
    node.style.setProperty(
      '--leader-angle',
      (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1) + 'deg',
    );
  }
}

let store = null;
let lastDrawnIndex = -1;
let scrubProgressDebug = 0;
let seekEpsilonDebug = 0;
let videoDurationDebug = 0;

if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  window.__SCROLL_WIZARD_DEBUG__ = {
    get decodedCount() { return store?.bitmaps.size ?? 0; },
    get lastFrame() { return lastDrawnIndex; },
    get failedFrames() { return [...(store?.failed ?? [])]; },
    get videoTime() { return document.getElementById('scrub-video')?.currentTime ?? 0; },
    get scrubProgress() { return scrubProgressDebug; },
    get seekEpsilon() { return seekEpsilonDebug; },
    get videoDuration() { return videoDurationDebug; },
  };
}

function updateOverlays(overlayNodes, raw) {
  for (const { data, node, content } of overlayNodes) {
    const opacity = overlayOpacity(raw, data.at);
    node.style.opacity = String(opacity);
    content.style.setProperty('--reveal', String(opacity));
    const visible = opacity >= 0.05;
    node.inert = !visible;
    node.style.pointerEvents = 'none';
    content.style.pointerEvents = visible ? 'auto' : 'none';
  }
}

function updateProgressBar() {
  const pageProgress = Math.min(1, Math.max(0,
    scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)));
  progressBar.style.transform = 'scaleX(' + pageProgress + ')';
}

function runEngine(config, overlayNodes) {
  const holds = (config.overlays ?? [])
    .filter((overlay) => overlay.hold)
    .map((overlay) => overlay.at);
  const context = canvas.getContext('2d');
  const k = alphaToK(config.scrub.smoothing);

  store = new FrameStore(config, (fraction) => {
    loadProgress.value = fraction;
  });
  store.preloadAll();

  let smoothProgress = 0;
  let lastTargetFrame = -1;
  let lastTime = performance.now();
  let lastSource = null;
  let posterHidden = false;

  const stickyWrapper = scrub.querySelector('.scrub__sticky');
  function handleResize() {
    const resized = resizeCanvas(canvas);
    if (resized && lastSource) drawCover(context, lastSource);
    const rect = stickyWrapper.getBoundingClientRect();
    const sourceW = lastSource?.width ?? poster.naturalWidth;
    const sourceH = lastSource?.height ?? poster.naturalHeight;
    positionAnnotations(sourceW, sourceH, rect.width, rect.height);
  }
  new ResizeObserver(handleResize).observe(stickyWrapper);
  handleResize();

  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    const raw = scrollProgress(
      window.scrollY, scrub.offsetTop, scrub.offsetHeight, innerHeight,
    );
    const targetProgress = lingerEase(
      applyHolds(raw, holds), config.scrub.linger ?? 0,
    );
    smoothProgress = smooth(smoothProgress, targetProgress, k, dt);
    const targetFrame = progressToFrame(smoothProgress, config.frames.count);
    const direction = targetFrame - lastTargetFrame;

    if (targetFrame !== lastTargetFrame) {
      store.reconcile(targetFrame, direction);
      lastTargetFrame = targetFrame;
    }

    const found = store.nearest(targetFrame, direction);
    if (found && found.index !== lastDrawnIndex) {
      drawCover(context, found.bitmap);
      lastSource = found.bitmap;
      lastDrawnIndex = found.index;
      if (!posterHidden) {
        poster.classList.add('is-hidden');
        loader.hidden = true;
        posterHidden = true;
      }
    }

    updateOverlays(overlayNodes, raw);
    updateProgressBar();

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

async function loadScrubVideo(config) {
  const response = await fetch(config.video.src);
  if (!response.ok) throw new Error('Video request failed: HTTP ' + response.status);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(objectUrl);
  };
  addEventListener('pagehide', revoke, { once: true });
  scrubVideo.src = objectUrl;
  try {
    await new Promise((resolve, reject) => {
      const loaded = () => {
        scrubVideo.removeEventListener('error', failed);
        resolve();
      };
      const failed = () => {
        scrubVideo.removeEventListener('loadedmetadata', loaded);
        reject(new Error('Scrub video failed to load.'));
      };
      if (scrubVideo.readyState >= 1) {
        resolve();
        return;
      }
      scrubVideo.addEventListener('loadedmetadata', loaded, { once: true });
      scrubVideo.addEventListener('error', failed, { once: true });
    });
  } catch (error) {
    revoke();
    throw error;
  }
  return scrubVideo;
}

function installVideoPrime(video) {
  let primed = false;
  let priming = false;
  const cleanup = () => {
    removeEventListener('pointerdown', prime);
    removeEventListener('touchstart', prime);
  };
  const prime = () => {
    if (primed || priming) return;
    priming = true;
    video.play().then(() => {
      video.pause();
      primed = true;
      priming = false;
      cleanup();
    }).catch(() => {
      priming = false;
    });
  };
  addEventListener('pointerdown', prime);
  addEventListener('touchstart', prime, { passive: true });
  addEventListener('pagehide', cleanup, { once: true });
  return cleanup;
}

function runVideoEngine(config, overlayNodes, video) {
  const holds = (config.overlays ?? [])
    .filter((overlay) => overlay.hold)
    .map((overlay) => overlay.at);
  const k = alphaToK(config.scrub.smoothing);
  const linger = config.scrub.linger ?? 0;
  const duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : config.video.duration;
  const epsilon = matchMedia('(pointer: coarse)').matches ? 0.02 : 0.008;
  seekEpsilonDebug = epsilon;
  videoDurationDebug = duration;

  let progressGeometry = {
    width: innerWidth,
    sectionTop: scrub.offsetTop,
    distance: Math.max(1, scrub.offsetHeight - innerHeight),
  };
  const stickyWrapper = scrub.querySelector('.scrub__sticky');
  const preserveProgressGeometry = () => {
    if (Math.abs(innerWidth - progressGeometry.width) >= 1) {
      scrub.style.setProperty('height', config.scrub.heightVh + 'vh');
      progressGeometry = {
        width: innerWidth,
        sectionTop: scrub.offsetTop,
        distance: Math.max(1, scrub.offsetHeight - innerHeight),
      };
    } else {
      scrub.style.setProperty('height', (progressGeometry.distance + innerHeight) + 'px');
    }
    const rect = stickyWrapper.getBoundingClientRect();
    positionAnnotations(
      video.videoWidth,
      video.videoHeight,
      rect.width,
      rect.height,
    );
  };
  addEventListener('resize', preserveProgressGeometry);
  preserveProgressGeometry();
  const readProgress = () => {
    if (Math.abs(innerWidth - progressGeometry.width) >= 1) {
      progressGeometry = {
        width: innerWidth,
        sectionTop: scrub.offsetTop,
        distance: Math.max(1, scrub.offsetHeight - innerHeight),
      };
    }
    return scrollProgress(
      window.scrollY,
      progressGeometry.sectionTop,
      progressGeometry.distance + innerHeight,
      innerHeight,
    );
  };

  let posterHidden = false;
  video.addEventListener('seeked', () => {
    if (posterHidden) return;
    posterHidden = true;
    video.classList.add('is-ready');
    poster.classList.add('is-hidden');
  });

  loader.hidden = true;

  let smoothProgress = 0;
  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    const raw = readProgress();
    scrubProgressDebug = raw;
    const target = lingerEase(applyHolds(raw, holds), linger);
    smoothProgress = smooth(smoothProgress, target, k, dt);
    const time = progressToTime(smoothProgress, duration);
    if (!video.seeking && Math.abs(video.currentTime - time) > epsilon) {
      video.currentTime = time;
    }
    updateOverlays(overlayNodes, raw);
    updateProgressBar();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function start() {
  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotionQuery.addEventListener('change', () => location.reload());
  const reducedMotion = reducedMotionQuery.matches;

  let config;
  let overlayNodes;
  let removeVideoPrime = () => {};
  try {
    const response = await fetch('config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Config request failed: HTTP ' + response.status);
    config = await response.json();

    const { errors, warnings } = validateConfig(config);
    if (errors.length) {
      throw new Error(errors.map((entry) => entry.message).join('\n'));
    }
    if (warnings.length) {
      console.warn('Config warnings: ' + warnings.map((entry) => entry.message).join(' '));
    }

    applyTheme(config);
    if (!reducedMotion && selectScrubMode(config) === 'video') {
      scrubVideo.src = VIDEO_PRIME_SRC;
      scrubVideo.load();
      removeVideoPrime = installVideoPrime(scrubVideo);
    }
    await loadPoster(config);
    const sections = assembleSections(config);
    renderSections({ container: sectionContainer, scrubElement: scrub, outroElement: outro, sections, poster: currentPoster(config) });
    overlayNodes = renderCopy(config);
    await loadFont(config);
    const stickyRect = scrub.querySelector('.scrub__sticky').getBoundingClientRect();
    positionAnnotations(
      poster.naturalWidth,
      poster.naturalHeight,
      stickyRect.width,
      stickyRect.height,
    );
  } catch (error) {
    removeVideoPrime();
    showFatalError(error);
    return;
  }

  if (!scrub.isConnected) return;

  if (reducedMotion) {
    applyReducedMotion(overlayNodes);
    return;
  }

  if (globalThis.Lenis) {
    try {
      new globalThis.Lenis({ autoRaf: true, anchors: true });
    } catch (error) {
      console.warn('Lenis failed to initialize:', error.message);
    }
  }

  if (selectScrubMode(config) === 'video') {
    let video;
    try {
      video = await loadScrubVideo(config);
    } catch (error) {
      removeVideoPrime();
      showFatalError(error);
      return;
    }
    runVideoEngine(config, overlayNodes, video);
  } else {
    runEngine(config, overlayNodes);
  }
}

start();
