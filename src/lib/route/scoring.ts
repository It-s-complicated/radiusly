import type { InternalAlgorithm, LngLat, RouteCandidate, RouteResult } from '$lib/types';

const STATION_RADIUS_METERS = 250;
const MAX_REPEAT_RATIO = 0.05;
const MAX_REPEAT_RUN_METERS = 210;
const MAX_STATION_REPEAT_METERS = 100;
const MAX_ORBIT_STEM_METERS = 500;

/**
 * Haversine distance in meters between two [lng, lat] coordinates.
 */
export function distance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	const latitude = toRadians(lat2 - lat1);
	const longitude = toRadians(lng2 - lng1);
	const a =
		Math.sin(latitude / 2) ** 2 +
		Math.cos(toRadians(lat1)) *
			Math.cos(toRadians(lat2)) *
			Math.sin(longitude / 2) ** 2;
	return 12742000 * Math.asin(Math.sqrt(a));
}

function segmentKey(from: LngLat, to: LngLat): string {
	return [from, to]
		.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`)
		.sort()
		.join(';');
}

export interface PathRepetition {
	repeatRatio: number;
	repeatedDistance: number;
	longestRepeatRatio: number;
	longestRepeatDistance: number;
}

/**
 * Measure how much a path retraces itself.
 */
export function pathRepetition(coordinates: LngLat[]): PathRepetition & { repeatedRun: number } {
	const seen = new Set<string>();
	let total = 0;
	let repeated = 0;
	let repeatedRun = 0;
	let longestRepeatedRun = 0;

	for (let index = 1; index < coordinates.length; index++) {
		const from = coordinates[index - 1]!;
		const to = coordinates[index]!;
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
		repeatedRun,
	};
}

/**
 * Measure repeated distance near railway stations.
 */
export function stationRepeatedDistance(
	coordinates: LngLat[],
	stations: { coordinates: LngLat }[],
): number {
	const seen = new Set<string>();
	let repeated = 0;

	for (let index = 1; index < coordinates.length; index++) {
		const from = coordinates[index - 1]!;
		const to = coordinates[index]!;
		const key = segmentKey(from, to);
		const midpoint: LngLat = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
		if (
			seen.has(key) &&
			stations.some(
				({ coordinates: station }) =>
					distance(midpoint, station) <= STATION_RADIUS_METERS,
			)
		) {
			repeated += distance(from, to);
		}
		seen.add(key);
	}

	return repeated;
}

/**
 * Legacy wrapper — repeat ratio only.
 */
export function repeatedPathRatio(coordinates: LngLat[]): number {
	return pathRepetition(coordinates).repeatRatio;
}

export interface ScoredRoute {
	distanceError: number;
	distanceErrorDistance: number;
	repeatRatio: number;
	repeatedDistance: number;
	longestRepeatRatio: number;
	longestRepeatDistance: number;
	score: number;
}

/**
 * Score a route candidate by distance error and path repetition.
 */
export function scoreRoute(
	route: { distance: number; geometry: { coordinates: LngLat[] } },
	targetKm: number,
): ScoredRoute {
	const distanceErrorDistance = Math.abs(route.distance - targetKm * 1000);
	const distanceError = distanceErrorDistance / (targetKm * 1000);
	const repetition = pathRepetition(route.geometry.coordinates);
	return {
		distanceError,
		distanceErrorDistance,
		...repetition,
		score:
			distanceError + repetition.repeatRatio * 2 + repetition.longestRepeatRatio * 4,
	};
}

/**
 * Check if backtracking in a route is within acceptable limits.
 */
export function backtrackingIsAcceptable(
	route: Pick<
		RouteResult,
		'repeatRatio' | 'longestRepeatDistance' | 'stationRepeatDistance' | 'candidate'
	>,
): boolean {
	const maxRepeatRun =
		route.candidate?.algorithm === 'spaghetti-cross' ||
		route.candidate?.algorithm === 'spaghetti-safe'
			? 260
			: MAX_REPEAT_RUN_METERS;
	return (
		route.stationRepeatDistance <= MAX_STATION_REPEAT_METERS &&
		(route.candidate?.algorithm === 'orbit-same' ||
			(route.repeatRatio <= MAX_REPEAT_RATIO &&
				route.longestRepeatDistance <= maxRepeatRun))
	);
}

/**
 * Check if a route is acceptable as a final result.
 */
export function routeIsAcceptable(
	route: Pick<
		RouteResult,
		| 'distanceError'
		| 'repeatRatio'
		| 'longestRepeatDistance'
		| 'stationRepeatDistance'
		| 'candidate'
	>,
): boolean {
	return (
		route.distanceError <= 0.25 &&
		backtrackingIsAcceptable({
			...route,
			stationRepeatDistance: 0,
		})
	);
}

/**
 * Determine whether we need more candidates for this route+algorithm.
 */
export function needsMoreCandidates(
	route: Pick<
		RouteResult,
		| 'distanceError'
		| 'repeatRatio'
		| 'longestRepeatDistance'
		| 'stationRepeatDistance'
		| 'candidate'
	>,
	algorithm: InternalAlgorithm,
): boolean {
	return (
		!routeIsAcceptable(route) ||
		(algorithm === 'orbit-same' &&
			'longestRepeatDistance' in route &&
			route.longestRepeatDistance > MAX_ORBIT_STEM_METERS)
	);
}

interface CompareRoute {
	distanceError: number;
	distanceErrorDistance: number;
	repeatRatio: number;
	repeatedDistance: number;
	longestRepeatDistance: number;
	stationRepeatDistance?: number;
	score: number;
}

/**
 * Compare two routes, returning negative if `a` is better.
 */
export function compareRoutes(a: CompareRoute, b: CompareRoute): number {
	const aAcceptable = routeIsAcceptable(a as Parameters<typeof routeIsAcceptable>[0]);
	const bAcceptable = routeIsAcceptable(b as Parameters<typeof routeIsAcceptable>[0]);
	if (aAcceptable !== bAcceptable) return aAcceptable ? -1 : 1;
	if (aAcceptable) {
		const penalty = ({
			distanceErrorDistance,
			repeatedDistance,
			longestRepeatDistance,
			stationRepeatDistance = 0,
		}: {
			distanceErrorDistance: number;
			repeatedDistance: number;
			longestRepeatDistance: number;
			stationRepeatDistance?: number;
		}) =>
			distanceErrorDistance +
			repeatedDistance +
			longestRepeatDistance * 2 +
			stationRepeatDistance * 4;
		return penalty(a) - penalty(b);
	}
	return a.score - b.score;
}
