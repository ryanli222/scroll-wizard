const clone = (value) => structuredClone(value);

export function currentPoster(config) {
  return config.video?.poster ?? config.frames?.poster;
}

function isLegacy(config) {
  return config.register === undefined && config.archetype === undefined && config.direction === undefined;
}

function cta(config) {
  const outro = config.outro ?? {};
  return {
    type: 'cta',
    headline: outro.headline || config.brand?.name || '',
    ...(outro.body ? { body: outro.body } : {}),
    ...(outro.cta ? { cta: clone(outro.cta) } : {}),
    ...(currentPoster(config) ? { background: currentPoster(config) } : {}),
  };
}

function masthead(config) {
  return {
    type: 'masthead',
    headline: config.brand?.name || '',
    ...(config.brand?.tagline ? { sub: config.brand.tagline } : {}),
    scrollHint: 'Scroll to explore',
  };
}

function legacySections(config) {
  const sections = [];
  if (config.brand?.tagline) {
    sections.push({ type: 'masthead', headline: config.brand?.name || '', sub: config.brand.tagline });
  }
  sections.push({ type: 'scrub-hero' }, cta(config));
  return sections;
}

function overlayRows(config) {
  return (config.overlays ?? []).flatMap((overlay, beat) => (overlay.stats ?? []).map((stat) => ({
    label: stat.label,
    value: stat.value,
    beat,
  })));
}

function galleryItems(config) {
  return (config.overlays ?? []).map((overlay, beat) => ({
    beat,
    alt: overlay.title || `Story beat ${beat + 1}`,
  }));
}

function modeSections(config) {
  const teardown = config.register === 'product' || config.archetype === 'teardown';
  const sections = [masthead(config), { type: 'scrub-hero' }];
  const poster = currentPoster(config);
  if (teardown) {
    const rows = overlayRows(config);
    const items = galleryItems(config);
    if (rows.length) sections.push({ type: 'spec', rows });
    if (items.length) sections.push({ type: 'gallery', items });
  } else {
    const overlays = config.overlays ?? [];
    const source = overlays[1] ?? overlays[0] ?? {};
    sections.push({
      type: 'statement',
      text: config.brand?.tagline || overlays[0]?.title || config.brand?.name || '',
    });
    sections.push({
      type: 'feature-split',
      headline: source.title || config.brand?.name || '',
      ...(source.body ? { body: source.body } : {}),
      side: 'right',
      media: { kind: 'image', src: poster, alt: config.brand?.imageAlt || config.brand?.name || 'Feature image' },
    });
  }
  sections.push(cta(config));
  return sections;
}

export function assembleSections(config) {
  if (Object.hasOwn(config, 'sections')) return clone(config.sections);
  return isLegacy(config) ? legacySections(config) : modeSections(config);
}