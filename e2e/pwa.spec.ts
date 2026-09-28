import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
	test('manifest link is present', async ({ page }) => {
		await page.goto('/');
		const manifest = page.locator('link[rel="manifest"]');
		await expect(manifest).toHaveAttribute('href', /manifest/);
	});

	test('activates the worker while navigations still reach the server', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready;
			if (!registration.active) throw new Error('Service worker did not activate');
		});
		await page.reload();
		await expect
			.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state))
			.toBe('activated');
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
		await page.context().clearCookies();
		await page.goto('/');
		await expect(page).toHaveURL(/\/login$/);
	});

	test('install button is hidden by default', async ({ page }) => {
		await page.goto('/');
		const installBtn = page.getByRole('button', { name: /Install app/i });
		// The install button is only shown after beforeinstallprompt event
		await expect(installBtn).not.toBeVisible();
	});
});
