import { describe, expect, it } from 'vitest';
import { generateRoute } from './route-generation';
import type { IsodistanceContour, ProviderRoute, RouteProvider } from './route-generation';
import type { RouteGenerationRequest, RoutedEdge } from '$lib/route/contracts';
import type { LatLng, LngLat } from '$lib/types';

const request: RouteGenerationRequest = {
	start: [52.52, 13.4],
	target: { mode: 'distance', value: 4 },
	paceKmH: 5,
	requiredSpots: [],
	preferences: { backtracking: 'avoid' },
	seed: 'repeatable-seed',
};

function contourRing(distanceKm: number): LngLat[] {
	return Array.from({ length: 37 }, (_, index) => {
		const angle = index / 36 * Math.PI * 2;
		return [13.4 + Math.sin(angle) * distanceKm / 70, 52.52 + Math.cos(angle) * distanceKm / 111];
	});
}

class MockProvider implements RouteProvider {
	readonly maximumCalls = 12;
	usedCalls = 0;
	readonly isodistanceCalls: number[][] = [];

	constructor(private readonly routeLengthKm = 4) {}

	async isodistance(_start: LatLng, distancesKm: number[]): Promise<IsodistanceContour[]> {
		this.usedCalls += 1;
		this.isodistanceCalls.push(distancesKm);
		return distancesKm.map((distanceKm) => ({ distanceKm, rings: [contourRing(distanceKm)] }));
	}

	async route(points: LatLng[]): Promise<ProviderRoute> {
		this.usedCalls += 1;
		return {
			distance: this.routeLengthKm * 1000,
			duration: 2880,
			geometry: { type: 'LineString', coordinates: points.map(([lat, lng]) => [lng, lat]) },
		};
	}

	async traceEdges(): Promise<RoutedEdge[]> {
		this.usedCalls += 1;
		return [];
	}
}

describe('network-aware route generation', () => {
	it('generates seeded contour candidates within the request budget', async () => {
		const provider = new MockProvider();
		const response = await generateRoute(request, provider, 'berlin-2026-08-16');

		expect(response.route.distance).toBe(4000);
		expect(response.route.scores.distanceErrorRatio).toBe(0);
		expect(response.debug.seed).toBe('repeatable-seed');
		expect(response.debug.generatorVersion).toBe('network-contours-1');
		expect(response.debug.graphDataVersion).toBe('berlin-2026-08-16');
		expect(response.debug.candidates).toHaveLength(4);
		expect(response.debug.candidates.map(({ candidate }) => candidate.anchorCount)).toEqual([2, 2, 3, 3]);
		expect(response.debug.requestBudget.usedRouterCalls).toBe(9);
		expect(response.debug.candidates.every(({ rejectionReasons: reasons }) => reasons.length === 0)).toBe(true);

		const coordinates = response.route.geometry.coordinates;
		expect(coordinates[0]).toEqual(coordinates.at(-1));
	});

	it('adapts contour distance from routed distance feedback', async () => {
		const provider = new MockProvider(3.5);
		await generateRoute(request, provider, 'graph');

		expect(provider.isodistanceCalls).toHaveLength(2);
		expect(provider.isodistanceCalls[1]).toHaveLength(1);
		expect(provider.isodistanceCalls[1]![0]).toBeCloseTo(1.114, 3);
	});

	it('reproduces candidate anchors from the same seed', async () => {
		const first = await generateRoute(request, new MockProvider(), 'graph');
		const second = await generateRoute(request, new MockProvider(), 'graph');

		expect(second.debug.candidates.map(({ candidate }) => candidate.anchors)).toEqual(
			first.debug.candidates.map(({ candidate }) => candidate.anchors),
		);
	});
});
