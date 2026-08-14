import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth';
import { assertAllowedGithubUser } from './github-access';

function requiredEnv(name: string): string {
	const value = env[name];
	if (value) return value;
	if (building) return `${name.toLowerCase()}-build-placeholder`;
	throw new Error(`${name} is required`);
}

const allowedGithubId = requiredEnv('GITHUB_PROVIDER_ID');

export const auth = betterAuth({
	appName: 'Radiusly',
	baseURL: requiredEnv('BETTER_AUTH_URL'),
	secret: requiredEnv('BETTER_AUTH_SECRET'),
	socialProviders: {
		github: {
			clientId: requiredEnv('GITHUB_CLIENT_ID'),
			clientSecret: requiredEnv('GITHUB_CLIENT_SECRET'),
			mapProfileToUser(profile) {
				assertAllowedGithubUser(profile.id, allowedGithubId);
				return { id: String(profile.id) };
			},
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 7 * 24 * 60 * 60,
			strategy: 'jwe',
			refreshCache: true,
			version: '1',
		},
	},
	account: {
		storeStateStrategy: 'cookie',
		storeAccountCookie: true,
	},
	advanced: {
		cookiePrefix: 'radiusly',
		defaultCookieAttributes: {
			httpOnly: true,
			sameSite: 'lax',
		},
	},
	onAPIError: {
		errorURL: '/login',
	},
});
