import { test, expect } from '@playwright/test';

// Critical user flows with mocked API proxies — deterministic, no external
// services. The production server routes (/api/*) are what the app calls;
// these tests stub the upstream side of those proxies.

const LOOP_COORDS: [number, number][] = [
	[13.4095, 52.5208],
	[13.42, 52.5208],
	[13.42, 52.53],
	[13.4095, 52.53],
	[13.4095, 52.5208],
];

async function mockApis(page: import('@playwright/test').Page) {
	await page.route('**/api/routing?*', (route) => {
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				code: 'Ok',
				routes: [
					{
						distance: 4000,
						duration: 3000,
						weight: 1,
						geometry: { coordinates: LOOP_COORDS },
					},
				],
			}),
		});
	});
	await page.route('**/api/stations?*', (route) => {
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ available: true, stations: [] }),
		});
	});
}

test.describe('Route generation through the server proxy', () => {
	test('generates a route and shows the summary', async ({ page }) => {
		await mockApis(page);
		await page.goto('/');
		await page.getByRole('button', { name: /Make my route/ }).click();

		await expect(page.getByText('Your loop', { exact: true })).toBeVisible();
		await expect(page.getByText('4.0', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: /Make another route/ })).toBeVisible();
		await expect(page.getByText(/Starts and ends at/)).toBeVisible();

		const hasRouteLine = await page.evaluate(() =>
			document.querySelectorAll('.leaflet-overlay-pane path').length > 0,
		);
		expect(hasRouteLine).toBe(true);
	});

	test('shows a dashed approximate loop when street routing fails', async ({
		page,
	}) => {
		await page.route('**/api/routing?*', (route) =>
			route.fulfill({ status: 502, body: 'upstream down' }),
		);
		await page.route('**/api/stations?*', (route) =>
			route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({ available: false, stations: [] }),
			}),
		);
		await page.goto('/');
		await page.getByRole('button', { name: /Make my route/ }).click();

		await expect(page.getByText(/Street routing is unavailable/)).toBeVisible();
		const dashedLoop = await page.evaluate(() => {
			const paths = [...document.querySelectorAll('.leaflet-overlay-pane path')] as SVGPathElement[];
			return paths.some((p) => p.getAttribute('stroke-dasharray') === '8 9');
		});
		expect(dashedLoop).toBe(true);
	});
});

test.describe('Starting points', () => {
	test('use my location keeps the start ephemeral (no saved point)', async ({
		page,
	}) => {
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
