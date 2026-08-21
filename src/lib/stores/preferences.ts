import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { Mode, Pace, Algorithm } from '$lib/types';

const PREFERENCES_KEY = 'radiusly:preferences';

interface Preferences {
	mode: Mode;
	distance: number;
	time: number;
	pace: Pace;
	algorithm: Algorithm;
}

const ROUTE_ALGORITHMS: string[] = ['organic', 'tangent', 'orbit-same', 'orbit-near', 'spaghetti'];

const ALLOWED_PACES = [4, 5, 6];

function storedPreferences(): Preferences {
	if (!browser) {
		return { mode: 'distance', distance: 4, time: 45, pace: 5, algorithm: 'organic' };
	}
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
		};
	} catch {
		return defaultPrefs();
	}
}

function defaultPrefs(): Preferences {
	return { mode: 'distance', distance: 4, time: 45, pace: 5, algorithm: 'organic' };
}

function preferenceValue(value: unknown, min: number, max: number, fallback: number): number {
	const number = Number(value);
	return number >= min && number <= max ? number : fallback;
}

function save(prefs: Preferences) {
	if (browser) localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}

const initial = storedPreferences();

export const mode = writable<Mode>(initial.mode);
export const distanceTarget = writable<number>(initial.distance);
export const timeTarget = writable<number>(initial.time);
export const pace = writable<Pace>(initial.pace);
export const algorithm = writable<Algorithm>(initial.algorithm);

export const targetKm = derived(
	[mode, distanceTarget, timeTarget, pace],
	([$mode, $distance, $time, $pace]) => {
		return $mode === 'time' ? ($time * $pace) / 60 : $distance;
	},
);

function currentPrefs(): Preferences {
	return {
		mode: get(mode),
		distance: get(distanceTarget),
		time: get(timeTarget),
		pace: get(pace),
		algorithm: get(algorithm),
	};
}

mode.subscribe(() => save(currentPrefs()));
distanceTarget.subscribe(() => save(currentPrefs()));
timeTarget.subscribe(() => save(currentPrefs()));
pace.subscribe(() => save(currentPrefs()));
algorithm.subscribe(() => save(currentPrefs()));
