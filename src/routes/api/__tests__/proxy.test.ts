import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../routing/+server';
import { routeOnServer } from '$lib/server/routing/service';
import { RoutingError } from '$lib/server/routing/graph';

vi.mock('$lib/server/routing/service', () => ({ routeOnServer: vi.fn() }));
const input = {
	start: [52.52, 13.4],
	target: { mode: 'distance', value: 4 },
	pace: 5,
	shape: 'organic',
	search: 'dijkstra',
	spots: [],
	bearing: 25,
};
function post(body: string) {
	return POST({
		request: new Request('http://localhost/api/routing', { method: 'POST', body }),
	} as Parameters<typeof POST>[0]);
}
describe('routing endpoint', () => {
	beforeEach(() => vi.resetAllMocks());
	it('validates actual request bodies before admitting worker work', async () => {
		expect((await post('{')).status).toBe(400);
		expect((await post(JSON.stringify({ ...input, search: ['astar'] }))).status).toBe(400);
		expect((await post(JSON.stringify({ ...input, start: [91, 13] }))).status).toBe(400);
		expect((await post(' '.repeat(8193))).status).toBe(413);
		expect(routeOnServer).not.toHaveBeenCalled();
	});
	it('passes the selected algorithm and returns structured worker failures', async () => {
		vi.mocked(routeOnServer).mockRejectedValue(
			new RoutingError('GRAPH_UNAVAILABLE', 'Build regional data.'),
		);
		const response = await post(JSON.stringify(input));
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ code: 'GRAPH_UNAVAILABLE' });
		expect(routeOnServer).toHaveBeenCalledWith(input, expect.any(AbortSignal));
	});
});
