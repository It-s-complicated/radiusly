import { rejectionReasons, scoreRoute } from '$lib/route/edge-scoring';
import type { LatLng } from '$lib/types';
import type {
	RouteGenerationRequest,
	RouteScoreComponents,
} from '$lib/route/contracts';
import type { ValhallaClient } from './valhalla';

export type LegacyAlgorithm = 'organic' | 'tangent' | 'orbit-same' | 'orbit-near' | 'spaghetti';

export interface LegacyBaselineResult {
	algorithm: LegacyAlgorithm;
	points: LatLng[];
	distance?: number;
	scores?: RouteScoreComponents;
	rejectionReasons: string[];
	error?: string;
}

const LEGACY_ALGORITHMS: LegacyAlgorithm[] = [
	'organic',
	'tangent',
	'orbit-same',
	'orbit-near',
	'spaghetti',
];

export async function evaluateLegacyBaseline(
	request: RouteGenerationRequest,
	valhalla: ValhallaClient,
): Promise<LegacyBaselineResult[]> {
	const targetKm = request.target.mode === 'distance'
		? request.target.value
		: request.target.value / 60 * request.paceKmH;
	const favoritePoints = request.requiredSpots.map((spot) => spot.coordinates);
	const bearing = seedBearing(request.seed);
	const settled = await Promise.allSettled(
		LEGACY_ALGORITHMS.map(async (algorithm) => {
			const points = legacyLoopPoints(request.start, targetKm, bearing, favoritePoints, algorithm);
			const route = await valhalla.route(points);
			const edges = await valhalla.traceEdges(route.geometry.coordinates);
			const scores = scoreRoute(route, edges, targetKm * 1000, request.requiredSpots);
			return {
				algorithm,
				points,
				distance: route.distance,
				scores,
				rejectionReasons: rejectionReasons(scores, request.preferences),
			};
		}),
	);
	return settled.map((outcome, index) => {
		if (outcome.status === 'fulfilled') return outcome.value;
		const algorithm = LEGACY_ALGORITHMS[index]!;
		return {
			algorithm,
			points: legacyLoopPoints(request.start, targetKm, bearing, favoritePoints, algorithm),
			rejectionReasons: ['ROUTING_ERROR'],
			error: outcome.reason instanceof Error ? outcome.reason.message : 'Baseline routing failed',
		};
	});
}

function legacyLoopPoints(
	start: LatLng,
	targetKm: number,
	bearing: number,
	favorites: LatLng[],
	algorithm: LegacyAlgorithm,
): LatLng[] {
	if (algorithm === 'tangent') {
		const radius = Math.max(0.18, targetKm / (2 * Math.PI) * 0.9);
		const center = pointAt(start, radius, bearing);
		const startBearing = (bearing + 180) % 360;
		const perimeter = [90, 180, 270].map((offset) => pointAt(center, radius, startBearing + offset));
		return [start, ...orderAround(center, [...favorites, ...perimeter], startBearing), start];
	}

	if (algorithm === 'orbit-same' || algorithm === 'orbit-near') {
		const radius = Math.max(0.18, targetKm / (2 + 2 * Math.PI) * 0.9);
		const gap = algorithm === 'orbit-near' ? 9 : 0;
		const outboundBearing = bearing - gap;
		const outbound = pointAt(start, radius, outboundBearing);
		const inbound = pointAt(start, radius, bearing + gap);
		const perimeter = [90, 180, 270].map((offset) => pointAt(start, radius, bearing + offset));
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
		const pattern = patterns[((Math.round(bearing) % patterns.length) + patterns.length) % patterns.length]!;
		const radius = Math.max(0.18, targetKm / 11.5 * 0.9);
		const centerBearing = bearing + (seededUnit(bearing + 7) - 0.5) * 28;
		const centerDistance = radius * (0.8 + seededUnit(bearing + 11) * 0.35);
		const center = pointAt(start, centerDistance, centerBearing);
		const startBearing = centerBearing + 180;
		const detours = pattern.map((offset, index) =>
			irregularPoint(center, radius, startBearing + offset, bearing + index * 31),
		);
		return [start, detours[0]!, ...favorites, ...detours.slice(1), start];
	}

	const radius = Math.max(0.18, targetKm / (2 * Math.PI) * 0.87);
	const detours = [0, 120, 240].map((offset) => pointAt(start, radius, bearing + offset));
	return [start, ...orderAround(start, [...favorites, ...detours], 180), start];
}

function pointAt(
	[lat, lng]: LatLng,
	distanceKm: number,
	bearingDegrees: number,
): LatLng {
	const angularDistance = distanceKm / 6371;
	const direction = bearingDegrees * Math.PI / 180;
	const latitude = lat * Math.PI / 180;
	const longitude = lng * Math.PI / 180;
	const nextLatitude = Math.asin(
		Math.sin(latitude) * Math.cos(angularDistance) +
		Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(direction),
	);
	const nextLongitude = longitude + Math.atan2(
		Math.sin(direction) * Math.sin(angularDistance) * Math.cos(latitude),
		Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
	);
	return [nextLatitude * 180 / Math.PI, nextLongitude * 180 / Math.PI];
}

function seededUnit(seed: number): number {
	const value = Math.sin(seed * 12.9898) * 43758.5453;
	return value - Math.floor(value);
}

function irregularPoint(center: LatLng, radius: number, direction: number, seed: number): LatLng {
	return pointAt(
		center,
		radius * (0.72 + seededUnit(seed) * 0.56),
		direction + (seededUnit(seed + 19) - 0.5) * 36,
	);
}

function angleFrom(center: LatLng, [lat, lng]: LatLng): number {
	const latitudeScale = Math.cos(center[0] * Math.PI / 180);
	return (Math.atan2((lng - center[1]) * latitudeScale, lat - center[0]) * 180 / Math.PI + 360) % 360;
}

function orderAround(center: LatLng, points: LatLng[], startBearing: number): LatLng[] {
	return points.sort(
		(a, b) =>
		(angleFrom(center, a) - startBearing + 360) % 360 -
		(angleFrom(center, b) - startBearing + 360) % 360,
	);
}

function seedBearing(seed: string): number {
	let value = 0;
	for (let index = 0; index < seed.length; index += 1) value = Math.imul(value ^ seed.charCodeAt(index), 16777619);
	return (value >>> 0) % 360;
}
