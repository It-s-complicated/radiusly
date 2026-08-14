import { APIError } from 'better-auth/api';

export function assertAllowedGithubUser(id: string | number, allowedId: string): void {
	if (String(id) !== allowedId) {
		throw new APIError('FORBIDDEN', { message: 'This GitHub account is not authorized.' });
	}
}
