import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { SavedPoint } from '$lib/types';

const STARTS_KEY = 'radiusly:starts';
const SELECTED_START_KEY = 'radiusly:selected-start';
const FAVORITES_KEY = 'radiusly:favorites';

function storedList<T>(key: string, fallback: T[] = []): T[] {
	if (!browser) return fallback;
	try {
		const value = JSON.parse(localStorage.getItem(key) || '[]');
		return Array.isArray(value) ? value : fallback;
	} catch {
		return fallback;
	}
}

export const starts = writable<SavedPoint[]>(storedList(STARTS_KEY));
export const selectedStartId = writable<string | undefined>(
	browser ? (localStorage.getItem(SELECTED_START_KEY) ?? undefined) : undefined,
);
export const favorites = writable<SavedPoint[]>(storedList(FAVORITES_KEY));

starts.subscribe((value) => {
	if (browser) localStorage.setItem(STARTS_KEY, JSON.stringify(value));
});
selectedStartId.subscribe((value) => {
	if (browser) {
		if (value) localStorage.setItem(SELECTED_START_KEY, value);
		else localStorage.removeItem(SELECTED_START_KEY);
	}
});
favorites.subscribe((value) => {
	if (browser) localStorage.setItem(FAVORITES_KEY, JSON.stringify(value));
});

export function resetStores() {
	starts.set([]);
	selectedStartId.set(undefined);
	favorites.set([]);
}
