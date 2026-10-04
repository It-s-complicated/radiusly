<script lang="ts">
	import { toast } from '#lib/stores/route.js';
</script>

{#if $toast}
	<div class="toast" role="status">{$toast}</div>
{/if}
