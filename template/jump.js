import { jumpDuration } from './scrub-core.js';
export function easeInOutCubic(t) { return t < .5 ? 4*t*t*t : 1 - ((-2*t+2) ** 3) / 2; }
const interrupts=['wheel','touchstart','keydown'];
export function createJump({ lenis, win=globalThis, reducedMotion=false, tuning={} }) { let active=false; const settle=()=>{active=false;interrupts.forEach((type)=>win.removeEventListener(type,onInterrupt));}; const cancel=()=>{if(!active)return;settle();lenis.scrollTo(win.scrollY,{immediate:true});}; const onInterrupt=()=>cancel(); const toY=(targetY)=>{if(reducedMotion||!lenis){win.scrollTo(0,targetY);return;} if(!active){active=true;
  // Deferred so the same physical event that triggers toY() (e.g. a caller's own
  // keydown handler) can finish bubbling to window before it becomes an interrupt.
  queueMicrotask(()=>{if(active)interrupts.forEach((type)=>win.addEventListener(type,onInterrupt,{passive:true}));});} lenis.scrollTo(targetY,{duration:jumpDuration(targetY-win.scrollY,tuning)/1000,easing:easeInOutCubic,onComplete:settle});}; return {toY,cancel,get active(){return active;}}; }