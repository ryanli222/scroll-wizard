function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = String(text);
  return result;
}

function section(type, index) {
  const result = node('section', 'site-section site-section--' + type);
  result.dataset.section = type;
  result.dataset.sectionIndex = String(index);
  return result;
}

function image(src, alt, className) {
  const result = node('img', className);
  result.src = src;
  result.alt = alt;
  result.loading = 'lazy';
  result.decoding = 'async';
  return result;
}

function link(cta) {
  const result = node('a', 'section-cta', cta.label);
  result.href = cta.href;
  return result;
}

function inner(...children) {
  const result = node('div', 'site-section__inner section-reveal');
  result.append(...children.filter(Boolean));
  return result;
}

function buildMasthead(data, index) {
  const result = section(data.type, index);
  const header = node('header', 'section-masthead');
  if (data.eyebrow) header.append(node('p', 'section-eyebrow', data.eyebrow));
  header.append(node('h1', 'section-title', data.headline));
  if (data.sub) header.append(node('p', 'section-copy', data.sub));
  if (data.scrollHint) header.append(node('p', 'section-hint', data.scrollHint));
  result.append(inner(header));
  return result;
}

function buildFeature(data, index) {
  const result = section(data.type, index);
  result.dataset.side = data.side ?? 'left';
  const figure = node('figure', 'section-feature__media');
  if (data.media.kind === 'video') {
    const video = node('video', 'section-feature__video');
    video.src = data.media.src; video.muted = true; video.playsInline = true; video.loop = true;
    video.setAttribute('aria-label', data.media.alt);
    figure.append(video);
  } else figure.append(image(data.media.src, data.media.alt, 'section-feature__image'));
  const copy = node('div', 'section-feature__copy');
  copy.append(node('h2', 'section-title', data.headline));
  if (data.body) copy.append(node('p', 'section-copy', data.body));
  result.append(inner(copy, figure));
  return result;
}

function buildStatement(data, index) {
  const result = section(data.type, index);
  result.append(inner(node('blockquote', 'section-statement', data.text)));
  return result;
}

function buildSpec(data, index) {
  const result = section(data.type, index);
  const content = node('div', 'section-spec');
  if (data.headline) content.append(node('h2', 'section-title', data.headline));
  const list = node('dl', 'section-spec__list');
  for (const row of data.rows) {
    const group = node('div', 'section-spec__row');
    if (row.beat !== undefined) group.dataset.beat = String(row.beat);
    group.append(node('dt', '', row.label), node('dd', '', row.value));
    list.append(group);
  }
  content.append(list); result.append(inner(content)); return result;
}

function buildGallery(data, index, poster) {
  const result = section(data.type, index);
  const content = node('div', 'section-gallery');
  if (data.headline) content.append(node('h2', 'section-title', data.headline));
  const list = node('ul', 'section-gallery__list');
  for (const item of data.items) {
    const entry = node('li', 'section-gallery__item');
    if (item.beat !== undefined) entry.dataset.beat = String(item.beat);
    const figure = node('figure', 'section-gallery__figure');
    figure.append(image(item.src ?? poster, item.alt ?? 'Story beat', 'section-gallery__image'));
    entry.append(figure); list.append(entry);
  }
  content.append(list); result.append(inner(content)); return result;
}

function buildCta(data, index, outro, formNodes) {
  const result = outro;
  result.replaceChildren(); result.className = 'site-section site-section--cta outro';
  result.dataset.section = 'cta'; result.dataset.sectionIndex = String(index);
  if (data.background) result.style.setProperty('--cta-background', `url("${data.background}")`);
  const content = node('div', 'site-section__inner section-reveal');
  content.append(node('span', 'section-accent-rule'), node('h2', 'section-title', data.headline));
  if (data.body) content.append(node('p', 'section-copy', data.body));
  if (data.cta) content.append(link(data.cta));
  if (data.emailCapture) {
    const form = node('form', 'section-email'); form.noValidate = false;
    const label = node('label', '', 'Email address');
    const input = node('input'); input.type = 'email'; input.required = true; input.name = 'email';
    const submit = node('button', 'section-email__submit', 'Keep me posted'); submit.type = 'submit';
    label.append(input); form.append(label, submit); form.addEventListener('submit', (event) => event.preventDefault());
    content.append(form); formNodes.push(form);
  }
  result.append(content); return result;
}

export function renderSections({ container, scrubElement, outroElement, sections, poster }) {
  const sectionNodes = []; const formNodes = [];
  scrubElement.remove(); outroElement.remove(); container.replaceChildren();
  sections.forEach((data, index) => {
    let result;
    if (data.type === 'scrub-hero') { scrubElement.dataset.section = 'scrub-hero'; scrubElement.dataset.sectionIndex = String(index); result = scrubElement; }
    else if (data.type === 'masthead') result = buildMasthead(data, index);
    else if (data.type === 'feature-split') result = buildFeature(data, index);
    else if (data.type === 'statement') result = buildStatement(data, index);
    else if (data.type === 'spec') result = buildSpec(data, index);
    else if (data.type === 'gallery') result = buildGallery(data, index, poster);
    else if (data.type === 'cta') result = buildCta(data, index, outroElement, formNodes);
    if (result) { container.append(result); sectionNodes.push(result); }
  });
  return { sectionNodes, formNodes };
}