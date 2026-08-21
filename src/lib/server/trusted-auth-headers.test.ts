import { describe, expect, it } from 'vitest';
import { AUTH_CLIENT_IP_HEADER, trustedAuthHeaders } from './trusted-auth-headers';

describe('trustedAuthHeaders', () => {
	it('replaces a client-supplied IP with the server-provided address', () => {
		const headers = trustedAuthHeaders(
			new Headers({ [AUTH_CLIENT_IP_HEADER]: '203.0.113.1' }),
			'127.0.0.1',
		);

		expect(headers.get(AUTH_CLIENT_IP_HEADER)).toBe('127.0.0.1');
	});
});
