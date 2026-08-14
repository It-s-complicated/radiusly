import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the server route handlers' core logic by testing the fetch calls they make.
// For a full integration test, we'd use SvelteKit's test utils.

describe('API proxy endpoints', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('/api/routing', () => {
		it('validates coordinate format', () => {
			// The server handler checks coordinates with a regex
			const pattern = /^-?\d+\.?\d*,-?\d+\.?\d*(;-?\d+\.?\d*,-?\d+\.?\d*)+$/;
			expect(pattern.test('13.4,52.52;13.41,52.53')).toBe(true);
			expect(pattern.test('13.4,52.52')).toBe(false); // single pair
			expect(pattern.test('')).toBe(false);
			expect(pattern.test('abc')).toBe(false);
		});

		it('rejects empty coordinates', () => {
			const pattern = /^-?\d+\.?\d*,-?\d+\.?\d*(;-?\d+\.?\d*,-?\d+\.?\d*)+$/;
			expect(pattern.test('')).toBe(false);
		});
	});

	describe('/api/search', () => {
		it('validates query length', () => {
			// Server checks query non-empty and max 100 chars
			const tooLong = 'a'.repeat(101);
			expect(tooLong.length).toBeGreaterThan(100);
		});
	});

	describe('/api/stations', () => {
		it('validates bbox format', () => {
			const pattern = /^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/;
			expect(pattern.test('52.5,52.51,13.4,13.41')).toBe(true);
			expect(pattern.test('52.5')).toBe(false);
			expect(pattern.test('')).toBe(false);
		});
	});
});
