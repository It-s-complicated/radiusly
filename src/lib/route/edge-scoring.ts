import type { LatLng, LngLat } from '$lib/types';
import type { RequiredSpot, RoutePreferences, RouteScoreComponents, RoutedEdge } from './contracts';

const REQUIRED_SPOT_TOLERANCE_METERS = 40;
const ROUGH_SURFACES: Record<string, true> = {
	dirt: true,
	earth: true,
	gravel: true,
	mud: true,
	sand: true,
};
const MAJOR_ROADS: Record<string, true> = {
	motorway: true,
	trunk: true,
	primary: true,
	secondary: true,
};

export function distance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
	const toRad = Math.PI / 180;
	const dLat = (lat2 - lat1) * toRad;
	const dLng = (lng2 - lng1) * toRad;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
	return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function repetition(edges: RoutedEdge[]): {
	repeatedDistanceMeters: number;
	longestRepeatedRunMeters: number;
	immediateReversalMeters: number;
} {
	const seen = new Set<string>();
	const traversalStack: RoutedEdge[] = [];
	let repeatedDistanceMeters = 0;
	let repeatedRun = 0;
	let longestRepeatedRunMeters = 0;
	let reversalRun = 0;
	let immediateReversalMeters = 0;

	for (const edge of edges) {
		if (seen.has(edge.id)) {
			repeatedDistanceMeters += edge.lengthMeters;
			repeatedRun += edge.lengthMeters;
			longestRepeatedRunMeters = Math.max(longestRepeatedRunMeters, repeatedRun);
		} else {
			seen.add(edge.id);
			repeatedRun = 0;
		}

		const previous = traversalStack.at(-1);
		if (previous?.id === edge.id && previous.direction !== edge.direction) {
			traversalStack.pop();
			reversalRun += Math.min(previous.lengthMeters, edge.lengthMeters);
			immediateReversalMeters = Math.max(immediateReversalMeters, reversalRun);
		} else {
			traversalStack.push(edge);
			reversalRun = 0;
		}
	}

	return { repeatedDistanceMeters, longestRepeatedRunMeters, immediateReversalMeters };
}

function missedRequiredSpots(coordinates: LngLat[], spots: RequiredSpot[]): number {
	return spots.filter((spot) => {
		const point: LngLat = [spot.coordinates[1], spot.coordinates[0]];
		return !coordinates.some(
			(coordinate) => distance(coordinate, point) <= REQUIRED_SPOT_TOLERANCE_METERS,
		);
	}).length;
}

export function scoreRoute(
	route: { distance: number; geometry: { coordinates: LngLat[] } },
	edges: RoutedEdge[],
	targetMeters: number,
	requiredSpots: RequiredSpot[],
): RouteScoreComponents {
	const distanceErrorMeters = Math.abs(route.distance - targetMeters);
	const distanceErrorRatio = distanceErrorMeters / targetMeters;
	const repeated = repetition(edges);
	const repeatRatio = repeated.repeatedDistanceMeters / Math.max(route.distance, 1);
	const unsuitableAccessMeters = edges
		.filter((edge) => !edge.pedestrianAllowed)
		.reduce((total, edge) => total + edge.lengthMeters, 0);
	const softExposures = {
		majorRoadMeters: edges
			.filter((edge) => edge.roadClass && MAJOR_ROADS[edge.roadClass])
			.reduce((total, edge) => total + edge.lengthMeters, 0),
		stepsMeters: edges
			.filter((edge) => edge.use === 'steps')
			.reduce((total, edge) => total + edge.lengthMeters, 0),
		tunnelMeters: edges
			.filter((edge) => edge.tunnel)
			.reduce((total, edge) => total + edge.lengthMeters, 0),
		roughSurfaceMeters: edges
			.filter((edge) => edge.surface && ROUGH_SURFACES[edge.surface])
			.reduce((total, edge) => total + edge.lengthMeters, 0),
	};
	const requiredSpotsMissed = missedRequiredSpots(route.geometry.coordinates, requiredSpots);

	return {
		distanceErrorRatio,
		distanceErrorMeters,
		repeatedDistanceMeters: repeated.repeatedDistanceMeters,
		repeatRatio,
		longestRepeatedRunMeters: repeated.longestRepeatedRunMeters,
		immediateReversalMeters: repeated.immediateReversalMeters,
		unsuitableAccessMeters,
		requiredSpotsMissed,
		softExposures,
		// Exposure metrics are recorded but deliberately unweighted until field evidence
		// establishes a useful product preference and penalty.
		total:
			distanceErrorRatio * 3 +
			repeatRatio * 5 +
			repeated.longestRepeatedRunMeters / Math.max(route.distance, 1) +
			repeated.immediateReversalMeters / Math.max(route.distance, 1) +
			(unsuitableAccessMeters / Math.max(route.distance, 1)) * 10 +
			requiredSpotsMissed * 10,
	};
}

export function rejectionReasons(
	scores: RouteScoreComponents,
	preferences: RoutePreferences,
): string[] {
	const limits =
		preferences.backtracking === 'avoid'
			? { repeatRatio: 0.05, repeatedRun: 180, reversal: 60 }
			: { repeatRatio: 0.08, repeatedRun: 260, reversal: 120 };
	const reasons: string[] = [];
	if (scores.distanceErrorRatio > 0.15) reasons.push('TARGET_DISTANCE_ERROR');
	if (scores.repeatRatio > limits.repeatRatio) reasons.push('TOTAL_REPEATED_DISTANCE');
	if (scores.longestRepeatedRunMeters > limits.repeatedRun) reasons.push('LONGEST_REPEATED_RUN');
	if (scores.immediateReversalMeters > limits.reversal) reasons.push('IMMEDIATE_REVERSAL');
	if (scores.requiredSpotsMissed > 0) reasons.push('REQUIRED_SPOT_MISSED');
	if (scores.unsuitableAccessMeters > 0) reasons.push('UNSUITABLE_PEDESTRIAN_ACCESS');
	return reasons;
}

export function bearing(from: LatLng, to: LatLng): number {
	const toRad = Math.PI / 180;
	const toDeg = 180 / Math.PI;
	const lat1 = from[0] * toRad;
	const lat2 = to[0] * toRad;
	const dLng = (to[1] - from[1]) * toRad;
	const y = Math.sin(dLng) * Math.cos(lat2);
	const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
	return (Math.atan2(y, x) * toDeg + 360) % 360;
}
