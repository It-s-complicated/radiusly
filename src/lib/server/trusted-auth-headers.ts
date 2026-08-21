export const AUTH_CLIENT_IP_HEADER = 'x-radiusly-client-ip';

export function trustedAuthHeaders(headers: Headers, clientAddress: string): Headers {
	const trusted = new Headers(headers);
	trusted.set(AUTH_CLIENT_IP_HEADER, clientAddress);
	return trusted;
}
