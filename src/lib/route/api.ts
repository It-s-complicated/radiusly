import type {
	RouteDebug,
	RouteGenerationRequest,
	RouteGenerationResponse,
} from '$lib/route/contracts';

export class RouteRequestError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly debug?: RouteDebug,
	) {
		super(message);
	}
}

export async function generateRoute(
	input: RouteGenerationRequest,
): Promise<RouteGenerationResponse> {
	const response = await fetch('/api/routing', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input),
	});
	const data: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		const error = asErrorResponse(data);
		throw new RouteRequestError(
			error.message || `Route generation failed (${response.status})`,
			error.code || 'ROUTE_REQUEST',
			error.debug,
		);
	}
	if (!data || typeof data !== 'object' || !('route' in data) || !('debug' in data)) {
		throw new RouteRequestError('Route server returned an invalid response', 'INVALID_RESPONSE');
	}
	return data as RouteGenerationResponse;
}

function asErrorResponse(value: unknown): {
	code?: string;
	message?: string;
	debug?: RouteDebug;
} {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	return {
		code: typeof record.code === 'string' ? record.code : undefined,
		message: typeof record.message === 'string' ? record.message : undefined,
		debug: record.debug as RouteDebug | undefined,
	};
}
