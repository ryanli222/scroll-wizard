import {
  alphaToK,
  applyHolds,
  canvasSize,
  childRevealRange,
  coverRect,
  decodeWindow,
  frameFilename,
  lingerEase,
  overlayOpacity,
  progressToFrame,
  progressToTime,
  scrollProgress,
  selectScrubMode,
  smooth,
  validateConfig,
} from './scrub-core.js';

const scrub = document.getElementById('scrub');
const poster = document.getElementById('poster');
const scrubVideo = document.getElementById('scrub-video');
const canvas = document.getElementById('scrub-canvas');
const overlayLayer = document.getElementById('overlay-layer');
const loadProgress = document.getElementById('load-progress');
const loader = document.getElementById('loader');
const outro = document.getElementById('outro');
const processSection = document.getElementById('process');
const fatalError = document.getElementById('fatal-error');
const footerBrand = document.getElementById('footer-brand');
const progressBar = document.getElementById('progress-bar');

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

const STAGGER_ROLES = [
  ['title', 0],
  ['body', 0.12],
  ['stats', 0.24],
  ['cta', 0.36],
];

function renderOverlay(data, index) {
  const panel = element(
    'article',
    'overlay overlay--' + (data.position ?? 'center'),
  );
  panel.dataset.overlayIndex = String(index);
  panel.inert = true;
  const fields = {};
  if (data.title) fields.title = element('h2', 'overlay__title', data.title);
  if (data.body) fields.body = element('p', 'overlay__body', data.body);
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
    fields.stats = list;
  }
  if (data.cta) fields.cta = linkButton(data.cta, 'overlay__cta');
  for (const field of Object.values(fields)) panel.append(field);
  return { node: panel, fields };
}

function renderOutro(data) {
  if (!data) return;
  outro.hidden = false;
  if (data.headline) outro.append(element('h1', 'outro__headline', data.headline));
  if (data.body) outro.append(element('p', 'outro__body', data.body));
  if (data.cta) outro.append(linkButton(data.cta, 'outro__cta'));
}

function renderProcess(config) {
  if (!config.process) return;
  const steps = config.process.steps.map((step, index) => {
    const article = element('article', 'step');
    article.dataset.reveal = '';
    article.style.setProperty('--i', String(index));
    article.append(element('h3', 'step__title', step.title));
    article.append(element('p', 'step__body', step.body));
    return article;
  });
  processSection.append(...steps);
  processSection.hidden = false;
}

function initScrollReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.25 });
  targets.forEach((target) => observer.observe(target));
}

function applyTheme(config) {
  const theme = config.theme;
  const root = document.documentElement.style;
  root.setProperty('--bg', theme.bg);
  root.setProperty('--text', theme.text);
  root.setProperty('--accent', theme.accent);
  root.setProperty('--surface', theme.surface);
  root.setProperty('--radius', theme.radius + 'px');
  if (theme.fonts?.display) root.setProperty('--display', theme.fonts.display);
  if (theme.fonts?.body) root.setProperty('--body', theme.fonts.body);
  scrub.style.setProperty('height', config.scrub.heightVh + 'vh');
}

function renderCopy(config) {
  const overlayNodes = (config.overlays ?? []).map((data, index) => {
    const { node, fields } = renderOverlay(data, index);
    overlayLayer.append(node);
    return { data, node, fields };
  });
  renderOutro(config.outro);
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
  for (const { node } of overlayNodes) {
    node.inert = false;
    node.style.opacity = '1';
    node.style.pointerEvents = '';
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
  for (const { data, node, fields } of overlayNodes) {
    const opacity = overlayOpacity(raw, data.at);
    const visible = opacity >= 0.05;
    node.inert = !visible;
    node.style.setProperty('--reveal', String(opacity));
    // ponytail: CTA pointer-events follow the overlay's overall visibility,
    // not its own later-staggered fade-in start — a brief early-clickable
    // window while the CTA is still fading in. Fine for a decorative CTA;
    // revisit with a per-child pointer-events gate if it ever matters.
    node.style.pointerEvents = visible ? 'auto' : 'none';
    for (const [role, offsetFraction] of STAGGER_ROLES) {
      const field = fields[role];
      if (!field) continue;
      const childOpacity = overlayOpacity(raw, childRevealRange(data.at, offsetFraction));
      field.style.setProperty('--reveal', String(childOpacity));
    }
  }
}

function initParallax(config) {
  if (config.scrub?.parallax !== true) return [];
  const container = document.querySelector('.parallax-layers');
  container.hidden = false;
  return [...container.querySelectorAll('.parallax-layer')].map((node) => ({
    node,
    rate: Number(node.dataset.rate) || 0,
  }));
}

function updateParallax(layers, raw) {
  for (const { node, rate } of layers) {
    node.style.setProperty('--parallax', String(raw * rate));
  }
}

function initCursorAccent(config) {
  if (config.scrub?.cursorAccent !== true) return;
  const container = document.getElementById('cursor-accent');
  container.hidden = false;
  const dots = [...container.querySelectorAll('.cursor-accent__dot')].map((node, index) => ({
    node,
    x: 0,
    y: 0,
    offsetX: (index - 1.5) * 14,
    offsetY: (index % 2 === 0 ? -1 : 1) * 10,
  }));
  const coarse = matchMedia('(pointer: coarse)').matches;
  let pointerX = innerWidth / 2;
  let pointerY = innerHeight / 2;
  if (!coarse) {
    addEventListener('pointermove', (event) => {
      const rect = scrub.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
    });
  }
  const k = alphaToK(0.2);
  let lastTime = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    for (const dot of dots) {
      const targetX = coarse
        ? innerWidth / 2 + Math.sin(now / 1400 + dot.offsetX) * 60 + dot.offsetX
        : pointerX + dot.offsetX;
      const targetY = coarse
        ? innerHeight / 2 + Math.cos(now / 1700 + dot.offsetY) * 60 + dot.offsetY
        : pointerY + dot.offsetY;
      dot.x = smooth(dot.x, targetX, k, dt);
      dot.y = smooth(dot.y, targetY, k, dt);
      dot.node.style.transform = 'translate(' + dot.x + 'px, ' + dot.y + 'px)';
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function updateProgressBar() {
  const pageProgress = Math.min(1, Math.max(0,
    scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)));
  progressBar.style.width = (pageProgress * 100) + '%';
}

function runEngine(config, overlayNodes, parallaxLayers) {
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
  }
  new ResizeObserver(handleResize).observe(stickyWrapper);
  resizeCanvas(canvas);

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
    updateParallax(parallaxLayers, raw);
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

function runVideoEngine(config, overlayNodes, video, parallaxLayers) {
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
  const preserveProgressGeometry = () => {
    if (Math.abs(innerWidth - progressGeometry.width) >= 1) {
      scrub.style.setProperty('height', config.scrub.heightVh + 'vh');
      progressGeometry = {
        width: innerWidth,
        sectionTop: scrub.offsetTop,
        distance: Math.max(1, scrub.offsetHeight - innerHeight),
      };
      return;
    }
    scrub.style.setProperty('height', (progressGeometry.distance + innerHeight) + 'px');
  };
  addEventListener('resize', preserveProgressGeometry);
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
    updateParallax(parallaxLayers, raw);
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
    overlayNodes = renderCopy(config);
    renderProcess(config);
    initScrollReveal();
    await loadFont(config);
  } catch (error) {
    removeVideoPrime();
    showFatalError(error);
    return;
  }

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

  const parallaxLayers = initParallax(config);
  initCursorAccent(config);

  if (selectScrubMode(config) === 'video') {
    let video;
    try {
      video = await loadScrubVideo(config);
    } catch (error) {
      removeVideoPrime();
      showFatalError(error);
      return;
    }
    runVideoEngine(config, overlayNodes, video, parallaxLayers);
  } else {
    runEngine(config, overlayNodes, parallaxLayers);
  }
}

start();
