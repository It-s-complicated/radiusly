import {
	BETTER_AUTH_URL,
	BETTER_AUTH_SECRET,
	GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET,
	GITHUB_PROVIDER_ID,
} from '$app/env/private';
import { betterAuth } from 'better-auth';
import { assertAllowedGithubUser } from './github-access';
import { AUTH_CLIENT_IP_HEADER } from './trusted-auth-headers';

export const auth = betterAuth({
	appName: 'Radiusly',
	baseURL: BETTER_AUTH_URL,
	secret: BETTER_AUTH_SECRET,
	socialProviders: {
		github: {
			clientId: GITHUB_CLIENT_ID,
			clientSecret: GITHUB_CLIENT_SECRET,
			mapProfileToUser(profile) {
				assertAllowedGithubUser(profile.id, GITHUB_PROVIDER_ID);
				return {};
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
		ipAddress: {
			ipAddressHeaders: [AUTH_CLIENT_IP_HEADER],
		},
	},
	onAPIError: {
		errorURL: '/login',
	},
});
