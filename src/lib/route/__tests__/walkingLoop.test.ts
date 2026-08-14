import { describe, it, expect, vi, beforeEach } from 'vitest';
import { walkingLoop } from '../api';

const mockOsrmResponse = {
	code: 'Ok',
	routes: [
		{
			distance: 4000,
			duration: 1800,
			weight: 1800,
			geometry: {
				coordinates: [
					[13.4, 52.52],
					[13.41, 52.5201],
					[13.4, 52.5202],
				],
			},
		},
	],
};

const mockOverpassResponse = {
	elements: [],
};

describe('walkingLoop', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = vi.fn((url: string) => {
			if (url.includes('/api/routing')) {
				return Promise.resolve(
					new Response(JSON.stringify(mockOsrmResponse), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
				);
			}
			if (url.includes('/api/stations')) {
				return Promise.resolve(
					new Response(JSON.stringify(mockOverpassResponse), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					}),
				);
			}
			return Promise.reject(new Error(`Unknown URL: ${url}`));
		}) as any;
	});

	it('returns a route result for valid input', async () => {
		const route = await walkingLoop([52.52, 13.4], 4, 25);
		expect(route).toBeDefined();
		expect(route.distance).toBe(4000);
		expect(route.candidate).toBeDefined();
		expect(route.candidate!.algorithm).toBe('organic');
	});

	it('returns a route result for spaghetti algorithm', async () => {
		const route = await walkingLoop([52.52, 13.4], 4, 25, [], 'spaghetti');
		expect(route).toBeDefined();
	});
});
