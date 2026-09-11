import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import RouteOptions from '../RouteOptions.svelte';
import Planner from '../../../routes/+page.svelte';
import {
	mode,
	distanceTarget,
	timeTarget,
	pace,
	algorithm,
	searchAlgorithm,
} from '$lib/stores/preferences';
import { currentRoute } from '$lib/stores/route';
import { resetStores, starts, selectedStartId } from '$lib/stores/points';
import type { RouteResult } from '$lib/types';

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

describe('RouteOptions component', () => {
	beforeEach(() => {
		resetStores();
		mode.set('distance');
		distanceTarget.set(4);
		timeTarget.set(45);
		pace.set(5);
		algorithm.set('organic');
		searchAlgorithm.set('astar');
		currentRoute.set(null);
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
		await expect.poll(() => document.querySelector('.route-pulse')).not.toBeNull();
		await expect.poll(() => preview()).toBeNull();
		await screen.getByRole('button', { name: 'Rename Home' }).click();
		await expect
			.element(screen.getByRole('textbox', { name: 'Rename this place' }))
			.toHaveValue('Home');
		await screen.getByRole('textbox', { name: 'Rename this place' }).fill('My home');
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		expect(get(currentRoute)).toEqual(route);

		await screen.getByRole('radio', { name: 'Park', exact: true }).click();
		expect(get(selectedStartId)).toBe(park.id);
		expect(get(currentRoute)).toBeNull();
		await expect.poll(() => document.querySelector('.route-pulse')).toBeNull();
		await expect.poll(() => preview()).not.toBeNull();

		currentRoute.set(route);
		await screen.getByRole('button', { name: 'Clear route' }).click();
		await expect.poll(() => document.querySelector('.route-pulse')).toBeNull();
		await expect.poll(() => preview()).not.toBeNull();
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

	it('clears the displayed route when the route shape changes', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });
		currentRoute.set(sampleRoute());

		await screen.getByRole('radio', { name: /Tangent/ }).click();

		expect(get(currentRoute)).toBeNull();
	});

	it('selects Dijkstra independently of the route shape and remembers it', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });
		await screen.getByRole('radio', { name: /Dijkstra/ }).click();
		expect(get(searchAlgorithm)).toBe('dijkstra');
		expect(get(algorithm)).toBe('organic');
		expect(JSON.parse(localStorage.getItem('radiusly:preferences')!).search).toBe('dijkstra');
		await screen.getByRole('radio', { name: /A\*/ }).click();
		expect(get(searchAlgorithm)).toBe('astar');
	});

	it('updates the target from the number input', async () => {
		const screen = await render(RouteOptions, { onSelectStart: vi.fn() });

		await screen.getByRole('spinbutton', { name: 'How far?' }).fill('6');

		expect(get(distanceTarget)).toBe(6);
	});
});
