import { describe, it, expect } from 'vitest';
import { distance } from './scoring';

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
