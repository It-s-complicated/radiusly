import { expect, test } from '@playwright/test';

test.describe('without a session', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('requires GitHub sign-in for the app', async ({ page }) => {
		await page.goto('/');

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
	});

	test('starts the GitHub OAuth flow', async ({ request }) => {
		const response = await request.post('/api/auth/sign-in/social', {
			headers: { origin: 'http://localhost:4173' },
			data: { provider: 'github', callbackURL: '/' },
		});
		const body = await response.json();

		expect(response.ok()).toBe(true);
		const authorizationURL = new URL(body.url);
		expect(authorizationURL.origin).toBe('https://github.com');
		expect(authorizationURL.searchParams.get('redirect_uri')).toBe(
			'http://localhost:4173/api/auth/callback/github',
		);
	});

	test('rejects route generation', async ({ request }) => {
		const response = await request.post('/api/routing', {
			data: {
				start: [52.52, 13.4],
				target: { mode: 'distance', value: 4 },
				paceKmH: 5,
				requiredSpots: [],
				preferences: { backtracking: 'avoid' },
				seed: 'unauthenticated',
			},
		});

		expect(response.status()).toBe(401);
	});

	test('allows unauthenticated health checks', async ({ request }) => {
		const response = await request.get('/api/health');

		expect(response.status()).not.toBe(401);
	});
});

test('signs out', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Sign out' }).click();

	await expect(page).toHaveURL(/\/login$/);
});
