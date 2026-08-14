import type { Algorithm, InternalAlgorithm, LatLng } from '$lib/types';

/**
 * Convert a mode + value into target kilometers.
 */
export function targetKilometers(mode: string, value: number, pace: number): number {
	return mode === 'time' ? (value * pace) / 60 : value;
}

/**
 * Calculate a point at given distance (km) and bearing from a starting coordinate.
 */
export function pointAt(
	[lat, lng]: LatLng,
	distanceKm: number,
	bearingDegrees: number,
): LatLng {
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

function irregularPoint(
	center: LatLng,
	radius: number,
	bearing: number,
	seed: number,
): LatLng {
	const distanceScale = 0.72 + seededUnit(seed) * 0.56;
	const angleJitter = (seededUnit(seed + 19) - 0.5) * 36;
	return pointAt(center, radius * distanceScale, bearing + angleJitter);
}

function angleFrom(center: LatLng, [lat, lng]: LatLng): number {
	const latitudeScale = Math.cos((center[0] * Math.PI) / 180);
	const degrees =
		(Math.atan2(
			(lng - center[1]) * latitudeScale,
			lat - center[0],
		) *
			180) /
		Math.PI;
	return (degrees + 360) % 360;
}

function orderAround(
	center: LatLng,
	points: LatLng[],
	startBearing: number,
): LatLng[] {
	return points.sort(
		(a, b) =>
			((angleFrom(center, a) - startBearing + 360) % 360) -
			((angleFrom(center, b) - startBearing + 360) % 360),
	);
}

/**
 * Generate waypoints for a walking loop using the specified algorithm.
 */
export function loopPoints(
	start: LatLng,
	targetKm: number,
	bearing = 25,
	favorites: LatLng[] = [],
	scale = 1,
	algorithm: InternalAlgorithm = 'organic',
): LatLng[] {
	if (algorithm === 'tangent') {
		const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.9 * scale);
		const center = pointAt(start, radius, bearing);
		const startBearing = (bearing + 180) % 360;
		const perimeter = [90, 180, 270].map((offset) =>
			pointAt(center, radius, startBearing + offset),
		);
		return [
			start,
			...orderAround(center, [...favorites, ...perimeter], startBearing),
			start,
		];
	}

	if (algorithm === 'orbit-same' || algorithm === 'orbit-near') {
		const radius = Math.max(0.18, (targetKm / (2 + 2 * Math.PI)) * 0.9 * scale);
		const gap = algorithm === 'orbit-near' ? 9 : 0;
		const outboundBearing = bearing - gap;
		const inboundBearing = bearing + gap;
		const outbound = pointAt(start, radius, outboundBearing);
		const inbound = pointAt(start, radius, inboundBearing);
		const perimeter = [90, 180, 270].map((offset) =>
			pointAt(start, radius, bearing + offset),
		);
		return [
			start,
			outbound,
			...orderAround(start, [...favorites, ...perimeter], outboundBearing),
			inbound,
			start,
		];
	}

	if (algorithm === 'spaghetti') {
		const patterns = [
			[168, 48, 228, 108],
			[144, 288, 72, 216],
			[108, 276, 72, 228],
		];
		const pattern =
			patterns[
				((Math.round(bearing) % patterns.length) + patterns.length) %
					patterns.length
			]!;
		const radius = Math.max(0.18, (targetKm / 11.5) * 0.9 * scale);
		const centerBearing = bearing + (seededUnit(bearing + 7) - 0.5) * 28;
		const centerDistance = radius * (0.8 + seededUnit(bearing + 11) * 0.35);
		const center = pointAt(start, centerDistance, centerBearing);
		const startBearing = centerBearing + 180;
		const detours = pattern.map((offset, index) =>
			irregularPoint(center, radius, startBearing + offset, bearing + index * 31),
		);
		return [start, detours[0]!, ...favorites, ...detours.slice(1), start];
	}

	if (algorithm === 'spaghetti-cross') {
		const radius = Math.max(0.18, (targetKm / 8) * 0.9 * scale);
		const centerBearing = bearing + (seededUnit(bearing + 23) - 0.5) * 24;
		const centerDistance = radius * (0.82 + seededUnit(bearing + 29) * 0.3);
		const center = pointAt(start, centerDistance, centerBearing);
		const startBearing = centerBearing + 180;
		const detours = [180, 90, 270].map((offset, index) =>
			irregularPoint(center, radius, startBearing + offset, bearing + index * 43),
		);
		return [start, detours[0]!, ...favorites, ...detours.slice(1), start];
	}

	if (algorithm === 'spaghetti-safe') {
		const radius = Math.max(0.18, (targetKm / 8) * 0.9 * scale);
		const center = pointAt(start, radius, bearing);
		const startBearing = bearing + 180;
		const detours = [180, 90, 270].map((offset) =>
			pointAt(center, radius, startBearing + offset),
		);
		return [start, detours[0]!, ...favorites, ...detours.slice(1), start];
	}

	// Organic (default)
	const radius = Math.max(0.18, (targetKm / (2 * Math.PI)) * 0.87 * scale);
	const detours = [0, 120, 240].map((offset) =>
		pointAt(start, radius, bearing + offset),
	);
	const points = orderAround(start, [...favorites, ...detours], 180);
	return [start, ...points, start];
}
