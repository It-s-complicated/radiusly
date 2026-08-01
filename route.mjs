const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const STATION_RADIUS_METERS = 250;
const MAX_REPEAT_RATIO = 0.05;
const MAX_REPEAT_RUN_METERS = 210;
const MAX_STATION_REPEAT_METERS = 100;
const MAX_ORBIT_STEM_METERS = 500;

export function targetKilometers(mode, value, pace) {
  return mode === "time" ? (value * pace) / 60 : value;
}

export function pointAt([lat, lng], distanceKm, bearingDegrees) {
  const radius = 6371;
  const angularDistance = distanceKm / radius;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lng * Math.PI) / 180;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
    );

  return [(nextLatitude * 180) / Math.PI, (nextLongitude * 180) / Math.PI];
}

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function irregularPoint(center, radius, bearing, seed) {
  const distanceScale = 0.72 + seededUnit(seed) * 0.56;
  const angleJitter = (seededUnit(seed + 19) - 0.5) * 36;
  return pointAt(center, radius * distanceScale, bearing + angleJitter);
}

function angleFrom(center, [lat, lng]) {
  const latitudeScale = Math.cos((center[0] * Math.PI) / 180);
  const degrees =
    (Math.atan2((lng - center[1]) * latitudeScale, lat - center[0]) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function orderAround(center, points, startBearing) {
  return points.sort(
    (a, b) =>
      (angleFrom(center, a) - startBearing + 360) % 360 -
      ((angleFrom(center, b) - startBearing + 360) % 360),
  );
}

export function loopPoints(
  start,
  targetKm,
  bearing = 25,
  favorites = [],
  scale = 1,
  algorithm = "organic",
) {
  if (algorithm === "tangent") {
    const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.9 * scale);
    const center = pointAt(start, radius, bearing);
    const startBearing = (bearing + 180) % 360;
    const perimeter = [90, 180, 270].map((offset) =>
      pointAt(center, radius, startBearing + offset),
    );
    return [start, ...orderAround(center, [...favorites, ...perimeter], startBearing), start];
  }

  if (algorithm === "orbit-same" || algorithm === "orbit-near") {
    const radius = Math.max(0.18, (targetKm / (2 + 2 * Math.PI)) * 0.9 * scale);
    const gap = algorithm === "orbit-near" ? 9 : 0;
    const outboundBearing = bearing - gap;
    const inboundBearing = bearing + gap;
    const outbound = pointAt(start, radius, outboundBearing);
    const inbound = pointAt(start, radius, inboundBearing);
    const perimeter = [90, 180, 270].map((offset) => pointAt(start, radius, bearing + offset));
    return [
      start,
      outbound,
      ...orderAround(start, [...favorites, ...perimeter], outboundBearing),
      inbound,
      start,
    ];
  }

  if (algorithm === "spaghetti") {
    const patterns = [
      [168, 48, 228, 108],
      [144, 288, 72, 216],
      [108, 276, 72, 228],
    ];
    const pattern =
      patterns[((Math.round(bearing) % patterns.length) + patterns.length) % patterns.length];
    const radius = Math.max(0.18, (targetKm / 11.5) * 0.9 * scale);
    const centerBearing = bearing + (seededUnit(bearing + 7) - 0.5) * 28;
    const centerDistance = radius * (0.8 + seededUnit(bearing + 11) * 0.35);
    const center = pointAt(start, centerDistance, centerBearing);
    const startBearing = centerBearing + 180;
    const detours = pattern.map((offset, index) =>
      irregularPoint(center, radius, startBearing + offset, bearing + index * 31),
    );
    return [start, detours[0], ...favorites, ...detours.slice(1), start];
  }

  if (algorithm === "spaghetti-cross") {
    const radius = Math.max(0.18, (targetKm / 8) * 0.9 * scale);
    const centerBearing = bearing + (seededUnit(bearing + 23) - 0.5) * 24;
    const centerDistance = radius * (0.82 + seededUnit(bearing + 29) * 0.3);
    const center = pointAt(start, centerDistance, centerBearing);
    const startBearing = centerBearing + 180;
    const detours = [180, 90, 270].map((offset, index) =>
      irregularPoint(center, radius, startBearing + offset, bearing + index * 43),
    );
    return [start, detours[0], ...favorites, ...detours.slice(1), start];
  }

  if (algorithm === "spaghetti-safe") {
    const radius = Math.max(0.18, (targetKm / 8) * 0.9 * scale);
    const center = pointAt(start, radius, bearing);
    const startBearing = bearing + 180;
    const detours = [180, 90, 270].map((offset) =>
      pointAt(center, radius, startBearing + offset),
    );
    return [start, detours[0], ...favorites, ...detours.slice(1), start];
  }

  const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.87 * scale);
  const detours = [0, 120, 240].map((offset) => pointAt(start, radius, bearing + offset));
  const points = orderAround(start, [...favorites, ...detours], 180);
  return [start, ...points, start];
}

export async function walkingRoute(points) {
  const coordinates = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const response = await fetch(
    `${ROUTER}${coordinates}?overview=full&geometries=geojson&steps=false`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error(`Routing failed (${response.status})`);

  const data = await response.json();
  if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("No walkable loop found");

  return data.routes[0];
}

function distance([lng1, lat1], [lng2, lat2]) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitude = toRadians(lat2 - lat1);
  const longitude = toRadians(lng2 - lng1);
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(longitude / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(a));
}

function segmentKey(from, to) {
  return [from, to]
    .map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
    .sort()
    .join(";");
}

export function pathRepetition(coordinates) {
  const seen = new Set();
  let total = 0;
  let repeated = 0;
  let repeatedRun = 0;
  let longestRepeatedRun = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    const key = segmentKey(from, to);
    const length = distance(from, to);
    total += length;
    if (seen.has(key)) {
      repeated += length;
      repeatedRun += length;
      longestRepeatedRun = Math.max(longestRepeatedRun, repeatedRun);
    } else {
      repeatedRun = 0;
    }
    seen.add(key);
  }

  return {
    repeatRatio: total ? repeated / total : 0,
    repeatedDistance: repeated,
    longestRepeatRatio: total ? longestRepeatedRun / total : 0,
    longestRepeatDistance: longestRepeatedRun,
  };
}

export function stationRepeatedDistance(coordinates, stations) {
  const seen = new Set();
  let repeated = 0;

  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    const key = segmentKey(from, to);
    const midpoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    if (
      seen.has(key) &&
      stations.some(({ coordinates: station }) =>
        distance(midpoint, station) <= STATION_RADIUS_METERS,
      )
    ) {
      repeated += distance(from, to);
    }
    seen.add(key);
  }

  return repeated;
}

export function repeatedPathRatio(coordinates) {
  return pathRepetition(coordinates).repeatRatio;
}

export function scoreRoute(route, targetKm) {
  const distanceErrorDistance = Math.abs(route.distance - targetKm * 1000);
  const distanceError = distanceErrorDistance / (targetKm * 1000);
  const repetition = pathRepetition(route.geometry.coordinates);
  return {
    distanceError,
    distanceErrorDistance,
    ...repetition,
    score: distanceError + repetition.repeatRatio * 2 + repetition.longestRepeatRatio * 4,
  };
}

function backtrackingIsAcceptable(route) {
  const maxRepeatRun =
    route.candidate?.algorithm === "spaghetti-cross" ||
    route.candidate?.algorithm === "spaghetti-safe"
      ? 260
      : MAX_REPEAT_RUN_METERS;
  return (
    route.stationRepeatDistance <= MAX_STATION_REPEAT_METERS &&
    (route.candidate?.algorithm === "orbit-same" ||
      (route.repeatRatio <= MAX_REPEAT_RATIO &&
        route.longestRepeatDistance <= maxRepeatRun))
  );
}

export function routeIsAcceptable(route) {
  return (
    route.distanceError <= 0.25 &&
    backtrackingIsAcceptable({ stationRepeatDistance: 0, ...route })
  );
}

export function needsMoreCandidates(route, algorithm) {
  return (
    !routeIsAcceptable(route) ||
    (algorithm === "orbit-same" && route.longestRepeatDistance > MAX_ORBIT_STEM_METERS)
  );
}

export function compareRoutes(a, b) {
  const aIsAcceptable = routeIsAcceptable(a);
  const bIsAcceptable = routeIsAcceptable(b);
  if (aIsAcceptable !== bIsAcceptable) return aIsAcceptable ? -1 : 1;
  if (aIsAcceptable) {
    const penalty = ({
      distanceErrorDistance,
      repeatedDistance,
      longestRepeatDistance,
      stationRepeatDistance = 0,
    }) =>
      distanceErrorDistance +
      repeatedDistance +
      longestRepeatDistance * 2 +
      stationRepeatDistance * 4;
    return penalty(a) - penalty(b);
  }
  return a.score - b.score;
}

async function stationData(routes) {
  const coordinates = routes.flatMap(({ geometry }) => geometry.coordinates);
  const lngs = coordinates.map(([lng]) => lng);
  const lats = coordinates.map(([, lat]) => lat);
  const bbox = [
    Math.min(...lats) - 0.005,
    Math.min(...lngs) - 0.005,
    Math.max(...lats) + 0.005,
    Math.max(...lngs) + 0.005,
  ].join(",");
  const query = `[out:json][timeout:10];node["railway"="station"](${bbox});out;`;

  try {
    const response = await fetch(`${OVERPASS}?data=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error();
    const { elements } = await response.json();
    return {
      available: true,
      stations: elements
        .map(({ center, lat, lon, tags }) => ({
          name: tags?.name,
          coordinates: center ? [center.lon, center.lat] : [lon, lat],
        }))
        .filter(({ coordinates: [lng, lat] }) => Number.isFinite(lng) && Number.isFinite(lat)),
    };
  } catch {
    return { available: false, stations: [] };
  }
}

function applyStationPenalty(route, stations) {
  route.stationRepeatDistance = stationRepeatedDistance(route.geometry.coordinates, stations);
  route.score += (route.stationRepeatDistance / route.distance) * 4;
  return route;
}

async function routeCandidate(
  start,
  targetKm,
  bearing,
  favorites,
  scale,
  stations = [],
  algorithm = "organic",
) {
  const points = loopPoints(start, targetKm, bearing, favorites, scale, algorithm);
  const route = await walkingRoute(points);
  Object.assign(
    route,
    { candidate: { algorithm, bearing, scale, points } },
    scoreRoute(route, targetKm),
  );
  return applyStationPenalty(route, stations);
}

async function routeCandidates(
  start,
  targetKm,
  bearing,
  favorites,
  offsets,
  stations,
  algorithm,
) {
  const scales = favorites.length ? [0.35, 0.55, 0.75, 0.95] : [0.75, 0.9, 1.05, 1.2];
  const candidates = await Promise.allSettled(
    offsets.map((offset, index) => {
      const candidateBearing = (bearing + offset) % 360;
      return routeCandidate(
        start,
        targetKm,
        candidateBearing,
        favorites,
        scales[index],
        stations,
        algorithm,
      );
    }),
  );
  return candidates.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
}

export async function walkingLoop(
  start,
  targetKm,
  bearing,
  favorites = [],
  algorithm = "organic",
) {
  let routes = await routeCandidates(
    start,
    targetKm,
    bearing,
    favorites,
    algorithm === "spaghetti" ? [0, 54, 126, 210] : [0, 53, 127, 211],
    undefined,
    algorithm,
  );
  if (!routes.length) throw new Error("No walkable loop found");
  const railwayStations = await stationData(routes);
  routes.forEach((route) => applyStationPenalty(route, railwayStations.stations));
  routes.sort(compareRoutes);

  if (needsMoreCandidates(routes[0], algorithm)) {
    routes = routes.concat(
      await routeCandidates(
        start,
        targetKm,
        bearing,
        favorites,
        algorithm === "spaghetti" ? [30, 90, 168, 258] : [29, 91, 169, 257],
        railwayStations.stations,
        algorithm,
      ),
    );
    routes.sort(compareRoutes);
  }

  if (!routeIsAcceptable(routes[0]) && algorithm === "organic" && !favorites.length) {
    routes = routes.concat(
      await routeCandidates(
        start,
        targetKm,
        bearing,
        favorites,
        [0, 90, 180, 270],
        railwayStations.stations,
        "tangent",
      ),
    );
    routes.sort(compareRoutes);
  }

  if (needsMoreCandidates(routes[0], algorithm) && algorithm === "spaghetti") {
    routes = routes.concat(
      await routeCandidates(
        start,
        targetKm,
        bearing,
        favorites,
        [29, 53, 127, 211],
        railwayStations.stations,
        "spaghetti-cross",
      ),
    );
    routes.sort(compareRoutes);
  }

  if (!routeIsAcceptable(routes[0]) && algorithm === "spaghetti") {
    routes = routes.concat(
      await routeCandidates(
        start,
        targetKm,
        bearing,
        favorites,
        [29, 53, 127, 211],
        railwayStations.stations,
        "spaghetti-safe",
      ),
    );
    routes.sort(compareRoutes);
  }

  const calibrationSource =
    routes
      .filter(backtrackingIsAcceptable)
      .sort((a, b) => a.distanceError - b.distanceError)[0] || routes[0];
  if (calibrationSource.distanceError > 0.1) {
    const best = calibrationSource;
    const scale = Math.min(1.4, best.candidate.scale * ((targetKm * 1000) / best.distance));
    try {
      routes.push(
        await routeCandidate(
          start,
          targetKm,
          best.candidate.bearing,
          favorites,
          scale,
          railwayStations.stations,
          best.candidate.algorithm,
        ),
      );
      routes.sort(compareRoutes);
    } catch {
      // Keep the best successful candidate.
    }
  }

  if (!routeIsAcceptable(routes[0])) {
    const error = new Error("No low-backtracking loop found");
    error.code = "ROUTE_QUALITY";
    throw error;
  }

  routes[0].debugCandidates = routes.map(
    ({
      candidate,
      distance,
      distanceError,
      distanceErrorDistance,
      repeatRatio,
      repeatedDistance,
      longestRepeatRatio,
      longestRepeatDistance,
      stationRepeatDistance,
      score,
    }) => ({
      ...candidate,
      distance,
      distanceError,
      distanceErrorDistance,
      repeatRatio,
      repeatedDistance,
      longestRepeatRatio,
      longestRepeatDistance,
      stationRepeatDistance,
      score,
    }),
  );
  routes[0].debugStationData = railwayStations;
  return routes[0];
}
