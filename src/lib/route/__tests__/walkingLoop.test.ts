import { describe, it, expect, vi, afterEach } from 'vitest';
import { walkingLoop } from '../api';
import type { WalkingRequest } from '$lib/types';

const input: WalkingRequest = {
	start: [52.52, 13.4],
	target: { mode: 'time', value: 45 },
	pace: 4,
	shape: 'spaghetti',
	search: 'dijkstra',
	spots: [[52.521, 13.4]],
	bearing: 25,
};
afterEach(() => vi.unstubAllGlobals());
describe('server loop request', () => {
	it('sends every input in one POST and returns server diagnostics', async () => {
		const result = { route: { distance: 3000 }, debug: { schemaVersion: 14 } };
		const fetch = vi.fn().mockResolvedValue(Response.json(result));
		vi.stubGlobal('fetch', fetch);
		expect(await walkingLoop(input)).toEqual(result);
		expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/routing', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input),
		});
	});
	it('preserves actionable server errors without falling back to external routing', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				Response.json(
					{ code: 'GRAPH_UNAVAILABLE', message: 'Build the regional graph.' },
					{ status: 503 },
				),
			);
		vi.stubGlobal('fetch', fetch);
		await expect(walkingLoop(input)).rejects.toMatchObject({
			code: 'GRAPH_UNAVAILABLE',
			message: 'Build the regional graph.',
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
