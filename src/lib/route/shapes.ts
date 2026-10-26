import type { Algorithm, LatLng, Waypoint } from '../types.js';

/**
 * Convert a mode + value into target kilometers.
 */
export function targetKilometers(mode: string, value: number, pace: number): number {
	return mode === 'time' ? (value * pace) / 60 : value;
}

/**
 * Calculate a point at given distance (km) and bearing from a starting coordinate.
 */
export function pointAt([lat, lng]: LatLng, distanceKm: number, bearingDegrees: number): LatLng {
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

function seededUnit(seed: number): number {
	const value = Math.sin(seed * 12.9898) * 43758.5453;
	return value - Math.floor(value);
}

function irregularPoint(center: LatLng, radius: number, bearing: number, seed: number): LatLng {
	const distanceScale = 0.72 + seededUnit(seed) * 0.56;
	const angleJitter = (seededUnit(seed + 19) - 0.5) * 36;
	return pointAt(center, radius * distanceScale, bearing + angleJitter);
}

function angleFrom(center: LatLng, [lat, lng]: LatLng): number {
	const latitudeScale = Math.cos((center[0] * Math.PI) / 180);
	const degrees = (Math.atan2((lng - center[1]) * latitudeScale, lat - center[0]) * 180) / Math.PI;
	return (degrees + 360) % 360;
}

function orderAround(center: LatLng, waypoints: Waypoint[], startBearing: number): Waypoint[] {
	return waypoints.sort(
		(a, b) =>
			((angleFrom(center, a.point) - startBearing + 360) % 360) -
			((angleFrom(center, b.point) - startBearing + 360) % 360),
	);
}

function generatedAnchor(point: LatLng): Waypoint {
	return { role: 'generated-anchor', point };
}

function perimeterOffsets(targetKm: number, minimum: number, skipFirst = false): number[] {
	const count = Math.max(minimum, Math.ceil(targetKm / 2));
	const first = skipFirst ? 1 : 0;
	return Array.from({ length: count - first }, (_, index) => ((index + first) * 360) / count);
}

/**
 * Generate waypoints for a walking loop using the specified algorithm.
 */
export function loopWaypoints(
	start: LatLng,
	targetKm: number,
	bearing = 25,
	favorites: LatLng[] = [],
	scale = 1,
	algorithm: Algorithm = 'organic',
): Waypoint[] {
	const startWaypoint: Waypoint = { role: 'start', point: start };
	const spots: Waypoint[] = favorites.map((point, spotIndex) => ({
		role: 'required-spot',
		point,
		spotIndex,
	}));
	if (algorithm === 'tangent') {
		const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.9 * scale);
		const center = pointAt(start, radius, bearing);
		const startBearing = (bearing + 180) % 360;
		const perimeter = perimeterOffsets(targetKm, 4, true).map((offset) =>
			generatedAnchor(pointAt(center, radius, startBearing + offset)),
		);
		return [
			startWaypoint,
			...orderAround(center, [...spots, ...perimeter], startBearing),
			startWaypoint,
		];
	}

	if (algorithm === 'orbit-same' || algorithm === 'orbit-near') {
		const radius = Math.max(0.18, (targetKm / (2 + 2 * Math.PI)) * 0.9 * scale);
		// Same return shares one rim point: the radial out-and-back is the deliberate stem.
		const gap = algorithm === 'orbit-near' ? 9 : 0;
		const outboundBearing = bearing - gap;
		const inboundBearing = bearing + gap;
		const outbound = generatedAnchor(pointAt(start, radius, outboundBearing));
		const inbound = generatedAnchor(pointAt(start, radius, inboundBearing));
		const perimeter = perimeterOffsets(targetKm, 4, true).map((offset) =>
			generatedAnchor(pointAt(start, radius, bearing + offset)),
		);
		return [
			startWaypoint,
			outbound,
			...orderAround(start, [...spots, ...perimeter], outboundBearing),
			inbound,
			startWaypoint,
		];
	}

	if (algorithm === 'spaghetti') {
		const patterns = [
			[168, 48, 228, 108],
			[144, 288, 72, 216],
			[108, 276, 72, 228],
		];
		const pattern =
			patterns[((Math.round(bearing) % patterns.length) + patterns.length) % patterns.length]!;
		const radius = Math.max(0.18, (targetKm / 11.5) * 0.9 * scale);
		const centerBearing = bearing + (seededUnit(bearing + 7) - 0.5) * 28;
		const centerDistance = radius * (0.8 + seededUnit(bearing + 11) * 0.35);
		const center = pointAt(start, centerDistance, centerBearing);
		const startBearing = centerBearing + 180;
		const detours = pattern.map((offset, index) =>
			generatedAnchor(irregularPoint(center, radius, startBearing + offset, bearing + index * 31)),
		);
		return [startWaypoint, detours[0]!, ...spots, ...detours.slice(1), startWaypoint];
	}

	// Organic (default)
	const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.87 * scale);
	const detours = perimeterOffsets(targetKm, 3).map((offset, index) =>
		generatedAnchor(irregularPoint(start, radius, bearing + offset, bearing + index * 31)),
	);
	const waypoints = orderAround(start, [...spots, ...detours], 180);
	return [startWaypoint, ...waypoints, startWaypoint];
}
