<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		show = false,
		label,
		backdrop = true,
		onclose,
		children,
	}: {
		show?: boolean;
		label: string;
		backdrop?: boolean;
		onclose?: () => void;
		children: Snippet;
	} = $props();

	let shell = $state<HTMLDialogElement>();

	$effect(() => {
		if (!shell) return;
		if (show && !shell.open) {
			shell.showModal();
			shell.querySelector('input')?.focus();
		} else if (!show && shell.open) {
			shell.close();
		}
	});
</script>

<dialog class="dialog {backdrop ? '' : 'dialog-bare'}" bind:this={shell} aria-label={label} onclose={onclose}>
	<button class="btn btn-icon btn-ghost dialog-close" type="button" aria-label="Close" onclick={() => shell?.close()}>
		×</button
	>
	{@render children()}
</dialog>
