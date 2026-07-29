import { loopPoints, targetKilometers, walkingLoop } from "./route.mjs";

const DEFAULT_LOCATION = [52.5208, 13.4095];
const STORAGE_KEY = "roam:favorites";

const $ = (selector) => document.querySelector(selector);
const targetInput = $("#target");
const targetRange = $("#target-range");
const makeRouteButton = $("#make-route");
const routeSummary = $("#route-summary");
const favoritesList = $("#favorites-list");
const mapTip = $("#map-tip");
const spotForm = $("#spot-form");
const spotName = $("#spot-name");
const toast = $("#toast");

let mode = "distance";
let start = DEFAULT_LOCATION;
let bearing = 25;
let addingSpot = false;
let pendingSpot;
let routeLine;
let previewLine;
let toastTimer;
let installPrompt;
let favorites = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

const map = L.map("map", { zoomControl: false }).setView(start, 14);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

const startIcon = L.divIcon({
  className: "start-marker",
  html: "<span></span>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const favoriteIcon = L.divIcon({
  className: "favorite-marker",
  html: "<span>★</span>",
  iconSize: [24, 28],
  iconAnchor: [12, 28],
});
const startMarker = L.marker(start, { icon: startIcon, zIndexOffset: 500 })
  .addTo(map)
  .bindTooltip("Your start", { direction: "top", offset: [0, -8] });
const favoriteLayer = L.layerGroup().addTo(map);

function pace() {
  return Number(document.querySelector('input[name="pace"]:checked').value);
}

function targetKm() {
  return targetKilometers(mode, Number(targetInput.value), pace());
}

function updateRangeFill() {
  const min = Number(targetRange.min);
  const max = Number(targetRange.max);
  const value = Number(targetRange.value);
  targetRange.style.setProperty("--value", `${((value - min) / (max - min)) * 100}%`);
}

function setTarget(value) {
  targetInput.value = value;
  targetRange.value = value;
  updateRangeFill();
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  const timeMode = mode === "time";
  $("#target-label").textContent = timeMode ? "How long?" : "How far?";
  $("#target-unit").textContent = timeMode ? "min" : "km";
  targetInput.min = targetRange.min = timeMode ? 10 : 1;
  targetInput.max = targetRange.max = timeMode ? 180 : 20;
  targetInput.step = targetRange.step = timeMode ? 5 : 0.5;
  targetRange.setAttribute("aria-label", timeMode ? "Walking time" : "Walking distance");
  $("#range-min").textContent = timeMode ? "10 min" : "1 km";
  $("#range-max").textContent = timeMode ? "180 min" : "20 km";
  setTarget(timeMode ? 45 : 4);
  drawPreview();
}

function selectedFavorites() {
  return favorites.filter((favorite) => favorite.selected).map(({ lat, lng }) => [lat, lng]);
}

function renderFavorites() {
  favoriteLayer.clearLayers();
  favoritesList.innerHTML = "";

  if (!favorites.length) {
    favoritesList.innerHTML =
      '<p class="empty-favorites">No saved spots yet. Add one from the map.</p>';
  }

  favorites.forEach((favorite) => {
    const row = document.createElement("div");
    row.className = "favorite-row";
    row.innerHTML = `
      <label>
        <input type="checkbox" ${favorite.selected ? "checked" : ""}>
        <span>★ &nbsp;${escapeHtml(favorite.name)}</span>
      </label>
      <button type="button" aria-label="Delete ${escapeHtml(favorite.name)}">×</button>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      favorite.selected = event.target.checked;
      saveFavorites();
      drawPreview();
    });
    row.querySelector("button").addEventListener("click", () => {
      favorites = favorites.filter(({ id }) => id !== favorite.id);
      saveFavorites();
      renderFavorites();
      drawPreview();
    });
    favoritesList.append(row);

    L.marker([favorite.lat, favorite.lng], { icon: favoriteIcon })
      .bindTooltip(favorite.name, { direction: "top", offset: [0, -23] })
      .addTo(favoriteLayer);
  });
}

function saveFavorites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function drawPreview() {
  if (routeLine) return;
  if (previewLine) map.removeLayer(previewLine);
  previewLine = L.polyline(loopPoints(start, targetKm(), bearing, selectedFavorites()), {
    color: "#476f64",
    weight: 3,
    opacity: 0.48,
    dashArray: "3 10",
    lineCap: "round",
  }).addTo(map);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => (toast.hidden = true), 4200);
}

function endSpotMode() {
  addingSpot = false;
  pendingSpot = undefined;
  mapTip.hidden = true;
  spotForm.hidden = true;
  map.getContainer().style.cursor = "";
}

function openSpotForm(latlng) {
  pendingSpot = latlng;
  mapTip.hidden = true;
  spotForm.hidden = false;
  spotName.value = "";
  spotName.focus();
}

function locate() {
  const button = $("#locate");
  button.disabled = true;
  button.lastChild.textContent = " Locating…";
  navigator.geolocation?.getCurrentPosition(
    ({ coords }) => {
      start = [coords.latitude, coords.longitude];
      startMarker.setLatLng(start);
      map.setView(start, 15);
      clearRoute();
      showToast("Starting point updated to your location.");
      button.disabled = false;
      button.lastChild.textContent = " Use my location";
    },
    () => {
      showToast("Location wasn’t available. The sample location stays selected.");
      button.disabled = false;
      button.lastChild.textContent = " Use my location";
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

async function makeRoute() {
  const requestedKm = targetKm();
  if (!Number.isFinite(requestedKm) || requestedKm < 0.5 || requestedKm > 30) {
    showToast("Choose a walk between 0.5 and 30 km.");
    return;
  }

  makeRouteButton.disabled = true;
  makeRouteButton.querySelector("span").textContent = "Finding quiet streets…";
  if (routeLine) map.removeLayer(routeLine);
  routeLine = undefined;

  try {
    const route = await walkingLoop(start, requestedKm, bearing, selectedFavorites());
    const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    if (previewLine) {
      map.removeLayer(previewLine);
      previewLine = undefined;
    }
    routeLine = L.polyline(coordinates, {
      color: "#ec6b38",
      weight: 6,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round",
      className: "route-pulse",
    }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [54, 54] });

    const distance = route.distance / 1000;
    $("#route-distance").textContent = distance.toFixed(1);
    $("#route-time").textContent = Math.round((distance / pace()) * 60);
    $("#route-note").textContent = selectedFavorites().length
      ? "Includes your selected walk-by spots."
      : "Starts and ends at your location.";
    routeSummary.hidden = false;
    bearing = (bearing + 67) % 360;
  } catch {
    const fallback = loopPoints(start, requestedKm, bearing, selectedFavorites());
    if (previewLine) map.removeLayer(previewLine);
    previewLine = undefined;
    routeLine = L.polyline(fallback, {
      color: "#ec6b38",
      weight: 5,
      opacity: 0.8,
      dashArray: "8 9",
    }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [54, 54] });
    $("#route-distance").textContent = requestedKm.toFixed(1);
    $("#route-time").textContent = Math.round((requestedKm / pace()) * 60);
    $("#route-note").textContent = "Preview only—street routing is temporarily unavailable.";
    routeSummary.hidden = false;
    showToast("Street routing is unavailable, so this is an approximate loop.");
  } finally {
    makeRouteButton.disabled = false;
    makeRouteButton.querySelector("span").textContent = "Make another route";
  }
}

function clearRoute() {
  if (routeLine) map.removeLayer(routeLine);
  routeLine = undefined;
  routeSummary.hidden = true;
  makeRouteButton.querySelector("span").textContent = "Make my route";
  drawPreview();
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
targetRange.addEventListener("input", () => {
  targetInput.value = targetRange.value;
  updateRangeFill();
  drawPreview();
});
targetInput.addEventListener("input", () => {
  targetRange.value = targetInput.value;
  updateRangeFill();
  drawPreview();
});
document.querySelectorAll('input[name="pace"]').forEach((input) => {
  input.addEventListener("change", drawPreview);
});
$("#locate").addEventListener("click", locate);
$("#make-route").addEventListener("click", makeRoute);
$("#clear-route").addEventListener("click", clearRoute);
$("#add-spot").addEventListener("click", () => {
  addingSpot = true;
  mapTip.hidden = false;
  map.getContainer().style.cursor = "crosshair";
  map.getContainer().scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#cancel-spot").addEventListener("click", endSpotMode);
$("#center-spot").addEventListener("click", () => openSpotForm(map.getCenter()));
$(".spot-form-close").addEventListener("click", endSpotMode);

map.on("click", ({ latlng }) => {
  if (!addingSpot) return;
  openSpotForm(latlng);
});

spotForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingSpot || !spotName.value.trim()) return;
  favorites.push({
    id: crypto.randomUUID(),
    name: spotName.value.trim(),
    lat: pendingSpot.lat,
    lng: pendingSpot.lng,
    selected: true,
  });
  saveFavorites();
  renderFavorites();
  endSpotMode();
  drawPreview();
  showToast("Walk-by spot saved.");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#install-button").hidden = false;
});
$("#install-button").addEventListener("click", async () => {
  await installPrompt?.prompt();
  installPrompt = undefined;
  $("#install-button").hidden = true;
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

renderFavorites();
updateRangeFill();
drawPreview();
setTimeout(() => map.invalidateSize(), 0);
