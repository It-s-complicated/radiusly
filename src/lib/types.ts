export type LatLng = [number, number]; // [lat, lng]
export type LngLat = [number, number]; // [lng, lat] — GeoJSON

export type Mode = 'distance' | 'time';
export type Pace = 4 | 5 | 6;

export interface SavedPoint {
	id: string;
	name: string;
	lat: number;
	lng: number;
	selected?: boolean;
}
