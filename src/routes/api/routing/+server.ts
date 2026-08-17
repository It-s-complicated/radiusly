import { json } from '@sveltejs/kit';
import { GeometricRouter } from '$lib/server/geometric-router';
import { generateRoute, RouteGenerationError } from '$lib/server/route-generation';
import type { RouteGenerationRequest } from '$lib/route/contracts';
import type { LatLng, Pace } from '$lib/types';
import type { RequestHandler } from './$types';

const OSRM_BASE = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

// ponytail: single global 1 req/s gate per instance; FOSSGIS limits by IP anyway. Per-user fairness if multi-user ever matters.
let upstreamQueue: Promise<unknown> = Promise.resolve();
let lastUpstreamCall = 0;

function throttleUpstream<T>(call: () => Promise<T>): Promise<T> {
	const run = upstreamQueue.then(async () => {
		const wait = 1100 - (Date.now() - lastUpstreamCall);
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastUpstreamCall = Date.now();
		return call();
	});
	upstreamQueue = run.catch(() => {});
	return run;
}
const GRAPH_DATA_VERSION = 'geometric-1';
const MAXIMUM_ROUTER_CALLS = 12;

export const POST: RequestHandler = async ({ request }) => {
	try {
		if (Number(request.headers.get('content-length') ?? 0) > 16_384) {
			return json({ code: 'INVALID_REQUEST', message: 'Route request is too large' }, { status: 413 });
		}
		const input = validateRequest(await request.json());
		const response = await generateRoute(
			input,
			new GeometricRouter(MAXIMUM_ROUTER_CALLS),
			GRAPH_DATA_VERSION,
		);
		return json(response, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return json({ code: 'INVALID_REQUEST', message: error.message }, { status: 400 });
		}
		if (error instanceof RouteGenerationError) {
			return json({ code: error.code, message: error.message, debug: error.debug }, { status: 422 });
		}
		const message = error instanceof Error ? error.message : 'Route generation failed';
		return json({ code: 'SERVER_ERROR', message }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ url }) => {
	const coordinates = url.searchParams.get('coordinates');

	if (!coordinates || !/^-?\d+\.?\d*,-?\d+\.?\d*(;-?\d+\.?\d*,-?\d+\.?\d*)+$/.test(coordinates)) {
		return new Response('Invalid coordinates. Expected: lng,lat;lng,lat;...', {
			status: 400,
		});
	}

	const coords = coordinates.split(';');
	if (coords.length < 2) {
		return new Response('At least two coordinate pairs required', { status: 400 });
	}

	try {
		const response = await throttleUpstream(() =>
			fetch(
				`${OSRM_BASE}/${coordinates}?overview=full&geometries=geojson&steps=false`,
				{
					signal: AbortSignal.timeout(15000),
					headers: {
						'User-Agent': 'Radiusly/0.1 (neighborhood-walk-planner)',
					},
				},
			),
		);

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			return new Response(text || `OSRM error (${response.status})`, {
				status: 502,
			});
		}

		const data = await response.json();
		return new Response(JSON.stringify(data), {
			headers: {
				'content-type': 'application/json',
				'cache-control': 'no-store',
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Routing upstream request failed';
		return new Response(message, { status: 502 });
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