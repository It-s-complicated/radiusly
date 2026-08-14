<script lang="ts">
	import { browser } from '$app/environment';
	import Map from '$lib/components/Map.svelte';
	import RouteOptions from '$lib/components/RouteOptions.svelte';
	import PointForm from '$lib/components/PointForm.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { starts, selectedStartId, favorites } from '$lib/stores/points';
	import { mode, distanceTarget, timeTarget, pace, algorithm, targetKm } from '$lib/stores/preferences';
	import { currentRoute, routeDebug, isLoading, showToast } from '$lib/stores/route';
	import { walkingLoop } from '$lib/route/api';
	import { loopPoints } from '$lib/route/shapes';
	import type { LatLng, SavedPoint } from '$lib/types';

	const DEFAULT_LOCATION: LatLng = [52.5208, 13.4095];

	let mapStart = $state<LatLng>(DEFAULT_LOCATION);
	let previewPoints = $state<LatLng[]>([]);
	let routePoints = $state<LatLng[]>([]);
	let fallbackMode = $state(false);
	let bearing = $state(25);
	let pinMode = $state<'start' | 'favorite' | undefined>(undefined);
	let pendingPoint = $state<LatLng | undefined>(undefined);
	let pointFormKind = $state<'start' | 'favorite'>('start');
	let searchResults = $state<SavedPoint[]>([]);

	// Follow the saved start selection; keep an ephemeral location when none
	// is selected (e.g. after "Use my location").
	$effect(() => {
		if (!$selectedStartId) return;
		const s = $starts.find((p) => p.id === $selectedStartId);
		if (!s) return;
		mapStart = [s.lat, s.lng];
		currentRoute.set(null);
	});

	// Draw preview when stores change and no route displayed
	$effect(() => {
		const _ = [$targetKm, $algorithm, $mode, $pace, $distanceTarget, $timeTarget];
		if ($currentRoute) return;
		drawPreview();
	});

	// Clear route points when currentRoute is set to null (keep the dashed
	// fallback loop, which is shown without a currentRoute)
	$effect(() => {
		if (!$currentRoute) {
			if (!fallbackMode) routePoints = [];
			drawPreview();
		}
	});

	function drawPreview() {
		if ($currentRoute) return;
		const km = $targetKm;
		if (!Number.isFinite(km) || km < 0.5) {
			previewPoints = [];
			return;
		}
		try {
			const selectedFavs = $favorites.filter((f) => f.selected).map((f) => [f.lat, f.lng] as LatLng);
			previewPoints = loopPoints(mapStart, km, bearing, selectedFavs, 1, $algorithm);
		} catch {
			previewPoints = [];
		}
	}

	async function makeRoute() {
		const km = $targetKm;
		if (!Number.isFinite(km) || km < 0.5 || km > 30) {
			showToast('Choose a walk between 0.5 and 30 km.');
			return;
		}

		isLoading.set(true);
		routeDebug.set(null);
		const routeBearing = bearing;
		const selectedFavs = $favorites.filter((f) => f.selected).map((f) => [f.lat, f.lng] as LatLng);

		try {
			const route = await walkingLoop(mapStart, km, routeBearing, selectedFavs, $algorithm);
			const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng);
			routePoints = coords;
			fallbackMode = false;
			currentRoute.set(route);
			routeDebug.set({
				schemaVersion: 12,
				generatedAt: new Date().toISOString(),
				input: {
					start: { name: $starts.find((s) => s.id === $selectedStartId)?.name, coordinates: mapStart },
					mode: $mode,
					enteredTarget: $mode === 'time' ? $timeTarget : $distanceTarget,
					targetKm: km,
					paceKmH: $pace,
					bearing: routeBearing,
					algorithm: $algorithm,
					selectedSpots: $favorites.filter((f) => f.selected).map((f) => ({ name: f.name, coordinates: [f.lat, f.lng] })),
				},
				candidates: route.debugCandidates,
				stationData: route.debugStationData,
				selectedRoute: {
					candidate: route.candidate,
					distance: route.distance,
					distanceError: route.distanceError,
					distanceErrorDistance: route.distanceErrorDistance,
					repeatRatio: route.repeatRatio,
					repeatedDistance: route.repeatedDistance,
					longestRepeatRatio: route.longestRepeatRatio,
					longestRepeatDistance: route.longestRepeatDistance,
					stationRepeatDistance: route.stationRepeatDistance,
					geometry: route.geometry,
				},
			});
			bearing = (bearing + 67) % 360;
		} catch (error: unknown) {
			const err = error as Error & { code?: string };
			if (err.code === 'ROUTE_QUALITY') {
				routeDebug.set({ schemaVersion: 12, generatedAt: new Date().toISOString(), input: {}, error: err.message });
				bearing = (bearing + 67) % 360;
				showToast('No low-backtracking route found. Try again or choose another route shape.');
				return;
			}
			const fallback = loopPoints(mapStart, km, routeBearing, selectedFavs, 1, $algorithm);
			routePoints = fallback;
			fallbackMode = true;
			previewPoints = [];
			showToast('Street routing is unavailable, so this is an approximate loop.');
			routeDebug.set({ schemaVersion: 12, generatedAt: new Date().toISOString(), input: {}, error: err.message, fallbackCoordinates: fallback });
		} finally {
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
				pinMode = 'start';
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

	function handlePointFormSubmit(name: string) {
		if (!pendingPoint) return;
		const point: SavedPoint = { id: crypto.randomUUID(), name, lat: pendingPoint[0], lng: pendingPoint[1] };
		if (pointFormKind === 'start') {
			starts.update((s) => [...s, point]);
			selectedStartId.set(point.id);
			mapStart = [point.lat, point.lng];
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
			if (!results.length) { showToast('No places found.'); searchResults = []; return; }
			searchResults = results.map((r: { place_id: number; display_name: string; name?: string; lat: string; lon: string }) => ({
				id: String(r.place_id),
				name: r.name || r.display_name.split(',')[0] || '',
				lat: Number(r.lat),
				lng: Number(r.lon),
			}));
		} catch { showToast('Place search is temporarily unavailable.'); searchResults = []; }
	}

	function handleSearchResult(result: SavedPoint) {
		favorites.update((f) => [...f, { ...result, id: crypto.randomUUID(), selected: true }]);
		searchResults = [];
		showToast('Walk-by spot saved.');
	}

	function clearRoute() {
		currentRoute.set(null);
		routeDebug.set(null);
		routePoints = [];
		fallbackMode = false;
		drawPreview();
	}
</script>

<main class="app-shell">
	<RouteOptions
		{searchResults}
		onAddCurrent={addCurrentStart}
		onMakeRoute={makeRoute}
		onPinStart={() => (pinMode = 'start')}
		onPinSpot={() => (pinMode = 'favorite')}
		onSearchPlaces={searchPlaces}
		onSearchResult={handleSearchResult}
	/>

	<section class="map-panel" aria-label="Route map">
		<Map
			start={mapStart}
			favorites={$favorites}
			{previewPoints}
			{routePoints}
			dashed={fallbackMode}
			pinMode={pinMode !== undefined}
			onMapClick={handleMapClick}
			onCenterClick={handleCenterClick}
			onlocate={locate}
		/>
		<PointForm
			show={pinMode !== undefined && pendingPoint !== undefined}
			kind={pointFormKind}
			onsubmit={handlePointFormSubmit}
			onclose={cancelPin}
		/>
		<Toast />
	</section>
</main>
