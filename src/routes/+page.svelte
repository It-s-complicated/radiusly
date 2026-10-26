<script lang="ts">
	import { browser } from '$app/env';
	import { get } from 'svelte/store';
	import Map from '#lib/components/Map.svelte';
	import RouteOptions from '#lib/components/RouteOptions.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Toast from '#lib/components/Toast.svelte';
	import { starts, selectedStartId, favorites } from '#lib/stores/points.js';
	import { preferences, targetKm } from '#lib/stores/preferences.js';
	import { currentRoute, routeDebug, clearRoute, isLoading, showToast } from '#lib/stores/route.js';
	import { walkingLoop } from '#lib/route/api.js';
	import { loopWaypoints } from '#lib/route/shapes.js';
	import type { LatLng, SavedPoint, Waypoint } from '#lib/types.js';

	const DEFAULT_LOCATION: LatLng = [52.5208, 13.4095];

	const initialStart = get(starts).find((point) => point.id === get(selectedStartId));
	let mapStart = $state<LatLng>(
		initialStart ? [initialStart.lat, initialStart.lng] : DEFAULT_LOCATION,
	);
	const routePoints = $derived<LatLng[]>(
		$currentRoute?.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng) ?? [],
	);
	const selectedSpots = $derived(
		$favorites.filter((f) => f.selected).map((f) => [f.lat, f.lng] as LatLng),
	);
	const previewWaypoints = $derived.by((): Waypoint[] => {
		if ($currentRoute || !Number.isFinite($targetKm) || $targetKm < 0.5) return [];
		try {
			return loopWaypoints(mapStart, $targetKm, bearing, selectedSpots, 1, $preferences.algorithm);
		} catch {
			return [];
		}
	});
	const previewPoints = $derived(previewWaypoints.map((waypoint) => waypoint.point));
	const syntheticPoints = $derived(
		($currentRoute ? ($currentRoute.candidate?.waypoints ?? []) : previewWaypoints)
			.filter((waypoint) => waypoint.role === 'generated-anchor')
			.map((waypoint) => waypoint.point),
	);
	let bearing = $state(25);
	let pinMode = $state<'start' | 'favorite' | undefined>(undefined);
	let pendingPoint = $state<LatLng | undefined>(undefined);
	let pointFormKind = $state<'start' | 'favorite'>('start');
	let searchResults = $state<SavedPoint[]>([]);
	let locating = $state(false);
	let addingCurrentStart = $state(false);

	function selectStart(point: SavedPoint) {
		selectedStartId.set(point.id);
		mapStart = [point.lat, point.lng];
		clearRoute();
	}

	async function makeRoute() {
		const km = $targetKm;
		if (!Number.isFinite(km) || km < 0.5 || km > 30) {
			showToast('Choose a walk between 0.5 and 30 km.');
			return;
		}
		isLoading.set(true);
		clearRoute();
		const request = {
			start: mapStart,
			target: {
				mode: $preferences.mode,
				value: $preferences.mode === 'time' ? $preferences.time : $preferences.distance,
			},
			pace: $preferences.pace,
			shape: $preferences.algorithm,
			search: $preferences.search,
			spots: $favorites.filter((f) => f.selected).map((f) => [f.lat, f.lng] as LatLng),
			bearing,
		};
		try {
			const { route, debug } = await walkingLoop(request);
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

	async function currentLocation(): Promise<LatLng | undefined> {
		if (!browser) return;
		if (!navigator.geolocation) {
			showToast('Geolocation is not available in this browser.');
			return;
		}
		if (!window.isSecureContext) {
			showToast('Location needs HTTPS (or localhost) to work.');
			return;
		}
		try {
			return await new Promise<LatLng>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(
					({ coords }) => resolve([coords.latitude, coords.longitude]),
					reject,
					{ enableHighAccuracy: true, timeout: 10000 },
				);
			});
		} catch (error) {
			showToast(geolocationMessage(error as GeolocationPositionError));
		}
	}

	async function locate(): Promise<void> {
		locating = true;
		try {
			const point = await currentLocation();
			if (!point) return;
			selectedStartId.set(undefined);
			mapStart = point;
			clearRoute();
			showToast('Starting point updated to your location.');
		} finally {
			locating = false;
		}
	}

	async function addCurrentStart(): Promise<void> {
		addingCurrentStart = true;
		try {
			const point = await currentLocation();
			if (!point) return;
			beginPin('start');
			handleMapClick(point);
		} finally {
			addingCurrentStart = false;
		}
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
		pointDialog.shell.showModal();
	}

	let pointDialog: ReturnType<typeof Dialog>;
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
		cancelPin();
		pointDialog.shell.close();
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
</script>

<main class="app-shell">
	<RouteOptions
		{searchResults}
		{addingCurrentStart}
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
			{locating}
			dashed={false}
			pinMode={pinMode !== undefined}
			onMapClick={handleMapClick}
			onCenterClick={handleMapClick}
			onlocate={locate}
		/>
		<Dialog bind:this={pointDialog} label={pointDialogTitle} onclose={cancelPin}>
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
