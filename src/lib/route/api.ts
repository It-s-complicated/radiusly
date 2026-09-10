import type { WalkingRequest, RouteResult, RouteDebug } from '$lib/types';

/** One request; all graph searches, candidate generation and scoring run on the server. */
export async function walkingLoop(
	request: WalkingRequest,
): Promise<{ route: RouteResult; debug: RouteDebug }> {
	const response = await fetch('/api/routing', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(request),
	});
	const data = await response.json();
	if (!response.ok)
		throw Object.assign(new Error(data.message || 'Route generation failed.'), {
			code: data.code,
			details: data.details,
		});
	return data;
}
