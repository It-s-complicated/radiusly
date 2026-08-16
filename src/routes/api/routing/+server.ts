import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { generateRoute, RouteGenerationError } from '$lib/server/route-generation';
import {
	cacheRoute,
	enforceRouteRateLimit,
	getCachedRoute,
	RouteCapacityError,
	RouteConfigurationError,
	RouteRateLimitError,
	withGenerationSlot,
} from '$lib/server/route-runtime';
import { ValhallaClient } from '$lib/server/valhalla';
import type { RouteGenerationRequest } from '$lib/route/contracts';
import type { LatLng, Pace } from '$lib/types';
import type { RequestHandler } from './$types';

const MAXIMUM_VALHALLA_CALLS = 12;
const TOTAL_TIMEOUT_MS = 18_000;

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const startedAt = performance.now();
	const requestId = crypto.randomUUID();
	try {
		if (Number(request.headers.get('content-length') ?? 0) > 16_384) {
			return json({ code: 'INVALID_REQUEST', message: 'Route request is too large' }, { status: 413 });
		}
		const input = validateRequest(await request.json());
		const identity = locals.user?.id ?? getClientAddress();
		await enforceRouteRateLimit(identity);

		const baseUrl = env.VALHALLA_URL;
		const graphDataVersion = env.VALHALLA_GRAPH_VERSION;
		const apiToken = env.VALHALLA_API_TOKEN;
		if (!baseUrl || !graphDataVersion || !apiToken) {
			throw new RouteConfigurationError('VALHALLA_URL, VALHALLA_GRAPH_VERSION, and VALHALLA_API_TOKEN must be configured');
		}
		const cached = await getCachedRoute(input, graphDataVersion);
		if (cached) {
			logRouteRequest(requestId, 'cache_hit', performance.now() - startedAt, cached.debug.selectedCandidateId);
			return json(cached, { headers: { 'cache-control': 'private, no-store' } });
		}

		const response = await withGenerationSlot(async () => {
			const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS);
			const valhalla = new ValhallaClient({
				baseUrl,
				apiToken,
				signal,
				maximumCalls: MAXIMUM_VALHALLA_CALLS,
				maximumConcurrency: 3,
				callTimeoutMs: 5_000,
			});
			return await generateRoute(input, valhalla, graphDataVersion);
		});
		await cacheRoute(input, graphDataVersion, response);
		logRouteRequest(requestId, 'generated', performance.now() - startedAt, response.debug.selectedCandidateId);
		return json(response, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return json({ code: 'INVALID_REQUEST', message: error.message }, { status: 400 });
		}
		if (error instanceof RouteRateLimitError) {
			return json(
				{ code: 'RATE_LIMITED', message: error.message },
				{ status: 429, headers: { 'retry-after': String(error.retryAfterSeconds) } },
			);
		}
		if (error instanceof RouteCapacityError) {
			return json({ code: 'AT_CAPACITY', message: error.message }, { status: 503 });
		}
		if (error instanceof RouteGenerationError) {
			logRouteRequest(requestId, error.code.toLowerCase(), performance.now() - startedAt);
			return json(
				{
					code: error.code,
					message: error.message,
					debug: error.debug,
				},
				{ status: error.code === 'ROUTING_UPSTREAM' ? 502 : error.code === 'TIMEOUT' ? 504 : 422 },
			);
		}
		if (error instanceof RouteConfigurationError) {
			return json({ code: 'SERVER_CONFIGURATION', message: error.message }, { status: 500 });
		}
		const message = error instanceof Error ? error.message : 'Route generation failed';
		const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
		logRouteRequest(requestId, timedOut ? 'timeout' : 'error', performance.now() - startedAt);
		return json(
			{ code: timedOut ? 'TIMEOUT' : 'SERVER_ERROR', message },
			{ status: timedOut ? 504 : 500 },
		);
	}
};

function validateRequest(value: unknown): RouteGenerationRequest {
	const input = record(value, 'request');
	const target = record(input.target, 'target');
	const mode = target.mode;
	if (mode !== 'distance' && mode !== 'time') throw new TypeError('target.mode must be distance or time');
	const targetValue = finiteNumber(target.value, 'target.value');
	if (mode === 'distance' && (targetValue < 0.5 || targetValue > 30)) {
		throw new TypeError('Distance target must be between 0.5 and 30 km');
	}
	if (mode === 'time' && (targetValue < 10 || targetValue > 360)) {
		throw new TypeError('Time target must be between 10 and 360 minutes');
	}
	const paceValue = finiteNumber(input.paceKmH, 'paceKmH');
	if (paceValue !== 4 && paceValue !== 5 && paceValue !== 6) throw new TypeError('paceKmH must be 4, 5, or 6');
	if (mode === 'time' && targetValue / 60 * paceValue > 30) throw new TypeError('Time and pace exceed the 30 km route limit');
	const requiredSpots = input.requiredSpots;
	if (!Array.isArray(requiredSpots) || requiredSpots.length > 4) {
		throw new TypeError('requiredSpots must contain at most four spots');
	}
	const preferences = record(input.preferences, 'preferences');
	if (preferences.backtracking !== 'avoid' && preferences.backtracking !== 'allow-short') {
		throw new TypeError('preferences.backtracking must be avoid or allow-short');
	}
	if (typeof input.seed !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.seed)) {
		throw new TypeError('seed must contain 1–64 letters, digits, underscores, or hyphens');
	}

	return {
		start: point(input.start, 'start'),
		target: { mode, value: targetValue },
		paceKmH: paceValue as Pace,
		requiredSpots: requiredSpots.map((spot, index) => {
			const item = record(spot, `requiredSpots[${index}]`);
			return {
				name: typeof item.name === 'string' ? item.name.slice(0, 120) : undefined,
				coordinates: point(item.coordinates, `requiredSpots[${index}].coordinates`),
			};
		}),
		preferences: { backtracking: preferences.backtracking },
		seed: input.seed,
	};
}

function point(value: unknown, name: string): LatLng {
	if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${name} must be [latitude, longitude]`);
	const lat = finiteNumber(value[0], `${name} latitude`);
	const lng = finiteNumber(value[1], `${name} longitude`);
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new TypeError(`${name} is outside valid coordinate bounds`);
	return [lat, lng];
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
	return value;
}

function logRouteRequest(requestId: string, outcome: string, elapsedMs: number, candidateId?: string): void {
	console.info(JSON.stringify({
		event: 'route_generation',
		requestId,
		outcome,
		candidateId,
		elapsedMs: Math.round(elapsedMs),
	}));
}
