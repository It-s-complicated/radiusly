import { describe, expect, it } from 'vitest';
import type { RouteGenerationRequest, RouteGenerationResponse } from '$lib/route/contracts';
import {
	cacheRoute,
	enforceRouteRateLimit,
	getCachedRoute,
	RouteCapacityError,
	RouteRateLimitError,
	withGenerationSlot,
} from './route-runtime';

const request: RouteGenerationRequest = {
	start: [52.52, 13.4],
	target: { mode: 'distance', value: 4 },
	paceKmH: 5,
	requiredSpots: [],
	preferences: { backtracking: 'avoid' },
	seed: 'runtime-test',
};

const response: RouteGenerationResponse = {
	route: {
		distance: 4_000,
		duration: 2_880,
		geometry: { type: 'LineString', coordinates: [[13.4, 52.52], [13.4, 52.52]] },
		candidate: {
			id: 'candidate-1',
			anchorCount: 2,
			contourDistanceKm: 1,
			traversal: 'clockwise',
			adjustment: 0,
			anchors: [],
		},
		scores: {
			distanceErrorRatio: 0,
			distanceErrorMeters: 0,
			repeatedDistanceMeters: 0,
			repeatRatio: 0,
			longestRepeatedRunMeters: 0,
			immediateReversalMeters: 0,
			unsuitableAccessMeters: 0,
			requiredSpotsMissed: 0,
			softExposures: {
				majorRoadMeters: 0,
				stepsMeters: 0,
				tunnelMeters: 0,
				roughSurfaceMeters: 0,
			},
			total: 0,
		},
	},
	debug: {
		schemaVersion: 1,
		generatedAt: '2026-08-16T00:00:00.000Z',
		seed: request.seed,
		generatorVersion: 'network-contours-1',
		graphDataVersion: 'graph-a',
		input: { ...request, targetKm: 4 },
		candidates: [],
		selectedCandidateId: 'candidate-1',
		requestBudget: { maximumValhallaCalls: 12, usedValhallaCalls: 9, elapsedMs: 10 },
	},
};

describe('route runtime controls', () => {
	it('isolates cached routes by graph-data version', async () => {
		await cacheRoute(request, 'graph-a', response);

		expect(await getCachedRoute(request, 'graph-a')).toEqual(response);
		expect(await getCachedRoute(request, 'graph-b')).toBeUndefined();
	});

	it('limits one identity to ten requests per minute', async () => {
		const identity = `rate-test-${crypto.randomUUID()}`;
		for (let index = 0; index < 10; index += 1) {
			await enforceRouteRateLimit(identity);
		}

		await expect(enforceRouteRateLimit(identity)).rejects.toBeInstanceOf(RouteRateLimitError);
	});

	it('allows only two active generation runs', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = withGenerationSlot(() => gate);
		const second = withGenerationSlot(() => gate);

		await expect(withGenerationSlot(async () => undefined)).rejects.toBeInstanceOf(RouteCapacityError);
		release();
		await Promise.all([first, second]);
	});
});
