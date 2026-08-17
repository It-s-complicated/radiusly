import { loopPoints } from '$lib/route/shapes';
import {
	backtrackingIsAcceptable,
	compareRoutes,
	needsMoreCandidates,
	routeIsAcceptable,
	scoreRoute,
} from '$lib/route/scoring';
import type {
	Algorithm,
	InternalAlgorithm,
	LatLng,
	LngLat,
	RouteResult,
} from '$lib/types';

const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';
const USER_AGENT = 'Radiusly/0.1 (neighborhood-walk-planner)';
// Tests run the full candidate rounds; waiting 1.1s between calls would time them out.
const THROTTLE_MS = import.meta.env?.MODE === 'test' ? 0 : 1100;

// ponytail: single global 1 req/s gate per instance; FOSSGIS limits by IP anyway. Per-user fairness if multi-user ever matters.
let upstreamQueue: Promise<unknown> = Promise.resolve();
let lastUpstreamCall = 0;

function throttleUpstream<T>(call: () => Promise<T>): Promise<T> {
	const run = upstreamQueue.then(async () => {
		const wait = THROTTLE_MS - (Date.now() - lastUpstreamCall);
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastUpstreamCall = Date.now();
		return call();
	});
	upstreamQueue = run.catch(() => {});
	return run;
}

/* ------------------------------------------------------------------ */
/*  Upstream calls                                                    */
/* ------------------------------------------------------------------ */

async function walkingRoute(points: LatLng[]): Promise<{
	distance: number;
	duration: number;
	geometry: { coordinates: LngLat[] };
	weight: number;
}> {
	const coordinates = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
	const response = await throttleUpstream(() =>
		fetch(
			`${OSRM_BASE}/${coordinates}?overview=full&geometries=geojson&steps=false`,
			{
				signal: AbortSignal.timeout(15000),
				headers: { 'User-Agent': USER_AGENT },
			},
		),
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

/* ------------------------------------------------------------------ */
/*  Candidate generation                                              */
/* ------------------------------------------------------------------ */

async function routeCandidate(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[],
	scale: number,
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
	return route as RouteResult;
}

async function routeCandidates(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[],
	offsets: number[],
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
		internalAlgo,
	);
	if (!routes.length) throw new Error('No walkable loop found');

	routes.sort(compareRoutes);

	if (needsMoreCandidates(routes[0]!, internalAlgo)) {
		routes = routes.concat(
			await routeCandidates(
				start,
				targetKm,
				bearing,
				favorites,
				algorithm === 'spaghetti' ? [30, 90, 168, 258] : [29, 91, 169, 257],
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
		score: r.score,
	}));
	return winner;
}
