import { describe, it, expect } from 'vitest';
import {
	distance,
	pathRepetition,
	repeatedPathRatio,
	scoreRoute,
	routeIsAcceptable,
	needsMoreCandidates,
	compareRoutes,
} from './scoring';

describe('distance (haversine)', () => {
	it('returns ~0 for same point', () => {
		const d = distance([13.4, 52.52], [13.4, 52.52]);
		expect(d).toBe(0);
	});

	it('computes ~111km for 1 degree latitude', () => {
		const d = distance([0, 0], [0, 1]);
		expect(d).toBeCloseTo(111195, -3);
	});
});

describe('pathRepetition', () => {
	it('detects out-and-back repetition', () => {
		const outAndBack: [number, number][] = [
			[13.4, 52.52],
			[13.41, 52.52],
			[13.4, 52.52],
		];
		const result = pathRepetition(outAndBack);
		expect(result.repeatRatio).toBeGreaterThan(0.49);
		expect(result.longestRepeatDistance).toBeGreaterThan(600);
	});
});

describe('repeatedPathRatio', () => {
	it('returns >0.49 for out-and-back', () => {
		const outAndBack: [number, number][] = [
			[13.4, 52.52],
			[13.41, 52.52],
			[13.4, 52.52],
		];
		expect(repeatedPathRatio(outAndBack)).toBeGreaterThan(0.49);
	});
});

describe('routeIsAcceptable', () => {
	it('rejects route with high repeat ratio', () => {
		const route = {
			candidate: { algorithm: 'organic' as const, bearing: 0, scale: 1, points: [] },
			distanceError: 0.026,
			repeatRatio: 0.186,
			longestRepeatDistance: 1919,
		};
		expect(routeIsAcceptable(route)).toBe(false);
	});

	it('accepts route within limits', () => {
		const route = {
			candidate: { algorithm: 'organic' as const, bearing: 0, scale: 1, points: [] },
			distanceError: 0.1,
			repeatRatio: 0.02,
			longestRepeatDistance: 100,
		};
		expect(routeIsAcceptable(route)).toBe(true);
	});

	it('accepts spaghetti-cross with longer repeated run', () => {
		const route = {
			candidate: { algorithm: 'spaghetti-cross' as const, bearing: 0, scale: 1, points: [] },
			distanceError: 0.1,
			repeatRatio: 0.03,
			longestRepeatDistance: 250,
		};
		expect(routeIsAcceptable(route)).toBe(true);
	});
});

describe('needsMoreCandidates', () => {
	it('returns true for orbit-same with long stem', () => {
		const route = {
			candidate: { algorithm: 'orbit-same' as const, bearing: 0, scale: 1, points: [] },
			distanceError: 0.087,
			repeatRatio: 0.154,
			longestRepeatDistance: 951,
		};
		expect(needsMoreCandidates(route, 'orbit-same')).toBe(true);
	});
});

describe('compareRoutes', () => {
	it('prefers route with lower penalty among acceptable routes', () => {
		const better = {
			distanceError: 0.1,
			distanceErrorDistance: 100,
			repeatRatio: 0.04,
			repeatedDistance: 500,
			longestRepeatDistance: 100,
			score: 1,
		};
		const worse = {
			distanceError: 0.1,
			distanceErrorDistance: 100,
			repeatRatio: 0.04,
			repeatedDistance: 500,
			longestRepeatDistance: 300,
			score: 1,
		};
		expect(compareRoutes(better, worse)).toBeLessThan(0);
	});

	it('prefers acceptable over unacceptable', () => {
		const acceptable = {
			distanceError: 0.1,
			distanceErrorDistance: 100,
			repeatRatio: 0.04,
			repeatedDistance: 500,
			longestRepeatDistance: 100,
			score: 0.5,
		};
		const unacceptable = {
			distanceError: 0.1,
			distanceErrorDistance: 100,
			repeatRatio: 0.1,
			repeatedDistance: 1200,
			longestRepeatDistance: 900,
			score: 1,
		};
		expect(compareRoutes(acceptable, unacceptable)).toBeLessThan(0);
	});
});
