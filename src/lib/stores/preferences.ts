import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { Mode, Pace } from '$lib/types';

const PREFERENCES_KEY = 'radiusly:preferences';
const ALLOWED_PACES = [4, 5, 6];

interface Preferences {
	mode: Mode;
	distance: number;
	time: number;
	pace: Pace;
}

function storedPreferences(): Preferences {
	if (!browser) return defaultPreferences();
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}');
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaultPreferences();
		const values = raw as Record<string, unknown>;
		const rawPace = Number(values.pace);
		return {
			mode: values.mode === 'time' ? 'time' : 'distance',
			distance: preferenceValue(values.distance, 1, 20, 4),
			time: preferenceValue(values.time, 10, 180, 45),
			pace: ALLOWED_PACES.includes(rawPace) ? rawPace as Pace : 5,
		};
	} catch {
		return defaultPreferences();
	}
}

function defaultPreferences(): Preferences {
	return { mode: 'distance', distance: 4, time: 45, pace: 5 };
}

function preferenceValue(value: unknown, min: number, max: number, fallback: number): number {
	const number = Number(value);
	return number >= min && number <= max ? number : fallback;
}

function save(preferences: Preferences): void {
	if (browser) localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

const initial = storedPreferences();

export const mode = writable<Mode>(initial.mode);
export const distanceTarget = writable<number>(initial.distance);
export const timeTarget = writable<number>(initial.time);
export const pace = writable<Pace>(initial.pace);

export const targetKm = derived(
	[mode, distanceTarget, timeTarget, pace],
	([$mode, $distance, $time, $pace]) => $mode === 'time' ? $time * $pace / 60 : $distance,
);

function currentPreferences(): Preferences {
	return {
		mode: get(mode),
		distance: get(distanceTarget),
		time: get(timeTarget),
		pace: get(pace),
	};
}

mode.subscribe(() => save(currentPreferences()));
distanceTarget.subscribe(() => save(currentPreferences()));
timeTarget.subscribe(() => save(currentPreferences()));
pace.subscribe(() => save(currentPreferences()));
