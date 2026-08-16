<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { LatLng, SavedPoint } from '$lib/types';
	import 'leaflet/dist/leaflet.css';

	let {
		start = [52.5208, 13.4095] as LatLng,
		favorites = [] as SavedPoint[],
		previewPoints = [] as LatLng[],
		routePoints = [] as LatLng[],
		dashed = false,
		pinMode = false,
		onMapClick,
		onCenterClick,
		onlocate,
	}: {
		start?: LatLng;
		favorites?: SavedPoint[];
		previewPoints?: LatLng[];
		routePoints?: LatLng[];
		dashed?: boolean;
		pinMode?: boolean;
		onMapClick?: (latlng: LatLng) => void;
		onCenterClick?: (latlng: LatLng) => void;
		onlocate?: () => void;
	} = $props();

	let mapContainer: HTMLDivElement;
	let map: any; // L.Map
	let L: any;
	let startMarker: any;
	let favoriteLayer: any;
	let previewLine: any;
	let routeLine: any;

	// Track internal state to avoid re-initialization
	let mapInitialized = $state(false);

	onMount(async () => {
		L = await import('leaflet');

		// Fix default icon issue (not needed with divIcon, but good practice)
		map = L.map(mapContainer, { zoomControl: false }).setView(start, 14);
		L.control.zoom({ position: 'bottomright' }).addTo(map);

		L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
			maxZoom: 19,
		}).addTo(map);

		// Start marker
		const startIcon = L.divIcon({
			className: 'start-marker',
			html: '<span></span>',
			iconSize: [22, 22],
			iconAnchor: [11, 11],
		});
		startMarker = L.marker(start, { icon: startIcon, zIndexOffset: 500 })
			.addTo(map)
			.bindTooltip('Your start', { direction: 'top', offset: [0, -8] });

		// Favorite layer
		const favoriteIcon = L.divIcon({
			className: 'favorite-marker',
			html: '<span>★</span>',
			iconSize: [24, 28],
			iconAnchor: [12, 28],
		});
		favoriteLayer = L.layerGroup().addTo(map);

		// Map click
		map.on('click', (e: any) => {
			if (pinMode) onMapClick?.([e.latlng.lat, e.latlng.lng]);
		});

		mapInitialized = true;
	});

	onDestroy(() => {
		if (map) map.remove();
	});

	// Update start marker
	let lastStart: LatLng | undefined = undefined;
	$effect(() => {
		if (!mapInitialized || !startMarker) return;
		startMarker.setLatLng(start);
		startMarker.setTooltipContent('Your start');
		if (!lastStart) {
			// Initial placement already set by the map constructor
		} else if (lastStart[0] !== start[0] || lastStart[1] !== start[1]) {
			map.setView(start, 15);
		}
		lastStart = start;
	});

	// Update favorites
	$effect(() => {
		if (!mapInitialized || !favoriteLayer || !L) return;
		favoriteLayer.clearLayers();
		const favoriteIcon = L.divIcon({
			className: 'favorite-marker',
			html: '<span>★</span>',
			iconSize: [24, 28],
			iconAnchor: [12, 28],
		});
		favorites.forEach((f) => {
			L.marker([f.lat, f.lng], { icon: favoriteIcon })
				.bindTooltip(f.name, { direction: 'top', offset: [0, -23] })
				.addTo(favoriteLayer);
		});
	});

	// Update preview line
	$effect(() => {
		if (!mapInitialized || !L) return;
		if (routeLine) return; // Don't show preview when route is displayed
		if (previewLine) map.removeLayer(previewLine);
		if (previewPoints.length < 2) {
			previewLine = undefined;
			return;
		}
		previewLine = L.polyline(previewPoints, {
			color: '#476f64',
			weight: 3,
			opacity: 0.48,
			dashArray: '3 10',
			lineCap: 'round',
		}).addTo(map);
	});

	// Update route line
	$effect(() => {
		if (!mapInitialized || !L) return;
		if (routeLine) map.removeLayer(routeLine);
		routeLine = undefined;
		if (previewLine) {
			map.removeLayer(previewLine);
			previewLine = undefined;
		}
		if (routePoints.length < 2) return;
		routeLine = L.polyline(routePoints, {
			color: '#ec6b38',
			weight: dashed ? 5 : 6,
			opacity: dashed ? 0.8 : 0.96,
			dashArray: dashed ? '8 9' : undefined,
			lineCap: 'round',
			lineJoin: 'round',
			className: 'route-pulse',
		}).addTo(map);
		map.fitBounds(routeLine.getBounds(), { padding: [54, 54] });
	});

	// Pin mode cursor
	$effect(() => {
		if (!mapContainer) return;
		mapContainer.style.cursor = pinMode ? 'crosshair' : '';
	});

	function useCenter() {
		if (!map) return;
		const center = map.getCenter();
		onCenterClick?.([center.lat, center.lng]);
	}
</script>

<div bind:this={mapContainer} id="map"></div>

<div class="map-tip" hidden={!pinMode}>
	<span>Click the map, or use its center</span>
	<button type="button" onclick={useCenter}>Use center</button>
</div>

<div class="map-actions">
	<button type="button" id="locate" onclick={() => onlocate?.()}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="3" />
			<circle cx="12" cy="12" r="8" />
			<path d="M12 2V5M12 19v3M2 12h3M19 12h3" />
		</svg>
		<span>Use my location</span>
	</button>
</div>

<div class="map-caption">
	<span class="map-caption-icon" aria-hidden="true">↻</span>
	<span><b>Round trip</b><small>Starts & ends here</small></span>
</div>
