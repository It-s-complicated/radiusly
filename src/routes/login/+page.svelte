<script lang="ts">
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';

	let signingIn = $state(false);
	let error = $state('');

	async function signIn() {
		signingIn = true;
		error = '';
		const result = await authClient.signIn.social({ provider: 'github', callbackURL: '/' });
		if (result.error) {
			error = result.error.message ?? 'GitHub sign-in failed.';
			signingIn = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — Radiusly</title>
</svelte:head>

<main class="login-shell">
	<section class="login-card" aria-labelledby="login-title">
		<p class="eyebrow">Private app</p>
		<h1 id="login-title">Welcome back.</h1>
		<p>Sign in with the authorized GitHub account to plan your next walk.</p>
		{#if error || page.url.searchParams.has('error')}
			<p class="login-error" role="alert">GitHub sign-in was not authorized.</p>
		{/if}
		<button class="btn btn-lg btn-primary" type="button" onclick={signIn} disabled={signingIn}>
			{signingIn ? 'Connecting…' : 'Continue with GitHub'}
		</button>
	</section>
</main>

<style>
	.login-shell {
		min-height: calc(100dvh - 72px);
		display: grid;
		place-items: center;
		padding: 24px;
	}

	.login-card {
		width: min(100%, 430px);
		padding: 40px;
		border: 1px solid var(--line);
		border-radius: 20px;
		background: var(--paper);
		box-shadow: 0 20px 60px rgb(23 63 53 / 10%);
	}

	h1 {
		margin: 8px 0 12px;
		font-size: 42px;
		letter-spacing: -0.04em;
	}

	p {
		line-height: 1.55;
	}

	button {
		width: 100%;
		margin-top: 18px;
	}

	.login-error {
		color: #9d321f;
		font-weight: 650;
	}
</style>
