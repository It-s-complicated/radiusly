import { writable, derived } from 'svelte/store';
import { browser } from '$app/env';
import type { Mode, Pace, Algorithm, SearchAlgorithm } from '#lib/types.js';

const PREFERENCES_KEY = 'radiusly:preferences';

interface Preferences {
	mode: Mode;
	distance: number;
	time: number;
	pace: Pace;
	algorithm: Algorithm;
	search: SearchAlgorithm;
}

const ROUTE_ALGORITHMS: string[] = ['organic', 'tangent', 'orbit-same', 'orbit-near', 'spaghetti'];

const ALLOWED_PACES = [4, 5, 6];

function storedPreferences(): Preferences {
	if (!browser) return defaultPrefs();
	try {
		const raw = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaultPrefs();

		let algo = String(raw.algorithm || '');
		if (algo === 'chaos') algo = 'spaghetti';
		if (!ROUTE_ALGORITHMS.includes(algo)) algo = 'organic';

		const rawPace = Number(raw.pace);
		const validPace: Pace = ALLOWED_PACES.includes(rawPace) ? (rawPace as Pace) : 5;

		return {
			mode: raw.mode === 'time' ? 'time' : 'distance',
			distance: preferenceValue(raw.distance, 1, 20, 4),
			time: preferenceValue(raw.time, 10, 180, 45),
			pace: validPace,
			algorithm: algo as Algorithm,
			search: raw.search === 'dijkstra' ? 'dijkstra' : 'astar',
		};
	} catch {
		return defaultPrefs();
	}
}

function defaultPrefs(): Preferences {
	return {
		mode: 'distance',
		distance: 4,
		time: 45,
		pace: 5,
		algorithm: 'organic',
		search: 'astar',
	};
}

function preferenceValue(value: unknown, min: number, max: number, fallback: number): number {
	const number = Number(value);
	return number >= min && number <= max ? number : fallback;
}

function save(prefs: Preferences) {
	if (browser) localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}

export const preferences = writable<Preferences>(storedPreferences());

export const targetKm = derived(preferences, ({ mode, distance, time, pace }) =>
	mode === 'time' ? (time * pace) / 60 : distance,
);

preferences.subscribe(save);
