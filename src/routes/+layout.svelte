<script lang="ts">
	import '../app.css';
	import Topbar from '$lib/components/Topbar.svelte';
	import { onMount } from 'svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	onMount(async () => {
		if (pwaInfo) {
			const { registerSW } = await import('virtual:pwa-register');
			registerSW({ immediate: true });
		}
	});
</script>

<svelte:head>
	{#if pwaInfo?.webManifest.linkTag}
		{@html pwaInfo.webManifest.linkTag}
	{/if}
</svelte:head>

<Topbar user={data.user} />
{@render children()}
