import { building } from '$app/env';
import { defineEnvVars } from '@sveltejs/kit/env';

function requiredEnv(name: string, value: string | undefined): string {
	if (value) return value;
	if (building) return `${name.toLowerCase()}-build-placeholder`;
	throw new Error(`${name} is required`);
}

export const variables = defineEnvVars({
	BETTER_AUTH_URL: { schema: (value) => requiredEnv('BETTER_AUTH_URL', value) },
	BETTER_AUTH_SECRET: { schema: (value) => requiredEnv('BETTER_AUTH_SECRET', value) },
	GITHUB_CLIENT_ID: { schema: (value) => requiredEnv('GITHUB_CLIENT_ID', value) },
	GITHUB_CLIENT_SECRET: { schema: (value) => requiredEnv('GITHUB_CLIENT_SECRET', value) },
	GITHUB_PROVIDER_ID: { schema: (value) => requiredEnv('GITHUB_PROVIDER_ID', value) },
	ROUTING_GRAPH_PATH: { schema: (value) => value || 'data/routing/graph.json' },
});
