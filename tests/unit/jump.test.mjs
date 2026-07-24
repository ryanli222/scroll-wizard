import { describe, expect, it, vi } from 'vitest';
import { createJump, easeInOutCubic } from '../../template/jump.js';

function fakeWin() {
  const listeners = new Map();
  return {
    scrollY: 0,
    scrollTo(_x, y) { this.scrollY = y; },
    addEventListener: vi.fn((type, fn) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
    fire: (type, event = {}) => listeners.get(type)?.(event),
    listeners,
  };
}

describe('cinematic jump', () => {
  it('uses lenis seconds duration and easing', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    expect(lenis.scrollTo).toHaveBeenCalledWith(2200, expect.objectContaining({ duration: 1, easing: easeInOutCubic }));
    expect(jump.active).toBe(true);
  });

  it('cancels on manual input and is instant under reduced motion', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    win.scrollY = 70;
    win.fire('wheel');
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(70, { immediate: true });
    expect(jump.active).toBe(false);
    const instant = createJump({ lenis, win, reducedMotion: true });
    instant.toY(900);
    expect(win.scrollY).toBe(900);
  });

  it('does not self-cancel on a keydown already consumed by an in-app activation (e.g. spec-row Enter)', () => {
    // Mirrors template/interactions.js's activate(): the caller preventDefault()s
    // its own triggering keydown before calling toY(). That event still bubbles to
    // window afterward and must not be treated as a free-navigation interrupt.
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    win.fire('keydown', { defaultPrevented: true });
    expect(jump.active).toBe(true);
    expect(lenis.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('does not self-cancel when a keydown redirects an already-active jump', () => {
    // The window interrupt listener from the FIRST toY() is already attached when
    // a second, keyboard-triggered toY() redirects it; that listener must also
    // respect defaultPrevented, not just a fresh idle->active transition.
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    jump.toY(400);
    win.fire('keydown', { defaultPrevented: true });
    expect(jump.active).toBe(true);
    expect(lenis.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('still cancels an in-flight jump on a genuine, unhandled keydown', () => {
    const win = fakeWin();
    const lenis = { scrollTo: vi.fn() };
    const jump = createJump({ lenis, win });
    jump.toY(2200);
    win.scrollY = 300;
    win.fire('keydown', { defaultPrevented: false });
    expect(jump.active).toBe(false);
    expect(lenis.scrollTo).toHaveBeenLastCalledWith(300, { immediate: true });
  });

  it('has standard cubic endpoints', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(.5)).toBe(.5);
    expect(easeInOutCubic(1)).toBe(1);
  });
});
