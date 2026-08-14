import { test, expect } from '@playwright/test';

test.describe('Map interactions', () => {
	test('"Use my location" button exists', async ({ page }) => {
		await page.goto('/');
		const button = page.getByRole('button', { name: /Use my location/i });
		await expect(button).toBeVisible();
	});

	test('place search form renders', async ({ page }) => {
		await page.goto('/');
		const searchInput = page.locator('#place-query');
		await expect(searchInput).toBeVisible();
		await expect(searchInput).toHaveAttribute(
			'placeholder',
			/Search/,
		);
	});
});
