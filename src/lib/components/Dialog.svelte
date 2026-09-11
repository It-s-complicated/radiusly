<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		backdrop = true,
		onclose,
		children,
	}: {
		label: string;
		backdrop?: boolean;
		onclose?: () => void;
		children: Snippet;
	} = $props();

	let shell: HTMLDialogElement;

	export { shell };
</script>

<dialog
	class="dialog {backdrop ? '' : 'dialog-bare'}"
	bind:this={shell}
	aria-label={label}
	{onclose}
>
	<button
		class="btn btn-icon btn-ghost dialog-close"
		type="button"
		aria-label="Close"
		onclick={() => shell.close()}
	>
		×</button
	>
	{@render children()}
</dialog>
