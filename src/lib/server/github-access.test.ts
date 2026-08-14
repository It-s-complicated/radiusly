import { describe, expect, it } from 'vitest';
import { assertAllowedGithubUser } from './github-access';

const allowedId = '10267784';

describe('GitHub access restriction', () => {
	it('accepts only the configured GitHub account', () => {
		expect(() => assertAllowedGithubUser(allowedId, allowedId)).not.toThrow();
		expect(() => assertAllowedGithubUser(Number(allowedId), allowedId)).not.toThrow();
		expect(() => assertAllowedGithubUser('1', allowedId)).toThrow('not authorized');
	});
});
