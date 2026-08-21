import { defineConfig } from '@playwright/test';
import { TEST_AUTH_ENV } from './e2e/auth.setup';

export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/auth.setup.ts',
	use: { baseURL: 'http://localhost:4173', storageState: '.auth/user.json' },
	webServer: {
		command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4173',
		env: { ...process.env, ...TEST_AUTH_ENV },
		port: 4173,
		reuseExistingServer: !process.env.CI,
	},
});
