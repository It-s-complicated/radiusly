import { mkdir, writeFile } from 'node:fs/promises';
import { betterAuth } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import type { FullConfig } from '@playwright/test';

const baseURL = 'http://localhost:4173';
const secret = 'radiusly-e2e-secret-at-least-32-characters';

export const TEST_AUTH_ENV = {
	BETTER_AUTH_URL: baseURL,
	BETTER_AUTH_SECRET: secret,
	GITHUB_CLIENT_ID: 'e2e-client-id',
	GITHUB_CLIENT_SECRET: 'e2e-client-secret',
	GITHUB_PROVIDER_ID: '10267784',
};

export default async function globalSetup(_config: FullConfig): Promise<void> {
	const auth = betterAuth({
		baseURL,
		secret,
		session: {
			cookieCache: {
				enabled: true,
				maxAge: 7 * 24 * 60 * 60,
				strategy: 'jwe',
				refreshCache: true,
				version: '1',
			},
		},
		account: { storeStateStrategy: 'cookie', storeAccountCookie: true },
		advanced: { cookiePrefix: 'radiusly' },
		plugins: [testUtils()],
	});
	const helpers = (await auth.$context).test;
	const user = helpers.createUser({
		id: '10267784',
		name: 'Radiusly Owner',
		email: 'owner@example.com',
	});
	await helpers.saveUser(user);
	const login = await helpers.login({ userId: user.id });
	const response = await auth.handler(
		new Request(`${baseURL}/api/auth/get-session`, {
			headers: { cookie: login.cookies.map(({ name, value }) => `${name}=${value}`).join('; ') },
		}),
	);
	const sessionToken = login.cookies.find((cookie) => cookie.name === 'radiusly.session_token');
	const serialized = response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('radiusly.session_data='));
	if (!sessionToken || !serialized) {
		throw new Error('Better Auth did not issue stateless session cookies');
	}

	await mkdir('.auth', { recursive: true });
	await writeFile(
		'.auth/user.json',
		JSON.stringify({
			cookies: [
				{
					name: sessionToken.name,
					value: sessionToken.value,
					domain: 'localhost',
					path: '/',
					httpOnly: true,
					secure: false,
					sameSite: 'Lax',
				},
				{
					name: 'radiusly.session_data',
					value: serialized.slice('radiusly.session_data='.length).split(';', 1)[0],
					domain: 'localhost',
					path: '/',
					httpOnly: true,
					secure: false,
					sameSite: 'Lax',
				},
			],
			origins: [],
		}),
	);
}
