import { describe, it, expect } from 'vitest';
import { targetKilometers, pointAt, loopWaypoints } from './shapes';

describe('targetKilometers', () => {
	it('returns the value directly in distance mode', () => {
		expect(targetKilometers('distance', 4, 5)).toBe(4);
	});

	it('converts time to distance using pace', () => {
		expect(targetKilometers('time', 60, 5)).toBe(5);
	});
});

describe('pointAt', () => {
	it('moves north by approx 1km at equator', () => {
		const result = pointAt([0, 0], 1, 0);
		expect(Math.abs(result[0] - 0.009)).toBeLessThan(0.001);
	});
});

describe('loopWaypoints', () => {
	const start: [number, number] = [52.52, 13.4];

	it.each(['organic', 'tangent', 'orbit-same', 'orbit-near', 'spaghetti'] as const)(
		'tags %s waypoints independently of coincident coordinates',
		(algorithm) => {
			const baseline = loopWaypoints(start, 4, 25, [], 1, algorithm);
			const anchors = baseline.filter((waypoint) => waypoint.role === 'generated-anchor');
			const spots = [start, anchors[0]!.point, anchors[0]!.point];
			const waypoints = loopWaypoints(start, 4, 25, spots, 1, algorithm);
			expect(waypoints[0]).toEqual({ role: 'start', point: start });
			expect(waypoints.at(-1)).toEqual({ role: 'start', point: start });
			expect(
				waypoints
					.filter((waypoint) => waypoint.role === 'required-spot')
					.sort((a, b) => a.spotIndex - b.spotIndex),
			).toEqual(spots.map((point, spotIndex) => ({ role: 'required-spot', point, spotIndex })));
			expect(waypoints.filter((waypoint) => waypoint.role === 'generated-anchor')).toEqual(anchors);
		},
	);

	it('generates 5 points for organic shape', () => {
		expect(loopWaypoints(start, 4).length).toBe(5);
	});

	it('adds perimeter waypoints as routes get longer', () => {
		expect({
			organic: loopWaypoints(start, 16, 25, [], 1, 'organic').length,
			tangent: loopWaypoints(start, 16, 25, [], 1, 'tangent').length,
			orbit: loopWaypoints(start, 16, 25, [], 1, 'orbit-near').length,
		}).toEqual({ organic: 10, tangent: 9, orbit: 11 });
	});

	it('gives organic waypoints reproducible radial variation', () => {
		const points = (bearing: number) => loopWaypoints(start, 4, bearing).slice(1, -1);
		const first = points(25);
		const radii = first.map(({ point: [lat, lng] }) =>
			Math.hypot(lat - start[0], (lng - start[1]) * Math.cos((start[0] * Math.PI) / 180)),
		);
		expect(new Set(radii.map((radius) => radius.toFixed(6))).size).toBeGreaterThan(1);
		expect(points(92)).not.toEqual(first);
		expect(points(25)).toEqual(first);
	});

	it('generates 5 points for tangent shape', () => {
		expect(loopWaypoints(start, 4, 25, [], 1, 'tangent').length).toBe(5);
	});

	it('generates 6 points for spaghetti shape', () => {
		const points = loopWaypoints(start, 4, 25, [], 1, 'spaghetti');
		expect(points.length).toBe(6);
	});

	it('spaghetti first point is not a simple projection', () => {
		const points = loopWaypoints(start, 4, 25, [], 1, 'spaghetti');
		const simple = pointAt(start, (4 / 11.5) * 0.9, 25);
		expect(points[1]!.point).not.toEqual(simple);
	});

	it('spaghetti maintains consistent length across bearings', () => {
		const lengths = [25, 92, 159].map((b) => loopWaypoints(start, 4, b, [], 1, 'spaghetti').length);
		expect(lengths).toEqual([6, 6, 6]);
	});

	it('spaghetti creates different signatures for different bearings', () => {
		const signatures = [25, 92, 159, 226].map((bearing) => {
			const points = loopWaypoints(start, 4, bearing, [], 1, 'spaghetti');
			const lengths = points
				.slice(1)
				.map(({ point }, index) =>
					Math.hypot(
						point[0] - points[index]!.point[0],
						(point[1] - points[index]!.point[1]) * 0.61,
					),
				);
			const total = lengths.reduce((sum, length) => sum + length, 0);
			return lengths.map((length) => (length / total).toFixed(2)).join(',');
		});
		expect(new Set(signatures).size).toBeGreaterThan(2);
	});

	it('orbit-same outbound equals inbound', () => {
		const orbitSame = loopWaypoints(start, 4, 25, [], 1, 'orbit-same');
		expect(orbitSame[1]).toEqual(orbitSame.at(-2));
	});

	it('orbit-same encircles the start like orbit-near', () => {
		const radiusOf = ([lat, lng]: [number, number]) =>
			Math.hypot(lat - start[0], (lng - start[1]) * Math.cos((start[0] * Math.PI) / 180));
		const orbitSame = loopWaypoints(start, 4, 25, [], 1, 'orbit-same');
		const radius = radiusOf(orbitSame[1]!.point);
		expect(radius).toBeGreaterThan(0);
		for (const point of orbitSame.slice(2, -2))
			expect(radiusOf(point.point)).toBeCloseTo(radius, 4);
	});

	it('orbit-near outbound differs from inbound', () => {
		const orbitNear = loopWaypoints(start, 4, 25, [], 1, 'orbit-near');
		expect(orbitNear[1]).not.toEqual(orbitNear.at(-2));
	});
});

// Additional assertions from test-route.mjs
describe('regression: spaghetti signatures', () => {
	it('produces distinct patterns across bearings modulo 3', () => {
		const start: [number, number] = [52.52, 13.4];
		const sigSet = new Set(
			[25, 92, 159].map((bearing) => {
				const pts = loopWaypoints(start, 4, bearing, [], 1, 'spaghetti');
				return pts.map((p) => p.point.map((c) => c.toFixed(5)).join(',')).join('|');
			}),
		);
		expect(sigSet.size).toBeGreaterThan(1);
	});
});
