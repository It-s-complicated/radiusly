<script lang="ts">
	import { onMount } from 'svelte';
	import type { LatLng } from '$lib/types';

	let { show = false, kind = 'start', onsubmit, onclose }: {
		show?: boolean;
		kind?: 'start' | 'favorite';
		onsubmit?: (name: string) => void;
		onclose?: () => void;
	} = $props();

	let name = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	function handleSubmit(e: Event) {
		e.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		onsubmit?.(trimmed);
		name = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}
</script>

{#if show}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="point-form"
		role="dialog"
		aria-modal="true"
		tabindex="0"
		onkeydown={handleKeydown}
	>
		<button
			class="point-form-close"
			type="button"
			aria-label="Close"
			onclick={onclose}
		>×</button>
		<form onsubmit={handleSubmit}>
			<label for="point-name" id="point-form-title">
				{kind === 'start' ? 'Name this starting point' : 'Name this walk-by spot'}
			</label>
			<div>
				<input
					bind:this={inputEl}
					id="point-name"
					type="text"
					maxlength="40"
					placeholder={kind === 'start' ? 'e.g. Home' : 'e.g. Favorite café'}
					bind:value={name}
					required
				/>
				<button type="submit">Save</button>
			</div>
		</form>
	</div>
{/if}
