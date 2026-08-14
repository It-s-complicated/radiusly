<script lang="ts">
	import { currentRoute, routeDebug, showToast } from '$lib/stores/route';
	import { pace } from '$lib/stores/preferences';
	import { starts, selectedStartId, favorites } from '$lib/stores/points';

	function formatDistance(meters: number): string {
		return (meters / 1000).toFixed(1);
	}

	function formatTime(distanceKm: number): string {
		return Math.round((distanceKm / $pace) * 60).toString();
	}

	function routeNote(): string {
		if (!$currentRoute) return '';
		const selectedSpotsCount = $favorites.filter((f) => f.selected).length;
		if (selectedSpotsCount > 0) return 'Includes your selected walk-by spots.';
		const start = $starts.find((s) => s.id === $selectedStartId);
		return `Starts and ends at ${start?.name || 'your starting point'}.`;
	}

	async function copyDebug() {
		if (!$routeDebug) return;
		try {
			await navigator.clipboard.writeText(
				JSON.stringify($routeDebug, null, 2),
			);
			showToast('Debugging information copied.');
		} catch {
			showToast("Couldn't copy debugging information.");
		}
	}
</script>

{#if $currentRoute}
	<article class="route-summary" aria-live="polite">
		<div class="route-summary-top">
			<span class="route-badge">Your loop</span>
			<button type="button" aria-label="Clear route" onclick={() => currentRoute.set(null)}>×</button>
		</div>
		<div class="route-metrics">
			<p>
				<strong>{formatDistance($currentRoute.distance)}</strong><span>km</span>
			</p>
			<p>
				<strong>{formatTime($currentRoute.distance / 1000)}</strong><span>min</span>
			</p>
			<p>
				<strong>{Math.round($currentRoute.repeatRatio * 100)}</strong
				><span>% repeated</span>
			</p>
		</div>
		<p>{routeNote()}</p>
		{#if $routeDebug}
			<button class="debug-button" type="button" onclick={copyDebug}>
				Copy debugging information
			</button>
		{/if}
	</article>
{/if}
