import type { WalkingRequest } from '$lib/types';
import { RoutingError } from './graph';

export function parseWalkingRequest(value: unknown): WalkingRequest {
	const invalid = () => {
		throw new RoutingError(
			'INVALID_INPUT',
			'Choose valid coordinates, a shape, A* or Dijkstra, and a walk between 0.5 and 30 km.',
		);
	};
	if (!value || typeof value !== 'object') return invalid();
	const v = value as Record<string, unknown>;
	const point = (p: unknown) =>
		Array.isArray(p) &&
		p.length === 2 &&
		p.every((x) => typeof x === 'number' && Number.isFinite(x)) &&
		Math.abs(p[0]) <= 85 &&
		Math.abs(p[1]) <= 180;
	if (
		!point(v.start) ||
		!Array.isArray(v.spots) ||
		v.spots.length > 8 ||
		!v.spots.every(point) ||
		typeof v.shape !== 'string' ||
		!['organic', 'tangent', 'orbit-same', 'orbit-near', 'spaghetti'].includes(v.shape) ||
		typeof v.search !== 'string' ||
		!['astar', 'dijkstra'].includes(v.search) ||
		![4, 5, 6].includes(v.pace as number) ||
		typeof v.bearing !== 'number' ||
		!Number.isFinite(v.bearing) ||
		v.bearing < 0 ||
		v.bearing >= 360 ||
		!v.target ||
		typeof v.target !== 'object'
	)
		return invalid();
	const target = v.target as { mode: unknown; value: unknown };
	if (
		typeof target.mode !== 'string' ||
		!['distance', 'time'].includes(target.mode) ||
		typeof target.value !== 'number' ||
		!Number.isFinite(target.value)
	)
		return invalid();
	const km = target.mode === 'time' ? (target.value / 60) * (v.pace as number) : target.value;
	if (km < 0.5 || km > 30) return invalid();
	return {
		start: v.start,
		spots: v.spots,
		shape: v.shape,
		search: v.search,
		pace: v.pace,
		bearing: v.bearing,
		target: { mode: target.mode, value: target.value },
	} as WalkingRequest;
}
