import { jumpDuration } from './scrub-core.js';
export function easeInOutCubic(t) { return t < .5 ? 4*t*t*t : 1 - ((-2*t+2) ** 3) / 2; }
const interrupts=['wheel','touchstart','keydown'];
export function createJump({ lenis, win=globalThis, reducedMotion=false, tuning={} }) { let active=false; const settle=()=>{active=false;interrupts.forEach((type)=>win.removeEventListener(type,onInterrupt));};
  // A caller's own Enter/Space activation (e.g. a spec row) preventDefault()s its
  // triggering keydown before calling toY(); that same event then bubbles to this
  // window listener. Skip it — it was already consumed by an in-app control, not a
  // free navigation keypress that should hand control back to native scroll. This
  // also covers redirecting an already-active jump (a second toY()), since the
  // window listener from the first jump is already attached when the redirecting
  // keydown fires.
  const onInterrupt=(event)=>{if(event?.defaultPrevented)return;cancel();}; const cancel=()=>{if(!active)return;settle();lenis.scrollTo(win.scrollY,{immediate:true});}; const toY=(targetY)=>{if(reducedMotion||!lenis){win.scrollTo(0,targetY);return;} if(!active){active=true;interrupts.forEach((type)=>win.addEventListener(type,onInterrupt,{passive:true}));} lenis.scrollTo(targetY,{duration:jumpDuration(targetY-win.scrollY,tuning)/1000,easing:easeInOutCubic,onComplete:settle});}; return {toY,cancel,get active(){return active;}}; }