import { describe, it, expect } from 'vitest';
import { targetKilometers, pointAt, loopPoints } from './shapes';

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

describe('loopPoints', () => {
	const start: [number, number] = [52.52, 13.4];

	it('generates 5 points for organic shape', () => {
		expect(loopPoints(start, 4).length).toBe(5);
	});

	it('generates 5 points for tangent shape', () => {
		expect(loopPoints(start, 4, 25, [], 1, 'tangent').length).toBe(5);
	});

	it('generates 6 points for spaghetti shape', () => {
		const points = loopPoints(start, 4, 25, [], 1, 'spaghetti');
		expect(points.length).toBe(6);
	});

	it('spaghetti first point is not a simple projection', () => {
		const points = loopPoints(start, 4, 25, [], 1, 'spaghetti');
		const simple = pointAt(start, (4 / 11.5) * 0.9, 25);
		expect(points[1]).not.toEqual(simple);
	});

	it('spaghetti maintains consistent length across bearings', () => {
		const lengths = [25, 92, 159].map((b) => loopPoints(start, 4, b, [], 1, 'spaghetti').length);
		expect(lengths).toEqual([6, 6, 6]);
	});

	it('spaghetti-cross generates 5 points', () => {
		expect(loopPoints(start, 4, 25, [], 1, 'spaghetti-cross').length).toBe(5);
	});

	it('spaghetti-safe generates 5 points', () => {
		expect(loopPoints(start, 4, 25, [], 1, 'spaghetti-safe').length).toBe(5);
	});

	it('spaghetti creates different signatures for different bearings', () => {
		const signatures = [25, 92, 159, 226].map((bearing) => {
			const points = loopPoints(start, 4, bearing, [], 1, 'spaghetti');
			const lengths = points
				.slice(1)
				.map((point, index) =>
					Math.hypot(point[0] - points[index]![0], (point[1] - points[index]![1]) * 0.61),
				);
			const total = lengths.reduce((sum, length) => sum + length, 0);
			return lengths.map((length) => (length / total).toFixed(2)).join(',');
		});
		expect(new Set(signatures).size).toBeGreaterThan(2);
	});

	it('orbit-same outbound equals inbound', () => {
		const orbitSame = loopPoints(start, 4, 25, [], 1, 'orbit-same');
		expect(orbitSame[1]).toEqual(orbitSame.at(-2));
	});

	it('orbit-near outbound differs from inbound', () => {
		const orbitNear = loopPoints(start, 4, 25, [], 1, 'orbit-near');
		expect(orbitNear[1]).not.toEqual(orbitNear.at(-2));
	});
});

// Additional assertions from test-route.mjs
describe('regression: spaghetti signatures', () => {
	it('produces distinct patterns across bearings modulo 3', () => {
		const start: [number, number] = [52.52, 13.4];
		const sigSet = new Set(
			[25, 92, 159].map((bearing) => {
				const pts = loopPoints(start, 4, bearing, [], 1, 'spaghetti');
				return pts.map((p) => p.map((c) => c.toFixed(5)).join(',')).join('|');
			}),
		);
		expect(sigSet.size).toBeGreaterThan(1);
	});
});
