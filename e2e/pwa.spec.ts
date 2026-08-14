import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
	test('manifest link is present', async ({ page }) => {
		await page.goto('/');
		const manifest = page.locator('link[rel="manifest"]');
		await expect(manifest).toHaveAttribute('href', /manifest/);
	});

	test('install button is hidden by default', async ({ page }) => {
		await page.goto('/');
		const installBtn = page.getByRole('button', { name: /Install app/i });
		// The install button is only shown after beforeinstallprompt event
		await expect(installBtn).not.toBeVisible();
	});
});
