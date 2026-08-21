import adapter from '@sveltejs/adapter-netlify';

/** @type {import('@sveltejs/kit').Config} */
const config = {
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
