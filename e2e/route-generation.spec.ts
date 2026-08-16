import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const LOOP_COORDS: [number, number][] = [
	[13.4095, 52.5208],
	[13.42, 52.5208],
	[13.42, 52.53],
	[13.4095, 52.53],
	[13.4095, 52.5208],
];

async function mockRouteGeneration(page: Page) {
	await page.route('**/api/routing', async (interception) => {
		const input = interception.request().postDataJSON();
		await interception.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				route: {
					distance: 4000,
					duration: 2880,
					geometry: { type: 'LineString', coordinates: LOOP_COORDS },
					candidate: {
						id: 'candidate-1',
						anchorCount: 2,
						contourDistanceKm: 1.2,
						traversal: 'clockwise',
						adjustment: 0,
						anchors: [],
					},
					scores: {
						distanceErrorRatio: 0,
						distanceErrorMeters: 0,
						repeatedDistanceMeters: 0,
						repeatRatio: 0,
						longestRepeatedRunMeters: 0,
						immediateReversalMeters: 0,
						unsuitableAccessMeters: 0,
						requiredSpotsMissed: 0,
						softExposures: {
							majorRoadMeters: 0,
							stepsMeters: 0,
							tunnelMeters: 0,
							roughSurfaceMeters: 0,
						},
						total: 0,
					},
				},
				debug: {
					schemaVersion: 13,
					generatedAt: '2026-08-16T00:00:00.000Z',
					seed: input.seed,
					generatorVersion: 'network-contours-1',
					graphDataVersion: 'test-graph',
					input: { ...input, targetKm: 4 },
					candidates: [],
					selectedCandidateId: 'candidate-1',
					requestBudget: { maximumValhallaCalls: 12, usedValhallaCalls: 9, elapsedMs: 25 },
				},
			}),
		});
	});
}

test.describe('Route generation through one server request', () => {
	test('sends one durable request per route and changes the seed', async ({ page }) => {
		const routeRequests: Record<string, unknown>[] = [];
		await mockRouteGeneration(page);
		await page.route('**/api/routing', async (interception) => {
			routeRequests.push(interception.request().postDataJSON());
			await interception.fallback();
		});
		await page.goto('/');
		await page.getByRole('button', { name: /Make my route/ }).click();

		await expect(page.getByText('Your loop', { exact: true })).toBeVisible();
		await expect(page.getByText('4.0', { exact: true })).toBeVisible();
		const anotherRoute = page.getByRole('button', { name: /Make another route/ });
		await expect(anotherRoute).toBeVisible();
		await expect(page.getByText(/Starts and ends at/)).toBeVisible();
		expect(routeRequests).toHaveLength(1);
		expect(routeRequests[0]).toMatchObject({
			start: [52.5208, 13.4095],
			target: { mode: 'distance', value: 4 },
			paceKmH: 5,
			requiredSpots: [],
			preferences: { backtracking: 'avoid' },
		});
		expect(routeRequests[0]?.seed).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
		expect(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThan(0);

		await anotherRoute.click();
		await expect.poll(() => routeRequests.length).toBe(2);
		expect(routeRequests[1]?.seed).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
		expect(routeRequests[1]?.seed).not.toBe(routeRequests[0]?.seed);
	});

	test('reports an upstream failure without drawing a fake route', async ({ page }) => {
		await page.route('**/api/routing', (interception) => interception.fulfill({
			status: 502,
			contentType: 'application/json',
			body: JSON.stringify({ code: 'ROUTING_UPSTREAM', message: 'upstream down' }),
		}));
		await page.goto('/');
		await page.getByRole('button', { name: /Make my route/ }).click();

		await expect(page.getByText(/Street routing is temporarily unavailable/)).toBeVisible();
		await expect(page.getByText('Your loop', { exact: true })).not.toBeVisible();
	});
});

test.describe('Starting points', () => {
	test('use my location keeps the start ephemeral', async ({ page }) => {
		await mockRouteGeneration(page);
		await page.goto('/');
		await page.context().grantPermissions(['geolocation']);
		await page.context().setGeolocation({ latitude: 52.53, longitude: 13.41 });

		await page.getByRole('button', { name: /Use my location/ }).click();
		await expect(page.getByText(/Starting point updated to your location/)).toBeVisible();
		await expect(page.getByText('No saved starting points yet.')).toBeVisible();
	});

	test('add current opens the naming form', async ({ page }) => {
		await page.goto('/');
		await page.context().grantPermissions(['geolocation']);
		await page.context().setGeolocation({ latitude: 52.53, longitude: 13.41 });

		await page.getByRole('button', { name: /Add current/ }).click();
		await expect(page.getByText('Name this starting point')).toBeVisible();
	});
});

test.describe('Place search', () => {
	test('search results save a walk-by spot', async ({ page }) => {
		await page.route('**/api/search?*', (interception) => {
			interception.fulfill({
				contentType: 'application/json',
				body: JSON.stringify([{
					place_id: 1,
					display_name: 'Test Café, Berlin, Germany',
					name: 'Test Café',
					lat: '52.52',
					lon: '13.40',
				}]),
			});
		});
		await page.goto('/');
		await page.locator('#place-query').fill('cafe');
		await page.getByRole('button', { name: 'Search' }).click();

		const result = page.getByRole('button', { name: 'Test Café' });
		await expect(result).toBeVisible();
		await result.click();
		await expect(page.getByText(/Walk-by spot saved/)).toBeVisible();
		await expect(page.getByText('★  Test Café')).toBeVisible();
	});
});
