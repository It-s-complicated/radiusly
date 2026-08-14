<script lang="ts">
	import { toast } from '$lib/stores/route';
</script>

{#if $toast}
	<div class="toast" role="status">{$toast}</div>
{/if}
