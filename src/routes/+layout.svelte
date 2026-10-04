<script lang="ts">
	import '../app.css';
	import Topbar from '#lib/components/Topbar.svelte';
	import { asset } from '$app/paths';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;
		let controlled = Boolean(navigator.serviceWorker.controller);
		const onControllerChange = () => {
			if (controlled) window.location.reload();
			controlled = true;
		};
		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
		return () =>
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
	});
</script>

<svelte:head>
	<link rel="manifest" href={asset('manifest.webmanifest')} />
</svelte:head>

<Topbar user={data.user} />
{@render children()}
