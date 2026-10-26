import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/env', () => ({ browser: true }));

const defaults = {
	mode: 'distance',
	distance: 4,
	time: 45,
	pace: 5,
	algorithm: 'organic',
	search: 'astar',
};

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal('localStorage', {
		getItem: vi.fn().mockReturnValue(null),
		setItem: vi.fn(),
	});
});

afterEach(() => vi.unstubAllGlobals());

describe('preferences persistence', () => {
	it('loads the existing storage key and migrates chaos without losing other preferences', async () => {
		const stored = {
			mode: 'time',
			distance: 8,
			time: 60,
			pace: 4,
			algorithm: 'chaos',
			search: 'dijkstra',
		};
		vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(stored));

		const { preferences, targetKm } = await import('./preferences.js');

		const migrated = { ...stored, algorithm: 'spaghetti' };
		expect(localStorage.getItem).toHaveBeenCalledExactlyOnceWith('radiusly:preferences');
		expect(get(preferences)).toEqual(migrated);
		expect(get(targetKm)).toBe(4);
		expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith(
			'radiusly:preferences',
			JSON.stringify(migrated),
		);
	});

	it.each([
		'{',
		'null',
		'[]',
		JSON.stringify({
			mode: 'invalid',
			distance: 21,
			time: 9,
			pace: 7,
			algorithm: 'invalid',
			search: 'invalid',
		}),
	])('preserves defaults and validation for invalid stored preferences: %s', async (raw) => {
		vi.mocked(localStorage.getItem).mockReturnValue(raw);

		const { preferences } = await import('./preferences.js');

		expect(get(preferences)).toEqual(defaults);
	});

	it('persists an update once as a complete object and updates the derived distance', async () => {
		const { preferences, targetKm } = await import('./preferences.js');
		const distances = vi.fn();
		const unsubscribe = targetKm.subscribe(distances);
		vi.mocked(localStorage.setItem).mockClear();

		preferences.update((prefs) => ({ ...prefs, mode: 'time', pace: 4 }));
		unsubscribe();

		expect(distances.mock.calls).toEqual([[4], [3]]);
		expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith(
			'radiusly:preferences',
			JSON.stringify({ ...defaults, mode: 'time', pace: 4 }),
		);
	});
});
