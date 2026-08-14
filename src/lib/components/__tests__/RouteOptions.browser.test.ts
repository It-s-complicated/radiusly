import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import RouteOptions from '../RouteOptions.svelte';
import { mode, distanceTarget, timeTarget, pace, algorithm } from '$lib/stores/preferences';
import { currentRoute } from '$lib/stores/route';
import { resetStores } from '$lib/stores/points';
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
		currentRoute.set(null);
	});

	it('renders the planner controls', async () => {
		const screen = await render(RouteOptions);

		await expect
			.element(screen.getByRole('heading', { name: 'A good walk starts right here.' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: /Add current/ })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Pin on map/ }).elements()).toHaveLength(2);
		await expect.element(screen.getByRole('button', { name: /Make my route/ })).toBeInTheDocument();
		expect(document.querySelectorAll('input[name="route-algorithm"]')).toHaveLength(5);
		expect(document.querySelectorAll('input[name="pace"]')).toHaveLength(3);
	});

	it('switches between distance and time modes', async () => {
		const screen = await render(RouteOptions);
		await expect.element(screen.getByText('How far?')).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Time' }).click();
		await expect.element(screen.getByText('How long?')).toBeInTheDocument();
		await expect.element(screen.getByText('min', { exact: true })).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Distance' }).click();
		await expect.element(screen.getByText('How far?')).toBeInTheDocument();
		await expect.element(screen.getByText('km', { exact: true })).toBeInTheDocument();
	});

	it('clears the displayed route when the route shape changes', async () => {
		const screen = await render(RouteOptions);
		currentRoute.set(sampleRoute());

		await screen.getByRole('radio', { name: /Tangent/ }).click();

		expect(get(currentRoute)).toBeNull();
	});

	it('updates the target from the number input', async () => {
		const screen = await render(RouteOptions);

		await screen.getByRole('spinbutton', { name: 'How far?' }).fill('6');

		expect(get(distanceTarget)).toBe(6);
	});
});
