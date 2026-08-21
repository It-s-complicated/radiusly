import { test, expect } from '@playwright/test';

test.describe('Planner critical flow', () => {
	test('page loads with title', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle(/Radiusly/);
	});

	test('leaflet map is visible', async ({ page }) => {
		await page.goto('/');
		const map = page.locator('#map');
		await expect(map).toBeVisible();
	});

	test('make my route button exists', async ({ page }) => {
		await page.goto('/');
		const button = page.getByRole('button', { name: /Make my route/i });
		await expect(button).toBeVisible();
	});

	test('mode switch toggles between distance/time', async ({ page }) => {
		await page.goto('/');
		const timeBtn = page.getByRole('button', { name: 'Time' });
		await timeBtn.click();

		// After clicking Time, the label should change
		await expect(page.locator('#target-label')).toHaveText('How long?');
		await expect(page.locator('#target-unit')).toHaveText('min');

		// Click Distance back
		const distBtn = page.getByRole('button', { name: 'Distance' });
		await distBtn.click();
		await expect(page.locator('#target-label')).toHaveText('How far?');
		await expect(page.locator('#target-unit')).toHaveText('km');
	});

	test('5 route shape radio buttons are present and selectable', async ({ page }) => {
		await page.goto('/');
		const shapeRadios = page.locator('input[name="route-algorithm"]');
		await expect(shapeRadios).toHaveCount(5);

		// Select tangent
		await shapeRadios.nth(1).check();
		await expect(shapeRadios.nth(1)).toBeChecked();
	});

	test('locate button is visible', async ({ page }) => {
		await page.goto('/');
		const locateBtn = page.getByRole('button', { name: /Use my location/i });
		await expect(locateBtn).toBeVisible();
	});
});
