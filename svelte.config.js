import adapter from '@sveltejs/adapter-netlify';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		serviceWorker: {
			// PWA service worker is registered via the `virtual:pwa-register`
			// module in +layout.svelte; prevent SvelteKit's own registration.
			register: false,
		},
	},
};

export default config;
