<script lang="ts">
	import type { SavedPoint, Mode, Pace, Algorithm } from '$lib/types';
	import { starts, selectedStartId, favorites } from '$lib/stores/points';
	import { mode, distanceTarget, timeTarget, pace, algorithm } from '$lib/stores/preferences';
	import { currentRoute, routeDebug, isLoading, showToast } from '$lib/stores/route';
	import RouteSummary from './RouteSummary.svelte';

	let {
		onAddCurrent,
		onPinStart,
		onPinSpot,
		onSearchPlaces,
		searchResults = [] as SavedPoint[],
		onSearchResult,
		onMakeRoute,
	}: {
		onAddCurrent?: () => void;
		onPinStart?: () => void;
		onPinSpot?: () => void;
		onSearchPlaces?: (query: string) => void;
		searchResults?: SavedPoint[];
		onSearchResult?: (result: SavedPoint) => void;
		onMakeRoute?: () => void;
	} = $props();

	let currentSearchQuery = $state('');

	function handleSearchSubmit(e: Event) {
		e.preventDefault();
		const q = currentSearchQuery.trim();
		if (q) onSearchPlaces?.(q);
	}

	function renamePoint(
		points: SavedPoint[],
		save: (p: SavedPoint[]) => void,
		point: SavedPoint,
	) {
		const name = prompt('Rename this place', point.name)?.trim();
		if (!name) return;
		const updated = points.map((p) =>
			p.id === point.id ? { ...p, name } : p,
		);
		save(updated);
	}

	function deletePoint(
		points: SavedPoint[],
		save: (p: SavedPoint[]) => void,
		point: SavedPoint,
	) {
		const updated = points.filter((p) => p.id !== point.id);
		save(updated);
	}

	function setStart(point: SavedPoint) {
		selectedStartId.set(point.id);
	}

	function toggleFavorite(fav: SavedPoint) {
		favorites.update((f) =>
			f.map((x) => (x.id === fav.id ? { ...x, selected: !x.selected } : x)),
		);
	}

	let targetValue = $derived(
		$mode === 'time' ? $timeTarget : $distanceTarget,
	);

	function setTarget(v: number) {
		if ($mode === 'time') timeTarget.set(v);
		else distanceTarget.set(v);
	}

	const ROUTE_ALGORITHMS: { value: Algorithm; label: string; desc: string }[] = [
		{ value: 'organic', label: 'Organic', desc: 'Varied loop' },
		{ value: 'tangent', label: 'Tangent', desc: 'Start on rim' },
		{ value: 'orbit-same', label: 'Orbit', desc: 'Same return' },
		{ value: 'orbit-near', label: 'Orbit', desc: 'Nearby return' },
		{ value: 'spaghetti', label: 'Spaghetti', desc: 'Tangled crossings' },
	];
</script>

<section class="planner" aria-labelledby="planner-title">
	<div class="planner-inner">
		<p class="eyebrow">Plan a loop</p>
		<h1 id="planner-title">A good walk starts right here.</h1>
		<p class="intro">
			Tell us how far—or how long—and we'll find a way back.
		</p>

		<details class="planner-options" open>
			<summary>
				<span>Route options</span>
				<small>Starting point, distance, shape, pace & stops</small>
			</summary>

			<!-- Starting points -->
			<section class="points-section start-points" aria-labelledby="starts-title">
				<div class="section-heading">
					<div>
						<h2 id="starts-title">Starting point</h2>
						<p>Save places you regularly walk from.</p>
					</div>
				</div>
				<div class="point-actions">
					<button
						class="secondary-button"
						type="button"
						id="add-current-start"
						onclick={() => onAddCurrent?.()}
					>
						◎ Add current
					</button>
					<button class="secondary-button" type="button" onclick={() => onPinStart?.()}>
						＋ Pin on map
					</button>
				</div>
				<div class="points-list" id="starts-list">
					{#if $starts.length === 0}
						<p class="empty-points">No saved starting points yet.</p>
					{/if}
					{#each $starts as point (point.id)}
						<div class="point-row">
							<label>
								<input
									type="radio"
									name="starting-point"
									checked={point.id === $selectedStartId}
									onchange={() => setStart(point)}
								/>
								<span>{point.name}</span>
							</label>
							<div class="row-actions">
								<button
									class="rename"
									type="button"
									aria-label="Rename {point.name}"
									onclick={() => renamePoint($starts, (p) => starts.set(p), point)}
								>✎</button>
								<button
									class="delete"
									type="button"
									aria-label="Delete {point.name}"
									onclick={() => deletePoint($starts, (p) => starts.set(p), point)}
								>×</button>
							</div>
						</div>
					{/each}
				</div>
			</section>

			<!-- Route shape -->
			<fieldset class="route-shape-field">
				<legend>Route shape</legend>
				<div class="route-shape-grid">
					{#each ROUTE_ALGORITHMS as algo}
						<label>
							<input
								type="radio"
								name="route-algorithm"
								value={algo.value}
								checked={$algorithm === algo.value}
								onchange={() => {
									algorithm.set(algo.value);
									currentRoute.set(null);
								}}
							/>
							<span>
								{#if algo.value === 'organic'}
									<svg viewBox="0 0 80 48" aria-hidden="true">
										<path d="M14 34C7 25 14 13 27 12C38 11 42 6 54 11C68 16 72 29 62 37C52 45 43 35 34 38C25 42 10 43 14 34" />
										<circle cx="14" cy="34" r="3" />
									</svg>
								{:else if algo.value === 'tangent'}
									<svg viewBox="0 0 80 48" aria-hidden="true">
										<path d="M40 42a18 18 0 1 1 0-36 18 18 0 1 1 0 36Z" />
										<circle cx="40" cy="42" r="3" />
									</svg>
								{:else if algo.value === 'orbit-same'}
									<svg viewBox="0 0 80 48" aria-hidden="true">
										<path d="M40 24V40a16 16 0 1 1 0-32 16 16 0 1 1 0 32V24" />
										<circle cx="40" cy="24" r="3" />
									</svg>
								{:else if algo.value === 'orbit-near'}
									<svg viewBox="0 0 80 48" aria-hidden="true">
										<path d="M40 24 36 39a16 16 0 1 1 8 0L40 24" />
										<circle cx="40" cy="24" r="3" />
									</svg>
								{:else if algo.value === 'spaghetti'}
									<svg viewBox="0 0 80 48" aria-hidden="true">
										<path d="M40 24C55 8 74 14 66 30C58 45 38 34 50 23C62 12 45 4 32 9C18 15 19 31 31 34C43 37 39 20 25 17C11 14 5 29 16 37C28 46 51 40 57 27C63 14 48 13 40 24" />
										<circle cx="40" cy="24" r="3" />
									</svg>
								{/if}
								<b>{algo.label}</b>
								<small>{algo.desc}</small>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<!-- Mode switch -->
			<div class="mode-switch" role="group" aria-label="Plan by">
				<button
					type="button"
					class:active={$mode === 'distance'}
					onclick={() => mode.set('distance')}
				>Distance</button>
				<button
					type="button"
					class:active={$mode === 'time'}
					onclick={() => mode.set('time')}
				>Time</button>
			</div>

			<!-- Target control -->
			<div class="target-control">
				<label for="target" id="target-label">{$mode === 'time' ? 'How long?' : 'How far?'}</label>
				<div class="target-value">
					<input
						id="target"
						type="number"
						min={$mode === 'time' ? 10 : 1}
						max={$mode === 'time' ? 180 : 20}
						step={$mode === 'time' ? 5 : 0.5}
						value={targetValue}
						oninput={(e) => setTarget(Number((e.target as HTMLInputElement).value))}
					/>
					<span id="target-unit">{$mode === 'time' ? 'min' : 'km'}</span>
				</div>
				<input
					id="target-range"
					class="range"
					type="range"
					min={$mode === 'time' ? 10 : 1}
					max={$mode === 'time' ? 180 : 20}
					step={$mode === 'time' ? 5 : 0.5}
					value={targetValue}
					oninput={(e) => setTarget(Number((e.target as HTMLInputElement).value))}
					aria-label={$mode === 'time' ? 'Walking time' : 'Walking distance'}
				/>
				<div class="range-labels" aria-hidden="true">
					<span>{$mode === 'time' ? '10 min' : '1 km'}</span>
					<span>{$mode === 'time' ? '180 min' : '20 km'}</span>
				</div>
			</div>

			<!-- Pace -->
			<fieldset class="pace-field">
				<legend>Walking pace</legend>
				<label>
					<input type="radio" name="pace" value="4" checked={$pace === 4} onchange={() => pace.set(4)} />
					<span><b>Easy</b><small>4 km/h</small></span>
				</label>
				<label>
					<input type="radio" name="pace" value="5" checked={$pace === 5} onchange={() => pace.set(5)} />
					<span><b>Steady</b><small>5 km/h</small></span>
				</label>
				<label>
					<input type="radio" name="pace" value="6" checked={$pace === 6} onchange={() => pace.set(6)} />
					<span><b>Brisk</b><small>6 km/h</small></span>
				</label>
			</fieldset>

			<!-- Walk-by spots -->
			<section class="points-section favorites-section" aria-labelledby="favorites-title">
				<div class="section-heading">
					<div>
						<h2 id="favorites-title">Walk-by spots</h2>
						<p>Include a favorite place in your loop.</p>
					</div>
					<button class="secondary-button compact" type="button" onclick={() => onPinSpot?.()}>
						<span aria-hidden="true">＋</span> Pin on map
					</button>
				</div>
				<form class="place-search" onsubmit={handleSearchSubmit}>
					<label class="sr-only" for="place-query">Search for a walk-by spot</label>
					<input
						id="place-query"
						bind:value={currentSearchQuery}
						placeholder="Search café, park, address…"
						required
					/>
					<button type="submit">Search</button>
				</form>
				{#if searchResults.length > 0}
					<div class="place-results" aria-live="polite">
						{#each searchResults as result}
							<button type="button" onclick={() => onSearchResult?.(result)}>
								{result.name}
							</button>
						{/each}
					</div>
				{/if}
				<div class="points-list" id="favorites-list">
					{#if $favorites.length === 0}
						<p class="empty-points">No saved spots yet.</p>
					{/if}
					{#each $favorites as fav (fav.id)}
						<div class="point-row">
							<label>
								<input type="checkbox" checked={fav.selected} onchange={() => toggleFavorite(fav)} />
								<span>★ &nbsp;{fav.name}</span>
							</label>
							<div class="row-actions">
								<button
									class="rename"
									type="button"
									aria-label="Rename {fav.name}"
									onclick={() => renamePoint($favorites, (p) => favorites.set(p), fav)}
								>✎</button>
								<button
									class="delete"
									type="button"
									aria-label="Delete {fav.name}"
									onclick={() => deletePoint($favorites, (p) => favorites.set(p), fav)}
								>×</button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		</details>

		<div class="route-output">
			<button
				class="primary-button"
				type="button"
				disabled={$isLoading}
				onclick={onMakeRoute}
			>
				<span>{$isLoading ? 'Comparing route options…' : $currentRoute ? 'Make another route' : 'Make my route'}</span>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M5 12h14m-5-5 5 5-5 5" />
				</svg>
			</button>
			<RouteSummary />
		</div>
	</div>
</section>
