import { describe, it, expect, vi, beforeEach } from 'vitest';
import { walkingLoop } from './walking-loop';

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

describe('walkingLoop', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = vi.fn((url: string) => {
			if (url.includes('routing.openstreetmap.de')) {
				return Promise.resolve(
					new Response(JSON.stringify(mockOsrmResponse), {
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

	it('throws ROUTE_QUALITY when no candidate is acceptable', async () => {
		globalThis.fetch = vi.fn(() => {
			// 8 km route for a 4 km target — 100% distance error, never acceptable
			return Promise.resolve(
				new Response(
					JSON.stringify({
						code: 'Ok',
						routes: [
							{
								distance: 8000,
								duration: 3600,
								weight: 3600,
								geometry: {
									coordinates: [
										[13.4, 52.52],
										[13.41, 52.5201],
										[13.4, 52.5202],
									],
								},
							},
						],
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			);
		}) as any;
		await expect(walkingLoop([52.52, 13.4], 4, 25)).rejects.toMatchObject({
			code: 'ROUTE_QUALITY',
		});
	});
});
