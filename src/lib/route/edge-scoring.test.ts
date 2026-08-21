import { describe, expect, it } from 'vitest';
import { rejectionReasons, scoreRoute } from './edge-scoring';
import type { LngLat } from '$lib/types';
import type { RoutedEdge } from './contracts';

const geometry: LngLat[] = [
	[13.4, 52.5],
	[13.401, 52.5],
	[13.402, 52.5],
	[13.401, 52.5],
	[13.4, 52.5],
];

function edge(id: string, direction: 1 | -1, lengthMeters = 100): RoutedEdge {
	return {
		id,
		lengthMeters,
		direction,
		tunnel: false,
		pedestrianAllowed: true,
	};
}

describe('edge-based route scoring', () => {
	it('measures repeated edges and a continuous immediate reversal', () => {
		const scores = scoreRoute(
			{ distance: 400, geometry: { coordinates: geometry } },
			[edge('a', 1), edge('b', 1), edge('b', -1), edge('a', -1)],
			400,
			[],
		);

		expect(scores.repeatedDistanceMeters).toBe(200);
		expect(scores.repeatRatio).toBe(0.5);
		expect(scores.longestRepeatedRunMeters).toBe(200);
		expect(scores.immediateReversalMeters).toBe(200);
		expect(rejectionReasons(scores, { backtracking: 'avoid' })).toEqual(
			expect.arrayContaining([
				'TOTAL_REPEATED_DISTANCE',
				'LONGEST_REPEATED_RUN',
				'IMMEDIATE_REVERSAL',
			]),
		);
	});

	it('distinguishes same-direction repetition from immediate reversal', () => {
		const scores = scoreRoute(
			{ distance: 300, geometry: { coordinates: geometry } },
			[edge('a', 1), edge('b', 1), edge('a', 1)],
			300,
			[],
		);

		expect(scores.repeatedDistanceMeters).toBe(100);
		expect(scores.immediateReversalMeters).toBe(0);
	});

	it('hard-rejects a required spot missing from routed geometry', () => {
		const scores = scoreRoute(
			{ distance: 300, geometry: { coordinates: geometry } },
			[edge('a', 1, 300)],
			300,
			[{ name: 'Park', coordinates: [52.6, 13.5] }],
		);

		expect(scores.requiredSpotsMissed).toBe(1);
		expect(rejectionReasons(scores, { backtracking: 'avoid' })).toContain('REQUIRED_SPOT_MISSED');
	});

	it('records soft exposure without applying an unvalidated penalty', () => {
		const exposed = edge('a', 1, 300);
		exposed.roadClass = 'primary';
		exposed.surface = 'gravel';
		exposed.tunnel = true;
		const scores = scoreRoute(
			{ distance: 300, geometry: { coordinates: geometry } },
			[exposed],
			300,
			[],
		);

		expect(scores.softExposures).toEqual({
			majorRoadMeters: 300,
			stepsMeters: 0,
			tunnelMeters: 300,
			roughSurfaceMeters: 300,
		});
		expect(scores.total).toBe(0);
		expect(rejectionReasons(scores, { backtracking: 'avoid' })).toEqual([]);
	});

	it('rejects unsuitable pedestrian access', () => {
		const inaccessible = edge('a', 1, 300);
		inaccessible.pedestrianAllowed = false;
		const scores = scoreRoute(
			{ distance: 300, geometry: { coordinates: geometry } },
			[inaccessible],
			300,
			[],
		);

		expect(rejectionReasons(scores, { backtracking: 'avoid' })).toContain(
			'UNSUITABLE_PEDESTRIAN_ACCESS',
		);
	});
});
