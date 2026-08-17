import { bearing, rejectionReasons, scoreRoute } from '$lib/route/edge-scoring';
import type { LatLng } from '$lib/types';
import type {
	CandidateDebug,
	RouteCandidateMetadata,
	RouteDebug,
	RouteGenerationRequest,
	RouteGenerationResponse,
	RouteResult,
} from '$lib/route/contracts';
import type { IsodistanceContour, RouteProvider } from './valhalla';

export const GENERATOR_VERSION = 'network-contours-1';

interface CandidateSpec {
	id: string;
	anchorCount: 2 | 3;
	contourDistanceKm: number;
	traversal: 'clockwise' | 'counterclockwise';
	adjustment: number;
	bearings: number[];
}

interface EvaluatedCandidate {
	result: RouteResult;
	debug: CandidateDebug;
	spec: CandidateSpec;
}

export class RouteGenerationError extends Error {
	readonly code = 'ROUTE_QUALITY';
	constructor(message: string, readonly debug: RouteDebug) {
		super(message);
	}
}

export async function generateRoute(
	request: RouteGenerationRequest,
	valhalla: RouteProvider,
	graphDataVersion: string,
): Promise<RouteGenerationResponse> {
	const startedAt = performance.now();
	const targetKm = targetDistanceKm(request);
	const debug: RouteDebug = {
		schemaVersion: 13,
		generatedAt: new Date().toISOString(),
		seed: request.seed,
		generatorVersion: GENERATOR_VERSION,
		graphDataVersion,
		input: { ...request, targetKm },
		candidates: [],
		requestBudget: {
			maximumValhallaCalls: valhalla.maximumCalls,
			usedValhallaCalls: 0,
			elapsedMs: 0,
		},
	};

	try {
		const random = seededRandom(request.seed);
		const baseContourDistance = Math.max(0.15, targetKm / 3.2);
		const distances = [0.78, 0.95, 1.12].map((scale) => baseContourDistance * scale);
		const contours = await valhalla.isodistance(request.start, distances);
		const specs = candidateSpecs(distances, random);
		const evaluated = await evaluateBatch(specs, contours, request, targetKm, valhalla, debug);

		const calibrationSource = [...evaluated].sort(
			(a, b) => a.result.scores.distanceErrorRatio - b.result.scores.distanceErrorRatio,
		)[0];
		if (calibrationSource && calibrationSource.result.scores.distanceErrorRatio > 0.06) {
			const adjustedDistance = Math.max(
				0.15,
				Math.min(
					targetKm * 0.65,
					calibrationSource.spec.contourDistanceKm * targetKm * 1000 / calibrationSource.result.distance,
				),
			);
			const adjustedContours = await valhalla.isodistance(request.start, [adjustedDistance]);
			const adjustedSpec: CandidateSpec = {
				...calibrationSource.spec,
				id: `${calibrationSource.spec.id}-adjusted`,
				contourDistanceKm: adjustedDistance,
				adjustment: 1,
			};
			evaluated.push(
				...(await evaluateBatch(
					[adjustedSpec],
					adjustedContours,
					request,
					targetKm,
					valhalla,
					debug,
				)),
			);
		}

		const accepted = evaluated
			.filter((candidate) => candidate.debug.rejectionReasons.length === 0)
			.sort((a, b) => a.result.scores.total - b.result.scores.total);
		const winner = accepted[0];
		if (!winner) {
			debug.error = 'No candidate met the route-quality limits';
			throw new RouteGenerationError(debug.error, finishDebug(debug, valhalla, startedAt));
		}
		debug.selectedCandidateId = winner.result.candidate.id;
		return { route: winner.result, debug: finishDebug(debug, valhalla, startedAt) };
	} catch (error) {
		if (error instanceof RouteGenerationError) throw error;
		debug.error = error instanceof Error ? error.message : 'Route generation failed';
		throw new RouteGenerationError(debug.error, finishDebug(debug, valhalla, startedAt));
	}
}

async function evaluateBatch(
	specs: CandidateSpec[],
	contours: IsodistanceContour[],
	request: RouteGenerationRequest,
	targetKm: number,
	valhalla: RouteProvider,
	debug: RouteDebug,
): Promise<EvaluatedCandidate[]> {
	const settled = await Promise.allSettled(
		specs.map(async (spec) => {
			const anchors = spec.bearings.map((anchorBearing) =>
				sampleAnchor(request.start, nearestContour(contours, spec.contourDistanceKm), anchorBearing),
			);
			const candidate: RouteCandidateMetadata = {
				id: spec.id,
				anchorCount: spec.anchorCount,
				contourDistanceKm: spec.contourDistanceKm,
				traversal: spec.traversal,
				adjustment: spec.adjustment,
				anchors,
			};
			const points = orderedThroughPoints(request.start, anchors, request.requiredSpots.map((spot) => spot.coordinates), spec);
			const routed = await valhalla.route([request.start, ...points, request.start]);
			const edges = await valhalla.traceEdges(routed.geometry.coordinates);
			const scores = scoreRoute(routed, edges, targetKm * 1000, request.requiredSpots);
			const reasons = rejectionReasons(scores, request.preferences);
			const result: RouteResult = {
				distance: routed.distance,
				duration: routed.distance / 1000 / request.paceKmH * 3600,
				geometry: routed.geometry,
				candidate,
				scores,
			};
			return {
				result,
				spec,
				debug: {
					candidate,
					distance: result.distance,
					duration: result.duration,
					scores,
					rejectionReasons: reasons,
				},
			};
		}),
	);

	const evaluated: EvaluatedCandidate[] = [];
	settled.forEach((outcome, index) => {
		if (outcome.status === 'fulfilled') {
			evaluated.push(outcome.value);
			debug.candidates.push(outcome.value.debug);
			return;
		}
		const spec = specs[index]!;
		debug.candidates.push({
			candidate: {
				id: spec.id,
				anchorCount: spec.anchorCount,
				contourDistanceKm: spec.contourDistanceKm,
				traversal: spec.traversal,
				adjustment: spec.adjustment,
				anchors: [],
			},
			rejectionReasons: ['ROUTING_ERROR'],
			error: outcome.reason instanceof Error ? outcome.reason.message : 'Candidate routing failed',
		});
	});
	return evaluated;
}

function candidateSpecs(distances: number[], random: () => number): CandidateSpec[] {
	const rotation = random() * 360;
	return [0, 1, 2, 3].map((index) => {
		const anchorCount = index < 2 ? 2 : 3;
		const traversal = index % 2 === 0 ? 'clockwise' : 'counterclockwise';
		const phase = rotation + index * 47 + (random() - 0.5) * 30;
		const separation = 360 / anchorCount;
		const bearings = Array.from({ length: anchorCount }, (_, anchorIndex) =>
			(phase + anchorIndex * separation + (random() - 0.5) * 22 + 360) % 360,
		);
		if (traversal === 'counterclockwise') bearings.reverse();
		return {
			id: `candidate-${index + 1}`,
			anchorCount,
			contourDistanceKm: distances[index % distances.length]!,
			traversal,
			adjustment: 0,
			bearings,
		};
	});
}

function orderedThroughPoints(
	start: LatLng,
	anchors: LatLng[],
	requiredSpots: LatLng[],
	spec: CandidateSpec,
): LatLng[] {
	const phase = spec.bearings[0]!;
	const angularPosition = (point: LatLng) => {
		const clockwise = (bearing(start, point) - phase + 360) % 360;
		return spec.traversal === 'clockwise' ? clockwise : (360 - clockwise) % 360;
	};
	return [...anchors, ...requiredSpots].sort((a, b) => angularPosition(a) - angularPosition(b));
}

function sampleAnchor(start: LatLng, contour: IsodistanceContour, targetBearing: number): LatLng {
	let best: LatLng | undefined;
	let bestDifference = Number.POSITIVE_INFINITY;
	for (const ring of contour.rings) {
		const stride = Math.max(1, Math.floor(ring.length / 720));
		for (let index = 0; index < ring.length; index += stride) {
			const coordinate = ring[index]!;
			const point: LatLng = [coordinate[1], coordinate[0]];
			const difference = angularDifference(bearing(start, point), targetBearing);
			if (difference < bestDifference) {
				best = point;
				bestDifference = difference;
			}
		}
	}
	if (!best) throw new Error(`Contour ${contour.distanceKm} km has no usable polygon vertices`);
	return best;
}

function nearestContour(contours: IsodistanceContour[], distanceKm: number): IsodistanceContour {
	const contour = [...contours].sort(
		(a, b) => Math.abs(a.distanceKm - distanceKm) - Math.abs(b.distanceKm - distanceKm),
	)[0];
	if (!contour) throw new Error('Valhalla returned no usable contour');
	return contour;
}

function angularDifference(a: number, b: number): number {
	const difference = Math.abs(a - b) % 360;
	return Math.min(difference, 360 - difference);
}

function targetDistanceKm(request: RouteGenerationRequest): number {
	return request.target.mode === 'distance'
		? request.target.value
		: request.target.value / 60 * request.paceKmH;
}

function seededRandom(seed: string): () => number {
	let state = 2166136261;
	for (let index = 0; index < seed.length; index += 1) {
		state ^= seed.charCodeAt(index);
		state = Math.imul(state, 16777619);
	}
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ value >>> 15, value | 1);
		value ^= value + Math.imul(value ^ value >>> 7, value | 61);
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	};
}

function finishDebug(debug: RouteDebug, valhalla: RouteProvider, startedAt: number): RouteDebug {
	debug.requestBudget.usedValhallaCalls = valhalla.usedCalls;
	debug.requestBudget.elapsedMs = Math.round(performance.now() - startedAt);
	return debug;
}
