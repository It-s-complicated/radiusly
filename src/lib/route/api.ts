import { loopPoints } from './shapes';
import {
	scoreRoute,
	stationRepeatedDistance as srd,
	backtrackingIsAcceptable,
	compareRoutes,
	needsMoreCandidates,
	routeIsAcceptable,
} from './scoring';
import type {
	Algorithm,
	InternalAlgorithm,
	LatLng,
	LngLat,
	RouteResult,
} from '$lib/types';

// Re-export for backward compat
export {
	compareRoutes,
	needsMoreCandidates,
	routeIsAcceptable,
	scoreRoute,
	backtrackingIsAcceptable,
};

/* ------------------------------------------------------------------ */
/*  Server-proxied API calls                                          */
/* ------------------------------------------------------------------ */

/**
 * Fetch a walking route from the server-side OSRM proxy.
 */
async function walkingRoute(points: LatLng[]): Promise<{
	distance: number;
	duration: number;
	geometry: { coordinates: LngLat[] };
	weight: number;
}> {
	const coordinates = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
	const response = await fetch(
		`/api/routing?coordinates=${encodeURIComponent(coordinates)}`,
	);
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(text || `Routing failed (${response.status})`);
	}
	const data = await response.json();
	if (data.code !== 'Ok' || !data.routes?.[0])
		throw new Error('No walkable loop found');
	return data.routes[0];
}

/**
 * Fetch railway station data from the server-side Overpass proxy.
 */
async function stationData(
	routes: { geometry: { coordinates: LngLat[] } }[],
): Promise<{
	available: boolean;
	stations: { name?: string; coordinates: LngLat }[];
}> {
	const coordinates = routes.flatMap((r) => r.geometry.coordinates);
	const lngs = coordinates.map(([lng]) => lng);
	const lats = coordinates.map(([, lat]) => lat);
	const bbox = [
		Math.min(...lats) - 0.005,
		Math.min(...lngs) - 0.005,
		Math.max(...lats) + 0.005,
		Math.max(...lngs) + 0.005,
	].join(',');

	try {
		const response = await fetch(
			`/api/stations?bbox=${encodeURIComponent(bbox)}`,
		);
		if (!response.ok) throw new Error();
		return await response.json();
	} catch {
		return { available: false, stations: [] };
	}
}

/* ------------------------------------------------------------------ */
/*  Helper to apply station penalty to a route                        */
/* ------------------------------------------------------------------ */

function applyStationPenalty(
	route: RouteResult,
	stations: { coordinates: LngLat }[],
): RouteResult {
	route.stationRepeatDistance = srd(route.geometry.coordinates, stations);
	route.score += (route.stationRepeatDistance / route.distance) * 4;
	return route;
}

/* ------------------------------------------------------------------ */
/*  Candidate generation                                              */
/* ------------------------------------------------------------------ */

async function routeCandidate(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[],
	scale: number,
	stations: { coordinates: LngLat }[] = [],
	algorithm: InternalAlgorithm = 'organic',
): Promise<RouteResult> {
	const points = loopPoints(start, targetKm, bearing, favorites, scale, algorithm);
	const route = await walkingRoute(points);
	const scored = scoreRoute(
		{ distance: route.distance, geometry: route.geometry },
		targetKm,
	);
	Object.assign(route, {
		candidate: { algorithm, bearing, scale, points },
		...scored,
	});
	return applyStationPenalty(route as RouteResult, stations);
}

async function routeCandidates(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[],
	offsets: number[],
	stations: { coordinates: LngLat }[],
	algorithm: InternalAlgorithm,
): Promise<RouteResult[]> {
	const scales = favorites.length
		? [0.35, 0.55, 0.75, 0.95]
		: [0.75, 0.9, 1.05, 1.2];
	const results = await Promise.allSettled(
		offsets.map((offset, index) => {
			const candidateBearing = (bearing + offset) % 360;
			return routeCandidate(
				start,
				targetKm,
				candidateBearing,
				favorites,
				scales[index]!,
				stations,
				algorithm,
			);
		}),
	);
	return results
		.filter((r) => r.status === 'fulfilled')
		.map((r) => (r as PromiseFulfilledResult<RouteResult>).value);
}

/* ------------------------------------------------------------------ */
/*  Main orchestration — generate, score, calibrate, select           */
/* ------------------------------------------------------------------ */

/**
 * Generate and select the best walking loop for the given parameters.
 */
export async function walkingLoop(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[] = [],
	algorithm: Algorithm = 'organic',
): Promise<RouteResult> {
	const internalAlgo: InternalAlgorithm = algorithm;

	let routes = await routeCandidates(
		start,
		targetKm,
		bearing,
		favorites,
		algorithm === 'spaghetti' ? [0, 54, 126, 210] : [0, 53, 127, 211],
		[],
		internalAlgo,
	);
	if (!routes.length) throw new Error('No walkable loop found');

	const railwayStations = await stationData(routes);
	routes.forEach((route) => applyStationPenalty(route, railwayStations.stations));
	routes.sort(compareRoutes);

	if (needsMoreCandidates(routes[0]!, internalAlgo)) {
		routes = routes.concat(
			await routeCandidates(
				start,
				targetKm,
				bearing,
				favorites,
				algorithm === 'spaghetti' ? [30, 90, 168, 258] : [29, 91, 169, 257],
				railwayStations.stations,
				internalAlgo,
			),
		);
		routes.sort(compareRoutes);
	}

	if (
		!routeIsAcceptable(routes[0]!) &&
		internalAlgo === 'organic' &&
		!favorites.length
	) {
		routes = routes.concat(
			await routeCandidates(
				start,
				targetKm,
				bearing,
				favorites,
				[0, 90, 180, 270],
				railwayStations.stations,
				'tangent',
			),
		);
		routes.sort(compareRoutes);
	}

	if (needsMoreCandidates(routes[0]!, internalAlgo) && internalAlgo === 'spaghetti') {
		routes = routes.concat(
			await routeCandidates(
				start,
				targetKm,
				bearing,
				favorites,
				[29, 53, 127, 211],
				railwayStations.stations,
				'spaghetti-cross',
			),
		);
		routes.sort(compareRoutes);
	}

	if (!routeIsAcceptable(routes[0]!) && internalAlgo === 'spaghetti') {
		routes = routes.concat(
			await routeCandidates(
				start,
				targetKm,
				bearing,
				favorites,
				[29, 53, 127, 211],
				railwayStations.stations,
				'spaghetti-safe',
			),
		);
		routes.sort(compareRoutes);
	}

	// Calibration — try to correct distance error
	const calibrationSource =
		routes
			.filter(backtrackingIsAcceptable)
			.sort((a, b) => a.distanceError - b.distanceError)[0] ?? routes[0]!;
	if (calibrationSource.distanceError > 0.1) {
		const best = calibrationSource;
		const scale = Math.min(
			1.4,
			best.candidate!.scale * ((targetKm * 1000) / best.distance),
		);
		try {
			routes.push(
				await routeCandidate(
					start,
					targetKm,
					best.candidate!.bearing,
					favorites,
					scale,
					railwayStations.stations,
					best.candidate!.algorithm,
				),
			);
			routes.sort(compareRoutes);
		} catch {
			// Keep best successful candidate
		}
	}

	if (!routeIsAcceptable(routes[0]!)) {
		const error = new Error('No low-backtracking loop found');
		(error as Error & { code: string }).code = 'ROUTE_QUALITY';
		throw error;
	}

	// Attach debug info
	const winner = routes[0]!;
	winner.debugCandidates = routes.map((r) => ({
		...r.candidate,
		distance: r.distance,
		distanceError: r.distanceError,
		distanceErrorDistance: r.distanceErrorDistance,
		repeatRatio: r.repeatRatio,
		repeatedDistance: r.repeatedDistance,
		longestRepeatRatio: r.longestRepeatRatio,
		longestRepeatDistance: r.longestRepeatDistance,
		stationRepeatDistance: r.stationRepeatDistance,
		score: r.score,
	}));
	winner.debugStationData = railwayStations;
	return winner;
}
