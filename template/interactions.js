import { beatTargetY } from './scrub-core.js';
import { createJump } from './jump.js';

function button(className, label) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}

function activate(node, fn) {
  node.addEventListener('click', fn);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fn();
    }
  });
}

function beatY(config, scrub, index) {
  return beatTargetY(config.overlays[index].at, scrub.offsetTop, scrub.offsetHeight, innerHeight);
}

function nav(deps, jump) {
  const labelled = deps.sections
    .map((data, index) => ({ data, node: deps.sectionNodes[index], index }))
    .filter(({ data, node }) => data.navLabel && node?.isConnected);
  if (!labelled.length) return;
  const el = document.createElement('nav');
  el.id = 'site-nav';
  el.className = 'site-nav';
  el.setAttribute('aria-label', 'Sections');
  for (const item of labelled) {
    const pill = button('site-nav__pill', item.data.navLabel);
    pill.dataset.targetIndex = item.index;
    pill.addEventListener('click', () => jump.toY(item.node.offsetTop));
    el.append(pill);
  }
  document.body.append(el);
}

function stepper(deps, jump) {
  if (deps.config.register !== 'full3d' || !deps.config.overlays?.length || !deps.scrubElement.isConnected) return;
  const el = button('waypoint-stepper');
  el.id = 'waypoint-stepper';
  el.setAttribute('aria-label', 'Next waypoint');
  el.addEventListener('click', () => {
    const targets = deps.config.overlays.map((_, index) => beatY(deps.config, deps.scrubElement, index));
    const next = targets.find((y) => y > scrollY + 4) ?? beatY(deps.config, deps.scrubElement, 0);
    jump.toY(next);
  });
  document.body.append(el);
}

function hotspots(deps, jump) {
  if (!deps.scrubElement.isConnected) return;
  for (const hotspot of deps.config.hotspots ?? []) {
    const el = button('hotspot');
    el.dataset.point = JSON.stringify(hotspot.point);
    el.dataset.target = hotspot.target;
    el.setAttribute('aria-label', hotspot.label);
    el.addEventListener('click', () => jump.toY(beatY(deps.config, deps.scrubElement, hotspot.target)));
    deps.overlayLayer.append(el);
  }
}

function specs(deps, jump) {
  if (!deps.scrubElement.isConnected) return;
  for (const sectionNode of deps.sectionNodes) {
    for (const row of sectionNode.querySelectorAll('.section-spec__row[data-beat]')) {
      const go = () => jump.toY(beatY(deps.config, deps.scrubElement, Number(row.dataset.beat)));
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.setAttribute('aria-label', 'Scrub to ' + row.querySelector('dt').textContent);
      activate(row, go);
    }
  }
}

function gallery(deps, jump) {
  const items = deps.sectionNodes.flatMap((node) => [...node.querySelectorAll('.section-gallery__item')]);
  if (!items.length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  const image = document.createElement('img');
  image.className = 'lightbox__image';
  const jumpButton = button('lightbox__jump', 'View this moment');
  const close = button('lightbox__close', 'Close');
  dialog.append(image, jumpButton, close);
  close.addEventListener('click', () => dialog.close());
  document.body.append(dialog);

  let activeBeat;
  jumpButton.addEventListener('click', () => {
    dialog.close();
    if (activeBeat !== undefined && deps.scrubElement.isConnected) {
      jump.toY(beatY(deps.config, deps.scrubElement, activeBeat));
    }
  });

  for (const item of items) {
    const figure = item.querySelector('figure');
    const trigger = button('section-gallery__button');
    item.insertBefore(trigger, figure);
    trigger.append(figure);
    trigger.addEventListener('click', () => {
      const source = trigger.querySelector('img');
      image.src = source.src;
      image.alt = source.alt;
      activeBeat = item.dataset.beat === undefined ? undefined : Number(item.dataset.beat);
      jumpButton.hidden = activeBeat === undefined || !deps.scrubElement.isConnected;
      dialog.showModal();
    });
  }
}

function picker(deps) {
  const options = deps.config.config?.options;
  if (!options?.length || deps.config.register === 'full3d' || !deps.scrubElement.isConnected) return;

  const tint = document.getElementById('scrub-tint');
  const group = document.createElement('div');
  group.className = 'config-picker';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Configurations');

  const choices = [];
  for (const option of options) {
    const chip = button('config-picker__option', option.label);
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', 'false');
    chip.addEventListener('click', () => {
      for (const other of choices) other.setAttribute('aria-checked', 'false');
      chip.setAttribute('aria-checked', 'true');
      if (option.tint) {
        tint.style.backgroundColor = option.tint;
        tint.classList.add('is-active');
      } else {
        tint.classList.remove('is-active');
      }
      if (option.poster) document.getElementById('poster').src = option.poster;
      if (option.src && deps.config.video?.src) document.getElementById('scrub-video').src = option.src;
    });
    choices.push(chip);
    group.append(chip);
  }
  deps.scrubElement.querySelector('.scrub__sticky').append(group);
}

function email(forms) {
  for (const form of forms) {
    form.addEventListener('submit', (event) => {
      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
        return;
      }
      if (form.dataset.wired !== 'inline') return;
      event.preventDefault();
      if (form.querySelector('.section-email__done')) return;
      const done = document.createElement('p');
      done.className = 'section-email__done';
      done.setAttribute('role', 'status');
      done.textContent = "Thanks — you're on the list.";
      form.append(done);
      form.querySelector('.section-email__submit').disabled = true;
    });
  }
}

export function installInteractions(deps) {
  const jump = createJump({
    lenis: deps.lenis, reducedMotion: deps.reducedMotion, tuning: deps.config.scrub?.jump ?? {},
  });
  nav(deps, jump);
  stepper(deps, jump);
  hotspots(deps, jump);
  specs(deps, jump);
  gallery(deps, jump);
  picker(deps);
  email(deps.formNodes);
  return { jump };
}
