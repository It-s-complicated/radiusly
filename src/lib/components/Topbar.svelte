<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	let { user }: { user: { name: string } | null } = $props();
	let installPrompt: BeforeInstallPromptEvent | undefined = $state();
	let signingOut = $state(false);

	function onInstallClick() {
		if (!installPrompt) return;
		installPrompt.prompt();
		installPrompt = undefined;
	}

	function onBeforeInstall(event: BeforeInstallPromptEvent) {
		event.preventDefault();
		installPrompt = event;
	}

	async function signOut() {
		signingOut = true;
		await authClient.signOut();
		await goto('/login', { invalidateAll: true });
	}

	if (typeof window !== 'undefined') {
		window.addEventListener('beforeinstallprompt', onBeforeInstall as EventListener);
	}
</script>

<header class="topbar">
	<a class="brand" href="/" aria-label="Radiusly home" onclick={(e) => e.preventDefault()}>
		<span class="brand-mark" aria-hidden="true">
			<svg viewBox="0 0 40 40">
				<path d="M10 30c1-9 3-14 10-12 7 3 7-8 10-9" />
				<circle cx="10" cy="30" r="3" />
				<circle cx="30" cy="9" r="3" />
			</svg>
		</span>
		<span>radiusly</span>
	</a>

	<p class="topbar-note"><span></span> Your next walk, made to fit.</p>

	<div class="topbar-actions">
		{#if installPrompt}
			<button class="install-button" type="button" onclick={onInstallClick}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
				</svg>
				Install app
			</button>
		{/if}
		{#if user}
			<button class="install-button" type="button" onclick={signOut} disabled={signingOut}>
				{signingOut ? 'Signing out…' : 'Sign out'}
			</button>
		{/if}
	</div>
</header>
