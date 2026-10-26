import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import RouteOptions from '../RouteOptions.svelte';
import Planner from '../../../routes/+page.svelte';
import { preferences } from '#lib/stores/preferences.js';
import { currentRoute, routeDebug, clearRoute, isLoading, toast } from '#lib/stores/route.js';
import { resetStores, starts, selectedStartId, favorites } from '#lib/stores/points.js';
import type { RouteResult, RouteDebug } from '#lib/types.js';

function sampleRoute(): RouteResult {
	return {
		distance: 4000,
		duration: 3000,
		geometry: { coordinates: [] },
		weight: 1,
		distanceError: 0,
		distanceErrorDistance: 0,
		repeatRatio: 0,
		repeatedDistance: 0,
		longestRepeatRatio: 0,
		longestRepeatDistance: 0,
		stationRepeatDistance: 0,
		score: 0,
	};
}

function sampleDebug(): RouteDebug {
	return { schemaVersion: 14, generatedAt: new Date().toISOString(), input: {} };
}

describe('RouteOptions component', () => {
	beforeEach(() => {
		resetStores();
		preferences.set({
			mode: 'distance',
			distance: 4,
			time: 45,
			pace: 5,
			algorithm: 'organic',
			search: 'astar',
		});
		clearRoute();
		isLoading.set(false);
		toast.set(null);
	});
	afterEach(() => vi.restoreAllMocks());

	it('keeps snapped required spots out of generated waypoint markers', async () => {
		favorites.set([{ id: 'park', name: 'Park', lat: 52.5232, lng: 13.4005, selected: true }]);
		const route = sampleRoute();
		route.geometry.coordinates = [
			[13.4095, 52.5208],
			[13.4005, 52.523],
			[13.4095, 52.5208],
		];
		route.candidate = {
			algorithm: 'organic',
			bearing: 25,
			scale: 1,
			waypoints: [
				{ role: 'start', point: [52.5208, 13.4095] },
				{ role: 'required-spot', spotIndex: 0, point: [52.523, 13.4005] },
				{ role: 'generated-anchor', point: [52.524, 13.405] },
				{ role: 'generated-anchor', point: [52.525, 13.41] },
				{ role: 'generated-anchor', point: [52.521, 13.415] },
				{ role: 'start', point: [52.5208, 13.4095] },
			],
		};
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			Response.json({ route, debug: { schemaVersion: 14 } }),
		);
		const screen = await render(Planner);
		await expect.poll(() => document.querySelectorAll('.synthetic-waypoint').length).toBe(3);
		await screen.getByRole('button', { name: 'Make my route' }).click();
		await expect.element(screen.getByText('Your loop', { exact: true })).toBeVisible();
		await expect.poll(() => document.querySelectorAll('.synthetic-waypoint').length).toBe(3);
	});

	it('renders the planner controls', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });

		await expect
			.element(screen.getByRole('heading', { name: 'A good walk starts right here.' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: /Add current/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Pin on map/ }).elements()).toHaveLength(2);
		await expect.element(screen.getByRole('button', { name: /Make my route/ })).toBeInTheDocument();
		expect(document.querySelectorAll('input[name="route-algorithm"]')).toHaveLength(5);
		expect(document.querySelectorAll('input[name="pace"]')).toHaveLength(3);
	});

	it('updates start selection and route geometry directly, without clearing routes on rename', async () => {
		const home = { id: 'home', name: 'Home', lat: 52.52, lng: 13.4 };
		const park = { id: 'park', name: 'Park', lat: 52.53, lng: 13.41 };
		starts.set([home, park]);
		selectedStartId.set(home.id);
		const screen = await render(Planner);
		const preview = document.querySelector.bind(
			document,
			'.leaflet-overlay-pane path[stroke="#476f64"]',
		);
		await expect.poll(() => preview()).not.toBeNull();
		const initialPreview = preview()!.getAttribute('d');
		await screen.getByRole('spinbutton', { name: 'How far?' }).fill('6');
		await expect.poll(() => preview()!.getAttribute('d')).not.toBe(initialPreview);

		const route = sampleRoute();
		route.geometry.coordinates = [
			[13.4, 52.52],
			[13.41, 52.53],
			[13.4, 52.52],
		];
		currentRoute.set(route);
		const debug = sampleDebug();
		routeDebug.set(debug);
		await expect.poll(() => document.querySelector('.route-pulse')).not.toBeNull();
		await expect.poll(() => preview()).toBeNull();
		await screen.getByRole('button', { name: 'Rename Home' }).click();
		await expect
			.element(screen.getByRole('textbox', { name: 'Rename this place' }))
			.toHaveValue('Home');
		await screen.getByRole('textbox', { name: 'Rename this place' }).fill('My home');
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		expect(get(currentRoute)).toEqual(route);
		expect(get(routeDebug)).toEqual(debug);

		await screen.getByRole('radio', { name: 'Park', exact: true }).click();
		expect(get(selectedStartId)).toBe(park.id);
		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();
		await expect.poll(() => document.querySelector('.route-pulse')).toBeNull();
		await expect.poll(() => preview()).not.toBeNull();

		currentRoute.set(route);
		routeDebug.set(debug);
		await screen.getByRole('button', { name: 'Clear route' }).click();
		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();
		await expect.poll(() => document.querySelector('.route-pulse')).toBeNull();
		await expect.poll(() => preview()).not.toBeNull();
	});

	it('opens, cancels, reopens and saves the point dialog from parent actions', async () => {
		const screen = await render(Planner);
		await expect.poll(() => document.querySelector('.leaflet-pane')).not.toBeNull();
		const pinStart = screen.getByRole('button', { name: /Pin on map/ }).nth(0);
		await pinStart.click();
		await screen.getByRole('button', { name: 'Use center' }).click();
		await expect
			.element(screen.getByRole('dialog', { name: 'Name this starting point' }))
			.toBeVisible();
		await screen.getByRole('textbox', { name: 'Name this starting point' }).fill('Discard me');
		await screen.getByRole('button', { name: 'Close', exact: true }).click();
		await expect.poll(() => document.querySelector('dialog[open]')).toBeNull();
		expect(get(starts)).toHaveLength(0);

		await pinStart.click();
		await screen.getByRole('button', { name: 'Use center' }).click();
		await expect
			.element(screen.getByRole('textbox', { name: 'Name this starting point' }))
			.toHaveValue('');
		await screen.getByRole('textbox', { name: 'Name this starting point' }).fill('Home');
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		await expect.poll(() => document.querySelector('dialog[open]')).toBeNull();
		expect(get(starts)).toHaveLength(1);
		expect(get(starts)[0]?.name).toBe('Home');
		expect(get(selectedStartId)).toBe(get(starts)[0]?.id);
	});

	it('switches between distance and time modes', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });
		await expect.element(screen.getByText('How far?')).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Time' }).click();
		await expect.element(screen.getByText('How long?')).toBeInTheDocument();
		await expect.element(screen.getByText('min', { exact: true })).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Distance' }).click();
		await expect.element(screen.getByText('How far?')).toBeInTheDocument();
		await expect.element(screen.getByText('km', { exact: true })).toBeInTheDocument();
	});

	it('clears the displayed route and debugging information when the route shape changes', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });
		currentRoute.set(sampleRoute());
		routeDebug.set(sampleDebug());

		await screen.getByRole('radio', { name: /Tangent/ }).click();

		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();
		await expect
			.element(screen.getByRole('button', { name: 'Clear route' }))
			.not.toBeInTheDocument();
	});

	it('selects Dijkstra independently of the route shape and remembers it', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });
		currentRoute.set(sampleRoute());
		routeDebug.set(sampleDebug());
		await screen.getByRole('radio', { name: /Dijkstra/ }).click();
		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();
		expect(get(preferences).search).toBe('dijkstra');
		expect(get(preferences).algorithm).toBe('organic');
		expect(JSON.parse(localStorage.getItem('radiusly:preferences')!).search).toBe('dijkstra');
		currentRoute.set(sampleRoute());
		routeDebug.set(sampleDebug());
		await screen.getByRole('radio', { name: /A\*/ }).click();
		expect(get(preferences).search).toBe('astar');
		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();
	});

	it('preserves the route and debugging information when other planning inputs change', async () => {
		favorites.set([{ id: 'park', name: 'Park', lat: 52.53, lng: 13.41, selected: true }]);
		const route = sampleRoute();
		const debug = sampleDebug();
		currentRoute.set(route);
		routeDebug.set(debug);
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });

		await screen.getByRole('spinbutton', { name: 'How far?' }).fill('6');
		await screen.getByRole('button', { name: 'Time', exact: true }).click();
		await screen.getByRole('radio', { name: /Easy/ }).click();
		await screen.getByRole('checkbox', { name: /Park/ }).click();

		expect(get(currentRoute)).toEqual(route);
		expect(get(routeDebug)).toEqual(debug);
	});

	it.each(['success', 'failure'])(
		'clears the previous route and debug while generating, then keeps %s details',
		async (outcome) => {
			const response = Promise.withResolvers<Response>();
			vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(response.promise);
			currentRoute.set(sampleRoute());
			routeDebug.set(sampleDebug());
			const screen = await render(Planner);

			await screen.getByRole('button', { name: 'Make another route' }).click();
			await expect
				.element(screen.getByRole('button', { name: 'Comparing route options…' }))
				.toBeDisabled();
			expect(get(currentRoute)).toBeNull();
			expect(get(routeDebug)).toBeNull();
			expect(get(isLoading)).toBe(true);

			if (outcome === 'success') {
				const route = sampleRoute();
				const debug = sampleDebug();
				response.resolve(Response.json({ route, debug }));
				await expect.element(screen.getByText('Your loop', { exact: true })).toBeVisible();
				expect(get(currentRoute)).toEqual(route);
				expect(get(routeDebug)).toEqual(debug);
			} else {
				const message = 'Local walking data is unavailable. Build the regional graph.';
				const details = [{ reason: 'No connected path' }];
				response.resolve(Response.json({ message, details }, { status: 503 }));
				await expect.element(screen.getByRole('status')).toHaveTextContent(message);
				expect(get(currentRoute)).toBeNull();
				expect(get(routeDebug)).toMatchObject({
					error: message,
					candidates: details,
					input: { start: [52.5208, 13.4095], search: 'astar', shape: 'organic' },
				});
			}
			expect(get(isLoading)).toBe(false);
			await expect
				.element(screen.getByRole('button', { name: /Make (my|another) route/ }))
				.toBeEnabled();
		},
	);

	it('uses location without saving a start, keeping the route until the lookup succeeds', async () => {
		const lookup = vi
			.spyOn(navigator.geolocation, 'getCurrentPosition')
			.mockImplementation(() => {});
		const home = { id: 'home', name: 'Home', lat: 52.52, lng: 13.4 };
		starts.set([home]);
		selectedStartId.set(home.id);
		const route = sampleRoute();
		const debug = sampleDebug();
		currentRoute.set(route);
		routeDebug.set(debug);
		const screen = await render(Planner);

		await screen.getByRole('button', { name: 'Use my location' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Locating…', exact: true }))
			.toBeDisabled();
		await expect.element(screen.getByRole('button', { name: /Add current/ })).toBeEnabled();
		expect(get(currentRoute)).toEqual(route);
		expect(get(routeDebug)).toEqual(debug);
		expect(lookup.mock.lastCall?.[2]).toEqual({ enableHighAccuracy: true, timeout: 10000 });

		lookup.mock.lastCall![0]({
			coords: { latitude: 52.53, longitude: 13.41 },
		} as GeolocationPosition);
		await expect.element(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent('Starting point updated to your location.');
		expect(get(starts)).toEqual([home]);
		expect(get(selectedStartId)).toBeUndefined();
		await expect
			.element(screen.getByRole('radio', { name: 'Home', exact: true }))
			.not.toBeChecked();
		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();

		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json({ route, debug }));
		await screen.getByRole('button', { name: 'Make my route' }).click();
		await expect.element(screen.getByText('Your loop', { exact: true })).toBeVisible();
		expect(JSON.parse(fetch.mock.lastCall![1]!.body as string).start).toEqual([52.53, 13.41]);
	});

	it('adds the current location only after naming it and leaves the existing route until then', async () => {
		const lookup = vi
			.spyOn(navigator.geolocation, 'getCurrentPosition')
			.mockImplementation(() => {});
		const home = { id: 'home', name: 'Home', lat: 52.52, lng: 13.4 };
		starts.set([home]);
		selectedStartId.set(home.id);
		const route = sampleRoute();
		const debug = sampleDebug();
		currentRoute.set(route);
		routeDebug.set(debug);
		const screen = await render(Planner);

		await screen.getByRole('button', { name: /Add current/ }).click();
		await expect.element(screen.getByRole('button', { name: /◎ Locating…/ })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
		expect(lookup.mock.lastCall?.[2]).toEqual({ enableHighAccuracy: true, timeout: 10000 });
		lookup.mock.lastCall![0]({
			coords: { latitude: 52.53, longitude: 13.41 },
		} as GeolocationPosition);
		await expect
			.element(screen.getByRole('dialog', { name: 'Name this starting point' }))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: /Add current/ })).toBeEnabled();
		expect(get(starts)).toEqual([home]);
		expect(get(selectedStartId)).toBe(home.id);
		expect(get(currentRoute)).toEqual(route);
		expect(get(routeDebug)).toEqual(debug);

		await screen.getByRole('textbox', { name: 'Name this starting point' }).fill('Current start');
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		const saved = get(starts).find((point) => point.name === 'Current start');
		expect(saved).toMatchObject({ lat: 52.53, lng: 13.41 });
		expect(get(selectedStartId)).toBe(saved?.id);
		expect(get(currentRoute)).toBeNull();
		expect(get(routeDebug)).toBeNull();
	});

	describe.each(['Use my location', '◎ Add current'])('%s', (action) => {
		it.each([
			[1, 'Location permission was denied.'],
			[2, 'Your position is currently unavailable.'],
			[3, 'Finding your position timed out.'],
			[0, 'Geolocation is not available in this browser.'],
		] as const)(
			'restores the control and keeps the route after location error %i',
			async (code, message) => {
				const lookup = vi
					.spyOn(navigator.geolocation, 'getCurrentPosition')
					.mockImplementation(() => {});
				const home = { id: 'home', name: 'Home', lat: 52.52, lng: 13.4 };
				starts.set([home]);
				selectedStartId.set(home.id);
				const route = sampleRoute();
				const debug = sampleDebug();
				currentRoute.set(route);
				routeDebug.set(debug);
				const screen = await render(Planner);

				await screen.getByRole('button', { name: action, exact: true }).click();
				await expect.element(screen.getByRole('button', { name: /Locating…/ })).toBeDisabled();
				lookup.mock.lastCall![1]?.({ code } as GeolocationPositionError);
				await expect.element(screen.getByRole('status')).toHaveTextContent(message);
				await expect
					.element(screen.getByRole('button', { name: action, exact: true }))
					.toBeEnabled();
				expect(get(currentRoute)).toEqual(route);
				expect(get(routeDebug)).toEqual(debug);
				expect(get(selectedStartId)).toBe(home.id);
				expect(get(starts)).toEqual([home]);
				expect(document.querySelector('dialog[open]')).toBeNull();

				await screen.getByRole('button', { name: action, exact: true }).click();
				await expect.element(screen.getByRole('button', { name: /Locating…/ })).toBeDisabled();
				expect(lookup).toHaveBeenCalledTimes(2);
				lookup.mock.lastCall![1]?.({ code: 3 } as GeolocationPositionError);
				await expect
					.element(screen.getByRole('button', { name: action, exact: true }))
					.toBeEnabled();
			},
		);

		it.each(['unsupported', 'insecure'])(
			'shows the existing error when location is %s',
			async (availability) => {
				if (availability === 'unsupported')
					vi.spyOn(navigator, 'geolocation', 'get').mockReturnValue(undefined!);
				else vi.spyOn(window, 'isSecureContext', 'get').mockReturnValue(false);
				const screen = await render(Planner);
				await screen.getByRole('button', { name: action, exact: true }).click();
				await expect
					.element(screen.getByRole('status'))
					.toHaveTextContent(
						availability === 'unsupported'
							? 'Geolocation is not available in this browser.'
							: 'Location needs HTTPS (or localhost) to work.',
					);
				await expect
					.element(screen.getByRole('button', { name: action, exact: true }))
					.toBeEnabled();
			},
		);
	});

	it('updates the target from the number input', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });

		await screen.getByRole('spinbutton', { name: 'How far?' }).fill('6');

		expect(get(preferences).distance).toBe(6);
	});
});
