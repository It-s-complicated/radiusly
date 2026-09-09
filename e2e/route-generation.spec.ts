import { test, expect } from '@playwright/test';

// Browser contract checks mock the generation endpoint; native graph checks live in routing.test.ts.

const LOOP_COORDS: [number, number][] = [
	[13.4095, 52.5208],
	[13.42, 52.5208],
	[13.42, 52.53],
	[13.4095, 52.53],
	[13.4095, 52.5208],
];

async function mockApis(page: import('@playwright/test').Page) {
	await page.route('**/api/routing', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				route: {
					distance: 4000,
					duration: 3000,
					weight: 1,
					geometry: { coordinates: LOOP_COORDS },
					repeatRatio: 0,
					repeatedDistance: 0,
					longestRepeatRatio: 0,
					longestRepeatDistance: 0,
					distanceError: 0,
					distanceErrorDistance: 0,
					stationRepeatDistance: 0,
					score: 0,
				},
				debug: { schemaVersion: 14, generatedAt: new Date().toISOString(), input: {} },
			}),
		}),
	);
}

test.describe('Local server route generation', () => {
	test('submits the selected search and shows the server result', async ({ page }) => {
		await mockApis(page);
		await page.goto('/');
		await page.getByRole('radio', { name: /Dijkstra/ }).check();
		const posted = page.waitForRequest((request) => request.url().endsWith('/api/routing'));
		await page.getByRole('button', { name: /Make my route/ }).click();
		expect((await posted).postDataJSON().search).toBe('dijkstra');
		await expect(page.getByText('Your loop', { exact: true })).toBeVisible();
		await expect(page.getByText('4.0', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: /Make another route/ })).toBeVisible();
		await page.reload();
		await expect(page.getByRole('radio', { name: /Dijkstra/ })).toBeChecked();
	});
	test('shows a useful missing-data error without a generated-route summary', async ({ page }) => {
		await page.route('**/api/routing', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({
					code: 'GRAPH_UNAVAILABLE',
					message: 'Local walking data is unavailable. Build the regional graph.',
				}),
			}),
		);
		await page.goto('/');
		await page.getByRole('button', { name: /Make my route/ }).click();
		await expect(page.getByText(/Local walking data is unavailable/)).toBeVisible();
		await expect(page.getByText('Your loop', { exact: true })).toHaveCount(0);
	});
});

test.describe('Starting points', () => {
	test('use my location keeps the start ephemeral (no saved point)', async ({ page }) => {
		await mockApis(page);
		await page.goto('/');
		await page.context().grantPermissions(['geolocation']);
		await page.context().setGeolocation({ latitude: 52.53, longitude: 13.41 });

		await page.getByRole('button', { name: /Use my location/ }).click();
		await expect(page.getByText(/Starting point updated to your location/)).toBeVisible();
		// The location must not be persisted as a named starting point.
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
		await page.route('**/api/search?*', (route) => {
			route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify([
					{
						place_id: 1,
						display_name: 'Test Café, Berlin, Germany',
						name: 'Test Café',
						lat: '52.52',
						lon: '13.40',
					},
				]),
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
