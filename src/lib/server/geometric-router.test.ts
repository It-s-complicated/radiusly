import { describe, expect, it } from 'vitest';
import { distance, scoreRoute } from '$lib/route/edge-scoring';
import type { RouteGenerationRequest, RequiredSpot } from '$lib/route/contracts';
import type { LatLng, LngLat } from '$lib/types';
import { GeometricRouter } from './geometric-router';
import { generateRoute, RouteGenerationError } from './route-generation';

const request: RouteGenerationRequest = {
	start: [52.52, 13.4],
	target: { mode: 'distance', value: 4 },
	paceKmH: 5,
	requiredSpots: [],
	preferences: { backtracking: 'avoid' },
	seed: 'repeatable-seed',
};

function geometricRouter(): GeometricRouter {
	return new GeometricRouter(12);
}

describe('geometric router', () => {
	it('builds closed circular isodistance rings at the requested radii', async () => {
		const router = new GeometricRouter();
		const start: LatLng = [52.52, 13.4];
		const contours = await router.isodistance(start, [1.1875, 0.975]);
		expect(contours.map(({ distanceKm }) => distanceKm)).toEqual([0.975, 1.188]);
		const ring = contours[0]!.rings[0]!;
		expect(ring.length).toBeGreaterThanOrEqual(64);
		expect(ring.length).toBeLessThanOrEqual(128);
		expect(ring[0]).toEqual(ring.at(-1));
		expect(distance([start[1], start[0]], ring[10]!)).toBeCloseTo(975, 0);
	});

	it('returns cumulative haversine distance across the given points', async () => {
		const router = new GeometricRouter();
		const points: LatLng[] = [[52.52, 13.4], [52.53, 13.41], [52.51, 13.42]];
		const routed = await router.route(points);
		const lngLat: LngLat[] = points.map(([lat, lng]) => [lng, lat]);
		let expected = 0;
		for (let index = 0; index < lngLat.length - 1; index += 1) {
			expected += distance(lngLat[index]!, lngLat[index + 1]!);
		}
		expect(routed.distance).toBeCloseTo(expected, 3);
		expect(routed.geometry.type).toBe('LineString');
		expect(routed.geometry.coordinates).toEqual(lngLat);
		expect(routed.duration).toBeGreaterThan(0);
	});

	it('rejects routes with fewer than two coordinates', async () => {
		await expect(new GeometricRouter().route([[52.52, 13.4]])).rejects.toThrow();
	});

	it('traces no edges and counts the call against the budget', async () => {
		const router = new GeometricRouter();
		await expect(router.traceEdges([[13.4, 52.52]])).resolves.toEqual([]);
		expect(router.usedCalls).toBe(1);
		expect(router.maximumCalls).toBe(12);
	});
});

describe('geometric route generation', () => {
	it('returns a closed loop within the distance contract, deterministically', async () => {
		const first = await generateRoute(request, geometricRouter(), 'geometric-1');
		const coordinates = first.route.geometry.coordinates;
		expect(coordinates.length).toBeGreaterThan(3);
		expect(coordinates[0]).toEqual(coordinates.at(-1));
		expect(first.route.distance).toBeGreaterThan(0);
		expect(first.route.scores.distanceErrorRatio).toBeLessThan(0.1);
		expect(first.route.scores.requiredSpotsMissed).toBe(0);
		expect(first.debug.generatorVersion).toBe('network-contours-1');
		expect(first.debug.graphDataVersion).toBe('geometric-1');
		expect(first.debug.candidates.length).toBeGreaterThanOrEqual(4);
		expect(first.debug.candidates.every(({ candidate }) => candidate.anchors.length > 0)).toBe(true);
		expect(first.debug.requestBudget.usedRouterCalls).toBeGreaterThan(0);
		expect(first.debug.requestBudget.usedRouterCalls).toBeLessThanOrEqual(
			first.debug.requestBudget.maximumRouterCalls,
		);

		const second = await generateRoute(request, geometricRouter(), 'geometric-1');
		expect(second.debug.candidates.map(({ candidate }) => candidate.anchors)).toEqual(
			first.debug.candidates.map(({ candidate }) => candidate.anchors),
		);
		expect(second.route.geometry.coordinates).toEqual(first.route.geometry.coordinates);
	});

	it('scores an on-loop required spot as visited and a distant one as missed', async () => {
		const baseline = await generateRoute(request, geometricRouter(), 'geometric-1');
		const onLoop: RequiredSpot = {
			name: 'cafe',
			coordinates: baseline.route.candidate.anchors[0]!,
		};

		const withSpot = await generateRoute({ ...request, requiredSpots: [onLoop] }, geometricRouter(), 'geometric-1');
		expect(withSpot.route.scores.requiredSpotsMissed).toBe(0);

		const missed = scoreRoute(baseline.route, [], 4000, [{ name: 'far', coordinates: [40.0, 13.4] }]);
		expect(missed.requiredSpotsMissed).toBe(1);
	});

	it('rejects a loop stretched across a far-away required spot', async () => {
		await expect(
			generateRoute(
				{ ...request, requiredSpots: [{ name: 'far', coordinates: [40.0, 13.4] }] },
				geometricRouter(),
				'geometric-1',
			),
		).rejects.toBeInstanceOf(RouteGenerationError);
	});
});