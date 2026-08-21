import { readFile, writeFile } from 'node:fs/promises';
import { evaluateLegacyBaseline } from '../src/lib/server/legacy-baseline';
import { generateRoute } from '../src/lib/server/route-generation';
import { ValhallaClient } from '../src/lib/server/valhalla';
import type { RouteGenerationRequest } from '../src/lib/route/contracts';

interface ValidationCase extends RouteGenerationRequest {
	id: string;
	area: 'dense-center' | 'residential-grid' | 'disconnected-or-park';
}

const [casesPath, outputPath] = process.argv.slice(2);
if (!casesPath) throw new Error('Usage: pnpm validate:routes <cases.json> [results.json]');

const baseUrl = process.env.VALHALLA_URL;
const apiToken = process.env.VALHALLA_API_TOKEN;
const graphVersion = process.env.VALHALLA_GRAPH_VERSION;
if (!baseUrl || !apiToken || !graphVersion) {
	throw new Error('VALHALLA_URL, VALHALLA_API_TOKEN, and VALHALLA_GRAPH_VERSION are required');
}

const allCases = JSON.parse(await readFile(casesPath, 'utf8')) as ValidationCase[];
if (!Array.isArray(allCases) || allCases.length === 0) throw new Error('Validation cases must be a non-empty array');
const cases = process.env.VALIDATION_CASE_ID
	? allCases.filter((validationCase) => validationCase.id === process.env.VALIDATION_CASE_ID)
	: allCases;
if (cases.length === 0) throw new Error(`Validation case ${process.env.VALIDATION_CASE_ID} was not found`);

const results = [];
for (const validationCase of cases) {
	const request: RouteGenerationRequest = {
		start: validationCase.start,
		target: validationCase.target,
		paceKmH: validationCase.paceKmH,
		requiredSpots: validationCase.requiredSpots,
		preferences: validationCase.preferences,
		seed: validationCase.seed,
	};
	const networkClient = client(12);
	let network: unknown;
	try {
		network = await generateRoute(request, networkClient, graphVersion);
	} catch (error) {
		network = {
			error: error instanceof Error ? error.message : 'Network generator failed',
			debug: error && typeof error === 'object' && 'debug' in error ? error.debug : undefined,
		};
	}
	const legacy = await evaluateLegacyBaseline(request, client(10));
	results.push({
		id: validationCase.id,
		area: validationCase.area,
		request,
		network,
		legacy,
	});
}

const report = JSON.stringify({
	generatedAt: new Date().toISOString(),
	graphVersion,
	generatorVersion: 'network-contours-1',
	results,
}, null, 2);
if (outputPath) {
	await writeFile(outputPath, `${report}\n`, 'utf8');
} else {
	console.log(report);
}

function client(maximumCalls: number): ValhallaClient {
	return new ValhallaClient({
		baseUrl,
		apiToken,
		signal: AbortSignal.timeout(60_000),
		maximumCalls,
		maximumConcurrency: 3,
		callTimeoutMs: 10_000,
	});
}
