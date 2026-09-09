import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseWalkingRequest } from '$lib/server/routing/request';
import { routeOnServer } from '$lib/server/routing/service';
import { RoutingError } from '$lib/server/routing/graph';

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Bound actual bytes, including chunked requests, before parsing untrusted input.
		const reader = request.body?.getReader();
		if (!reader)
			return json(
				{ code: 'INVALID_INPUT', message: 'A route request is required.' },
				{ status: 400 },
			);
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 8192) {
				await reader.cancel();
				return json(
					{ code: 'INVALID_INPUT', message: 'Route request is too large.' },
					{ status: 413 },
				);
			}
			chunks.push(value);
		}
		const input = parseWalkingRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
		return json(await routeOnServer(input, request.signal), {
			headers: { 'cache-control': 'no-store' },
		});
	} catch (error) {
		if (error instanceof SyntaxError)
			return json({ code: 'INVALID_INPUT', message: 'Invalid JSON.' }, { status: 400 });
		if (error instanceof RoutingError) {
			const statuses: Record<string, number> = {
				INVALID_INPUT: 400,
				BUSY: 503,
				GRAPH_UNAVAILABLE: 503,
				CANCELLED: 408,
				ROUTING_FAILED: 500,
			};
			return json(
				{ code: error.code, message: error.message, details: error.details },
				{ status: statuses[error.code] ?? 422 },
			);
		}
		console.error('Routing request failed:', error);
		return json({ code: 'ROUTING_FAILED', message: 'Route generation failed.' }, { status: 500 });
	}
};
