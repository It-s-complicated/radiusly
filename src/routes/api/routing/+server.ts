import { json } from '@sveltejs/kit';
import { walkingLoop } from '$lib/server/walking-loop';
import type { Algorithm, LatLng } from '$lib/types';
import type { RequestHandler } from './$types';

const ALGORITHMS = new Set([
	'organic',
	'tangent',
	'orbit-same',
	'orbit-near',
	'spaghetti',
]);

export const POST: RequestHandler = async ({ request }) => {
	try {
		if (Number(request.headers.get('content-length') ?? 0) > 16_384) {
			return json(
				{ code: 'INVALID_REQUEST', message: 'Route request is too large' },
				{ status: 413 },
			);
		}
		const input = validateRequest(await request.json());
		const route = await walkingLoop(
			input.start,
			input.targetKm,
			input.bearing,
			input.favorites,
			input.algorithm,
		);
		return json(route, { headers: { 'cache-control': 'private, no-store' } });
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) {
			return json({ code: 'INVALID_REQUEST', message: error.message }, { status: 400 });
		}
		const err = error as Error & { code?: string };
		if (err.code === 'ROUTE_QUALITY') {
			return json({ code: err.code, message: err.message }, { status: 422 });
		}
		const message = err.message || 'Route generation failed';
		return json({ code: 'ROUTING_UNAVAILABLE', message }, { status: 502 });
	}
};

function validateRequest(value: unknown): {
	start: LatLng;
	targetKm: number;
	bearing: number;
	favorites: LatLng[];
	algorithm: Algorithm;
} {
	const input = record(value, 'request');
	const targetKm = finiteNumber(input.targetKm, 'targetKm');
	if (targetKm < 0.5 || targetKm > 30) {
		throw new TypeError('targetKm must be between 0.5 and 30 km');
	}
	const bearing = finiteNumber(input.bearing, 'bearing');
	if (bearing < 0 || bearing >= 360) {
		throw new TypeError('bearing must be between 0 and 360');
	}
	if (typeof input.algorithm !== 'string' || !ALGORITHMS.has(input.algorithm)) {
		throw new TypeError(`algorithm must be one of ${[...ALGORITHMS].join(', ')}`);
	}
	if (!Array.isArray(input.favorites) || input.favorites.length > 8) {
		throw new TypeError('favorites must contain at most eight points');
	}
	return {
		start: point(input.start, 'start'),
		targetKm,
		bearing,
		favorites: input.favorites.map((favorite, index) =>
			point(favorite, `favorites[${index}]`),
		),
		algorithm: input.algorithm as Algorithm,
	};
}

function point(value: unknown, name: string): LatLng {
	if (!Array.isArray(value) || value.length !== 2)
		throw new TypeError(`${name} must be [latitude, longitude]`);
	const lat = finiteNumber(value[0], `${name} latitude`);
	const lng = finiteNumber(value[1], `${name} longitude`);
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
		throw new TypeError(`${name} is outside valid coordinate bounds`);
	return [lat, lng];
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new TypeError(`${name} must be a finite number`);
	return value;
}
