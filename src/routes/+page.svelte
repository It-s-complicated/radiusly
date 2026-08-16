<script lang="ts">
	import { browser } from '$app/environment';
	import Map from '$lib/components/Map.svelte';
	import RouteOptions from '$lib/components/RouteOptions.svelte';
	import PointForm from '$lib/components/PointForm.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import { starts, selectedStartId, favorites } from '$lib/stores/points';
	import { mode, distanceTarget, timeTarget, pace, targetKm } from '$lib/stores/preferences';
	import { currentRoute, routeDebug, isLoading, showToast } from '$lib/stores/route';
	import { generateRoute, RouteRequestError } from '$lib/route/api';
	import type { LatLng, SavedPoint } from '$lib/types';

	const DEFAULT_LOCATION: LatLng = [52.5208, 13.4095];

	let mapStart = $state<LatLng>(DEFAULT_LOCATION);
	let previewPoints = $state<LatLng[]>([]);
	let routePoints = $state<LatLng[]>([]);
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

	$effect(() => {
		if (!$currentRoute) routePoints = [];
	});

	async function makeRoute() {
		const km = $targetKm;
		if (!Number.isFinite(km) || km < 0.5 || km > 30) {
			showToast('Choose a walk between 0.5 and 30 km.');
			return;
		}

		isLoading.set(true);
		routeDebug.set(null);
		const selectedSpots = $favorites
			.filter((favorite) => favorite.selected)
			.map((favorite) => ({
				name: favorite.name,
				coordinates: [favorite.lat, favorite.lng] as LatLng,
			}));

		try {
			const response = await generateRoute({
				start: mapStart,
				target: {
					mode: $mode,
					value: $mode === 'time' ? $timeTarget : $distanceTarget,
				},
				paceKmH: $pace,
				requiredSpots: selectedSpots,
				preferences: { backtracking: 'avoid' },
				seed: crypto.randomUUID().replaceAll('-', ''),
			});
			routePoints = response.route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LatLng);
			currentRoute.set(response.route);
			routeDebug.set(response.debug);
		} catch (error: unknown) {
			const routeError = error instanceof RouteRequestError ? error : undefined;
			if (routeError?.debug) routeDebug.set(routeError.debug);
			if (routeError?.code === 'ROUTE_QUALITY') {
				showToast('No low-backtracking route found. Make another route or adjust the walk.');
			} else if (routeError?.code === 'RATE_LIMITED') {
				showToast('Too many route requests. Wait a minute and try again.');
			} else {
				showToast('Street routing is temporarily unavailable. Try again shortly.');
			}
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
			dashed={false}
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
