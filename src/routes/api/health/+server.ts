import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { redisHealth } from '$lib/server/route-runtime';
import { valhallaStatus } from '$lib/server/valhalla';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		if (!env.VALHALLA_URL || !env.VALHALLA_GRAPH_VERSION || !env.VALHALLA_API_TOKEN) {
			throw new Error('Valhalla configuration is incomplete');
		}
		const [valhalla, redis] = await Promise.all([
			valhallaStatus(env.VALHALLA_URL, env.VALHALLA_API_TOKEN, AbortSignal.timeout(2_000)),
			redisHealth(),
		]);
		return json({
			status: 'ok',
			graphDataVersion: env.VALHALLA_GRAPH_VERSION,
			valhalla,
			redis,
		});
	} catch (error) {
		return json(
			{
				status: 'unhealthy',
				message: error instanceof Error ? error.message : 'Health check failed',
			},
			{ status: 503 },
		);
	}
};
