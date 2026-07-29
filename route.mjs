const ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/";

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

export function loopPoints(start, targetKm, bearing = 25, favorites = [], scale = 1) {
  const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.87 * scale);
  const detours = [0, 120, 240].map((offset) => pointAt(start, radius, bearing + offset));
  return [start, ...favorites, ...detours, start];
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

export async function walkingLoop(start, targetKm, bearing, favorites = []) {
  // ponytail: one calibrated request avoids hammering the free router; add server-side search if precision matters.
  return walkingRoute(loopPoints(start, targetKm, bearing, favorites));
}
