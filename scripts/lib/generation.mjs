const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

function count(value, name) {
  const normalized = value ?? 0;
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(name + ' must be a non-negative integer.');
  }
  return normalized;
}

export function recommendBeatCount(input = {}) {
  const claimCount = count(input.claimCount, 'claimCount');
  const sectionCount = count(input.sectionCount, 'sectionCount');
  const catalogItems = count(input.catalogItems, 'catalogItems');
  const density = Math.max(claimCount, sectionCount)
    + (input.hasProcess ? 1 : 0)
    + Math.min(2, Math.ceil(catalogItems / 6));

  if (density <= 2) return 3;
  if (density <= 5) return 5;
  if (density <= 7) return 7;
  return clamp(density, 8, 10);
}

export function estimateRouteCost(rateMicrosPerSecond, durationSeconds) {
  if (!Number.isInteger(rateMicrosPerSecond) || rateMicrosPerSecond < 0) {
    throw new Error('rateMicrosPerSecond must be a non-negative integer.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('durationSeconds must be positive.');
  }
  return Math.ceil(rateMicrosPerSecond * durationSeconds);
}

function exclusionReasons(route, requirements) {
  const reasons = [];
  if (!route.available) reasons.push('unavailable');
  if (requirements.preset === 'free' && route.costMicros > 0) {
    reasons.push('paid-on-free');
  } else if (route.costMicros > requirements.budgetMicros) {
    reasons.push('over-budget');
  }
  if (
    !route.noVideo
    && requirements.duration
    && !route.durations?.includes(requirements.duration)
  ) {
    reasons.push('duration');
  }
  if (
    !route.noVideo
    && requirements.resolution
    && !route.resolutions?.includes(requirements.resolution)
  ) {
    reasons.push('resolution');
  }
  if (
    !route.noVideo
    && requirements.firstLast
    && !(route.firstFrame && route.lastFrame)
  ) {
    reasons.push('first-last');
  }
  if (
    !route.noVideo
    && requirements.referenceCount > (route.maxReferences ?? 0)
  ) {
    reasons.push('references');
  }
  return reasons;
}

export function filterProviderRoutes(routes, requirements) {
  const eligible = [];
  const excluded = [];
  for (const route of routes) {
    const reasons = exclusionReasons(route, requirements);
    if (reasons.length) excluded.push({ id: route.id, reasons });
    else eligible.push(route);
  }
  return { eligible, excluded };
}

export function rankProviderRoutes(routes, preset) {
  const score = (route) => {
    if (preset === 'free' || preset === 'cheapest') return -route.costMicros;
    if (preset === 'quality-first') return route.quality * 1e9 - route.costMicros;
    return route.quality * 1e8 + route.speed * 1e7
      + (route.firstFrame ? 1e6 : 0)
      + (route.lastFrame ? 1e6 : 0)
      + (route.maxReferences ?? 0) * 1e5
      - route.costMicros;
  };
  return [...routes].sort((left, right) =>
    score(right) - score(left)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
