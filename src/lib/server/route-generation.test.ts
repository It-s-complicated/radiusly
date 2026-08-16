import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRoute } from './route-generation';
import { ValhallaClient } from './valhalla';
import type { RouteGenerationRequest } from '$lib/route/contracts';

const request: RouteGenerationRequest = {
	start: [52.52, 13.4],
	target: { mode: 'distance', value: 4 },
	paceKmH: 5,
	requiredSpots: [],
	preferences: { backtracking: 'avoid' },
	seed: 'repeatable-seed',
};

function contourRing(distanceKm: number): [number, number][] {
	return Array.from({ length: 37 }, (_, index) => {
		const angle = index / 36 * Math.PI * 2;
		return [13.4 + Math.sin(angle) * distanceKm / 70, 52.52 + Math.cos(angle) * distanceKm / 111];
	});
}

function mockValhalla(routeLengthKm = 4) {
	return vi.fn(async (_url: string, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		if (Array.isArray(body.contours)) {
			return Response.json({
				type: 'FeatureCollection',
				features: body.contours.map((value) => {
					const contour = value as { distance: number };
					return {
						type: 'Feature',
						properties: { contour: contour.distance },
						geometry: { type: 'Polygon', coordinates: [contourRing(contour.distance)] },
					};
				}),
			});
		}
		if (Array.isArray(body.locations)) {
			const locations = body.locations as { lat: number; lon: number; type: string }[];
			return Response.json({
				routes: [{
					distance: routeLengthKm * 1000,
					duration: 2880,
					geometry: {
						type: 'LineString',
						coordinates: locations.map(({ lon, lat }) => [lon, lat]),
					},
				}],
			});
		}
		if (Array.isArray(body.shape)) {
			const shape = body.shape as { lat: number; lon: number }[];
			return Response.json({
				edges: shape.slice(1).map((_, index) => ({
					id: index + 1,
					way_id: index + 100,
					length: routeLengthKm / (shape.length - 1),
					begin_shape_index: index,
					end_shape_index: index + 1,
					traversability: 'both',
				})),
			});
		}
		return new Response('Unexpected request', { status: 500 });
	});
}

function client(): ValhallaClient {
	return new ValhallaClient({
		baseUrl: 'https://valhalla.test',
		apiToken: 'secret',
		signal: new AbortController().signal,
		maximumCalls: 12,
		maximumConcurrency: 3,
		callTimeoutMs: 1000,
	});
}

describe('network-aware route generation', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('generates seeded contour candidates within the request budget', async () => {
		const fetchMock = mockValhalla();
		vi.stubGlobal('fetch', fetchMock);
		const response = await generateRoute(request, client(), 'berlin-2026-08-16');

		expect(response.route.distance).toBe(4000);
		expect(response.route.scores.distanceErrorRatio).toBe(0);
		expect(response.debug.seed).toBe('repeatable-seed');
		expect(response.debug.generatorVersion).toBe('network-contours-1');
		expect(response.debug.graphDataVersion).toBe('berlin-2026-08-16');
		expect(response.debug.candidates).toHaveLength(4);
		expect(response.debug.candidates.map(({ candidate }) => candidate.anchorCount)).toEqual([2, 2, 3, 3]);
		expect(response.debug.requestBudget.usedValhallaCalls).toBe(9);
		expect(response.debug.candidates.every(({ rejectionReasons: reasons }) => reasons.length === 0)).toBe(true);

		const routeBodies = fetchMock.mock.calls
			.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
			.filter((body) => body.shape_format === 'geojson');
		for (const body of routeBodies) {
			const locations = body.locations as { type: string }[];
			expect(locations[0]?.type).toBe('break');
			expect(locations.at(-1)?.type).toBe('break');
			expect(locations.slice(1, -1).every(({ type }) => type === 'through')).toBe(true);
		}
	});

	it('adapts contour distance from routed distance feedback', async () => {
		vi.stubGlobal('fetch', mockValhalla(3.5));
		await generateRoute(request, client(), 'graph');

		const calls = vi.mocked(fetch).mock.calls.map(([, init]) =>
			JSON.parse(String(init?.body)) as Record<string, unknown>
		);
		const contourRequests = calls.filter((body) => Array.isArray(body.contours));
		expect(contourRequests).toHaveLength(2);
		const adjustedContours = contourRequests[1]?.contours as { distance: number }[];
		expect(adjustedContours).toHaveLength(1);
		expect(adjustedContours[0]!.distance).toBeCloseTo(1.114, 3);
	});

	it('reproduces candidate anchors from the same seed', async () => {
		vi.stubGlobal('fetch', mockValhalla());
		const first = await generateRoute(request, client(), 'graph');
		vi.stubGlobal('fetch', mockValhalla());
		const second = await generateRoute(request, client(), 'graph');

		expect(second.debug.candidates.map(({ candidate }) => candidate.anchors)).toEqual(
			first.debug.candidates.map(({ candidate }) => candidate.anchors),
		);
	});

	it('classifies an isochrone failure as an upstream error', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));

		await expect(generateRoute(request, client(), 'graph')).rejects.toMatchObject({
			code: 'ROUTING_UPSTREAM',
		});
	});
});
