import { writable } from 'svelte/store';
import type { RouteResult, RouteDebug } from '$lib/route/contracts';

export const currentRoute = writable<RouteResult | null>(null);
export const routeDebug = writable<RouteDebug | null>(null);
export const isLoading = writable<boolean>(false);
export const toast = writable<string | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Show a toast notification that auto-dismisses after 4.2 seconds.
 */
export function showToast(message: string) {
	clearTimeout(toastTimer);
	toast.set(message);
	toastTimer = setTimeout(() => toast.set(null), 4200);
}
