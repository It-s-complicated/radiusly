<script lang="ts">
	import { browser } from '$app/env';
	import { get } from 'svelte/store';
	import Map from '$lib/components/Map.svelte';
	import RouteOptions from '$lib/components/RouteOptions.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { starts, selectedStartId, favorites } from '$lib/stores/points';
	import {
		mode,
		distanceTarget,
		timeTarget,
		pace,
		algorithm,
		searchAlgorithm,
		targetKm,
	} from '$lib/stores/preferences';
	import { currentRoute, routeDebug, isLoading, showToast } from '$lib/stores/route';
	import { walkingLoop } from '$lib/route/api';
	import { loopPoints } from '$lib/route/shapes';
	import type { LatLng, SavedPoint } from '$lib/types';

	const DEFAULT_LOCATION: LatLng = [52.5208, 13.4095];

	const initialStart = get(starts).find((point) => point.id === get(selectedStartId));
	let mapStart = $state<LatLng>(
		initialStart ? [initialStart.lat, initialStart.lng] : DEFAULT_LOCATION,
	);
	let routedSyntheticPoints = $state<LatLng[]>([]);
	const routePoints = $derived<LatLng[]>(
		$currentRoute?.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng) ?? [],
	);
	const selectedSpots = $derived(
		$favorites.filter((f) => f.selected).map((f) => [f.lat, f.lng] as LatLng),
	);
	const previewPoints = $derived.by((): LatLng[] => {
		if ($currentRoute || !Number.isFinite($targetKm) || $targetKm < 0.5) return [];
		try {
			return loopPoints(mapStart, $targetKm, bearing, selectedSpots, 1, $algorithm);
		} catch {
			return [];
		}
	});
	const syntheticPoints = $derived(
		$currentRoute ? routedSyntheticPoints : generatedPoints(previewPoints, selectedSpots),
	);
	let bearing = $state(25);
	let pinMode = $state<'start' | 'favorite' | undefined>(undefined);
	let pendingPoint = $state<LatLng | undefined>(undefined);
	let pointFormKind = $state<'start' | 'favorite'>('start');
	let searchResults = $state<SavedPoint[]>([]);

	function selectStart(point: SavedPoint) {
		selectedStartId.set(point.id);
		mapStart = [point.lat, point.lng];
		clearRoute();
	}

	function generatedPoints(points: LatLng[], selectedSpots: LatLng[]): LatLng[] {
		return points
			.slice(1, -1)
			.filter(
				([lat, lng]) =>
					!selectedSpots.some(([spotLat, spotLng]) => lat === spotLat && lng === spotLng),
			);
	}

	async function makeRoute() {
		const km = $targetKm;
		if (!Number.isFinite(km) || km < 0.5 || km > 30) {
			showToast('Choose a walk between 0.5 and 30 km.');
			return;
		}
		isLoading.set(true);
		routeDebug.set(null);
		currentRoute.set(null);
		const request = {
			start: mapStart,
			target: { mode: $mode, value: $mode === 'time' ? $timeTarget : $distanceTarget },
			pace: $pace,
			shape: $algorithm,
			search: $searchAlgorithm,
			spots: $favorites.filter((f) => f.selected).map((f) => [f.lat, f.lng] as LatLng),
			bearing,
		};
		try {
			const { route, debug } = await walkingLoop(request);
			routedSyntheticPoints = generatedPoints(route.candidate?.points ?? [], request.spots);
			currentRoute.set(route);
			routeDebug.set(debug);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Route generation failed.';
			routeDebug.set({
				schemaVersion: 14,
				generatedAt: new Date().toISOString(),
				input: request,
				error: message,
				candidates:
					error && typeof error === 'object' && 'details' in error && Array.isArray(error.details)
						? error.details
						: undefined,
			});
			showToast(message);
		} finally {
			bearing = (bearing + 67) % 360;
			isLoading.set(false);
		}
	}

	function locate() {
		if (!browser) return;
		if (!navigator.geolocation) {
			showToast('Geolocation is not available in this browser.');
			return;
		}
		if (!window.isSecureContext) {
			showToast('Location needs HTTPS (or localhost) to work.');
			return;
		}
		const locateBtn = document.getElementById('locate') as HTMLButtonElement | null;
		const locateLabel = locateBtn?.querySelector('span');
		if (locateBtn) locateBtn.disabled = true;
		if (locateLabel) locateLabel.textContent = 'Locating…';

		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				if (locateBtn) locateBtn.disabled = false;
				if (locateLabel) locateLabel.textContent = 'Use my location';
				selectedStartId.set(undefined);
				mapStart = [coords.latitude, coords.longitude];
				clearRoute();
				showToast('Starting point updated to your location.');
			},
			(error) => {
				if (locateBtn) locateBtn.disabled = false;
				if (locateLabel) locateLabel.textContent = 'Use my location';
				showToast(geolocationMessage(error));
			},
			{ enableHighAccuracy: true, timeout: 10000 },
		);
	}

	function addCurrentStart() {
		if (!browser) return;
		if (!navigator.geolocation) {
			showToast('Geolocation is not available in this browser.');
			return;
		}
		if (!window.isSecureContext) {
			showToast('Location needs HTTPS (or localhost) to work.');
			return;
		}
		const btn = document.getElementById('add-current-start') as HTMLButtonElement | null;
		if (btn) btn.disabled = true;

		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				if (btn) btn.disabled = false;
				pendingPoint = [coords.latitude, coords.longitude];
				beginPin('start');
				pointFormKind = 'start';
			},
			(error) => {
				if (btn) btn.disabled = false;
				showToast(geolocationMessage(error));
			},
			{ enableHighAccuracy: true, timeout: 10000 },
		);
	}

	function geolocationMessage(error?: GeolocationPositionError): string {
		if (error?.code === 1) return 'Location permission was denied.';
		if (error?.code === 2) return 'Your position is currently unavailable.';
		if (error?.code === 3) return 'Finding your position timed out.';
		return 'Geolocation is not available in this browser.';
	}

	function handleMapClick(latlng: LatLng) {
		if (!pinMode) return;
		pendingPoint = latlng;
		pointFormKind = pinMode;
	}

	function handleCenterClick(latlng: LatLng) {
		if (!pinMode) return;
		pendingPoint = latlng;
		pointFormKind = pinMode;
	}

	let pointName = $state('');
	const pointNameId = $props.id();
	const pointDialogTitle = $derived(
		pointFormKind === 'start' ? 'Name this starting point' : 'Name this walk-by spot',
	);

	function beginPin(kind: 'start' | 'favorite') {
		pinMode = kind;
		pointName = '';
	}

	function submitPointName(e: SubmitEvent) {
		e.preventDefault();
		const name = pointName.trim();
		if (!name) return;
		handlePointFormSubmit(name);
		pointName = '';
	}

	function handlePointFormSubmit(name: string) {
		if (!pendingPoint) return;
		const point: SavedPoint = {
			id: crypto.randomUUID(),
			name,
			lat: pendingPoint[0],
			lng: pendingPoint[1],
		};
		if (pointFormKind === 'start') {
			starts.update((s) => [...s, point]);
			selectStart(point);
		} else {
			favorites.update((f) => [...f, { ...point, selected: true }]);
		}
		showToast(pointFormKind === 'start' ? 'Starting point saved.' : 'Walk-by spot saved.');
		pinMode = undefined;
		pendingPoint = undefined;
	}

	function cancelPin() {
		pinMode = undefined;
		pendingPoint = undefined;
	}

	async function searchPlaces(query: string) {
		if (!query) return;
		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
			if (!response.ok) throw new Error();
			const results = await response.json();
			if (!results.length) {
				showToast('No places found.');
				searchResults = [];
				return;
			}
			searchResults = results.map(
				(r: {
					place_id: number;
					display_name: string;
					name?: string;
					lat: string;
					lon: string;
				}) => ({
					id: String(r.place_id),
					name: r.name || r.display_name.split(',')[0] || '',
					lat: Number(r.lat),
					lng: Number(r.lon),
				}),
			);
		} catch {
			showToast('Place search is temporarily unavailable.');
			searchResults = [];
		}
	}

	function handleSearchResult(result: SavedPoint) {
		favorites.update((f) => [...f, { ...result, id: crypto.randomUUID(), selected: true }]);
		searchResults = [];
		showToast('Walk-by spot saved.');
	}

	function clearRoute() {
		currentRoute.set(null);
		routeDebug.set(null);
	}
</script>

<main class="app-shell">
	<RouteOptions
		{searchResults}
		onAddCurrent={addCurrentStart}
		onMakeRoute={makeRoute}
		onPinStart={() => beginPin('start')}
		onPinSpot={() => beginPin('favorite')}
		onSelectStart={selectStart}
		onSearchPlaces={searchPlaces}
		onSearchResult={handleSearchResult}
	/>

	<section class="map-panel" aria-label="Route map">
		<Map
			start={mapStart}
			favorites={$favorites}
			{previewPoints}
			{routePoints}
			{syntheticPoints}
			dashed={false}
			pinMode={pinMode !== undefined}
			onMapClick={handleMapClick}
			onCenterClick={handleCenterClick}
			onlocate={locate}
		/>
		<Dialog
			show={pinMode !== undefined && pendingPoint !== undefined}
			label={pointDialogTitle}
			onclose={cancelPin}
		>
			<form onsubmit={submitPointName}>
				<label for={pointNameId}>{pointDialogTitle}</label>
				<div>
					<input
						id={pointNameId}
						type="text"
						maxlength="40"
						placeholder={pointFormKind === 'start' ? 'e.g. Home' : 'e.g. Favorite café'}
						bind:value={pointName}
						required
					/>
					<button class="btn btn-md btn-primary" type="submit">Save</button>
				</div>
			</form>
		</Dialog>
		<Toast />
	</section>
</main>
