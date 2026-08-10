import { loopPoints, targetKilometers, walkingLoop } from "./route.mjs";

const DEFAULT_LOCATION = [52.5208, 13.4095];
const FAVORITES_KEY = "radiusly:favorites";
const STARTS_KEY = "radiusly:starts";
const SELECTED_START_KEY = "radiusly:selected-start";
const PREFERENCES_KEY = "radiusly:preferences";
const ROUTE_ALGORITHMS = ["organic", "tangent", "orbit-same", "orbit-near", "spaghetti"];

const $ = (selector) => document.querySelector(selector);
if (matchMedia("(max-width: 760px)").matches) $(".planner-options").open = false;
const targetInput = $("#target");
const targetRange = $("#target-range");
const makeRouteButton = $("#make-route");
const routeSummary = $("#route-summary");
const favoritesList = $("#favorites-list");
const startsList = $("#starts-list");
const mapTip = $("#map-tip");
const pointForm = $("#point-form");
const pointName = $("#point-name");
const placeResults = $("#place-results");
const toast = $("#toast");

const savedPreferences = storedObject(PREFERENCES_KEY);
if (savedPreferences.algorithm === "chaos") savedPreferences.algorithm = "spaghetti";
const targets = {
  distance: preferenceValue(savedPreferences.distance, 1, 20, 4),
  time: preferenceValue(savedPreferences.time, 10, 180, 45),
};
const savedPace = [4, 5, 6].includes(Number(savedPreferences.pace))
  ? Number(savedPreferences.pace)
  : 5;
const savedAlgorithm = ROUTE_ALGORITHMS.includes(savedPreferences.algorithm)
  ? savedPreferences.algorithm
  : "organic";
let mode = savedPreferences.mode === "time" ? "time" : "distance";
let bearing = 25;
let pinMode;
let pendingPoint;
let routeLine;
let previewLine;
let toastTimer;
let installPrompt;
let routeDebug;
let favorites = storedList(FAVORITES_KEY);
let starts = storedList(STARTS_KEY);
let selectedStartId = localStorage.getItem(SELECTED_START_KEY);
let start = coordinates(starts.find(({ id }) => id === selectedStartId)) || DEFAULT_LOCATION;

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

function storedList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function storedObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function preferenceValue(value, min, max, fallback) {
  const number = Number(value);
  return number >= min && number <= max ? number : fallback;
}

function coordinates(point) {
  return point && [point.lat, point.lng];
}

function pace() {
  return Number(document.querySelector('input[name="pace"]:checked').value);
}

function routeAlgorithm() {
  return document.querySelector('input[name="route-algorithm"]:checked').value;
}

function targetKm() {
  return targetKilometers(mode, Number(targetInput.value), pace());
}

function savePreferences() {
  localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({
      mode,
      distance: targets.distance,
      time: targets.time,
      pace: pace(),
      algorithm: routeAlgorithm(),
    }),
  );
}

function rememberTarget(value) {
  const number = Number(value);
  if (Number.isFinite(number)) targets[mode] = number;
  savePreferences();
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
  setTarget(targets[mode]);
  savePreferences();
  drawPreview();
}

function selectedFavorites() {
  return favorites.filter(({ selected }) => selected).map(({ lat, lng }) => [lat, lng]);
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

function saveStarts() {
  localStorage.setItem(STARTS_KEY, JSON.stringify(starts));
  if (selectedStartId) localStorage.setItem(SELECTED_START_KEY, selectedStartId);
  else localStorage.removeItem(SELECTED_START_KEY);
}

function renamePoint(point, save, render) {
  const name = prompt("Rename this place", point.name)?.trim();
  if (!name) return;
  point.name = name;
  save();
  render();
  if (point.id === selectedStartId) startMarker.setTooltipContent(escapeHtml(name));
}

function setStart(point) {
  start = coordinates(point) || DEFAULT_LOCATION;
  selectedStartId = point?.id;
  saveStarts();
  startMarker.setLatLng(start).setTooltipContent(point ? escapeHtml(point.name) : "Your start");
  map.setView(start, 15);
  clearRoute();
  renderStarts();
}

function renderStarts() {
  startsList.innerHTML = starts.length
    ? ""
    : '<p class="empty-points">No saved starting points yet.</p>';
  starts.forEach((point) => {
    const row = document.createElement("div");
    row.className = "point-row";
    row.innerHTML = `
      <label>
        <input type="radio" name="starting-point" ${point.id === selectedStartId ? "checked" : ""}>
        <span>${escapeHtml(point.name)}</span>
      </label>
      <div class="row-actions">
        <button class="rename" type="button" aria-label="Rename ${escapeHtml(point.name)}">✎</button>
        <button class="delete" type="button" aria-label="Delete ${escapeHtml(point.name)}">×</button>
      </div>
    `;
    row.querySelector("input").addEventListener("change", () => setStart(point));
    row.querySelector(".rename").addEventListener("click", () =>
      renamePoint(point, saveStarts, renderStarts),
    );
    row.querySelector(".delete").addEventListener("click", () => {
      starts = starts.filter(({ id }) => id !== point.id);
      if (point.id === selectedStartId) setStart(starts[0]);
      else {
        saveStarts();
        renderStarts();
      }
    });
    startsList.append(row);
  });
}

function renderFavorites() {
  favoriteLayer.clearLayers();
  favoritesList.innerHTML = favorites.length ? "" : '<p class="empty-points">No saved spots yet.</p>';

  favorites.forEach((favorite) => {
    const row = document.createElement("div");
    row.className = "point-row";
    row.innerHTML = `
      <label>
        <input type="checkbox" ${favorite.selected ? "checked" : ""}>
        <span>★ &nbsp;${escapeHtml(favorite.name)}</span>
      </label>
      <div class="row-actions">
        <button class="rename" type="button" aria-label="Rename ${escapeHtml(favorite.name)}">✎</button>
        <button class="delete" type="button" aria-label="Delete ${escapeHtml(favorite.name)}">×</button>
      </div>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      favorite.selected = event.target.checked;
      saveFavorites();
      drawPreview();
    });
    row.querySelector(".rename").addEventListener("click", () =>
      renamePoint(favorite, saveFavorites, renderFavorites),
    );
    row.querySelector(".delete").addEventListener("click", () => {
      favorites = favorites.filter(({ id }) => id !== favorite.id);
      saveFavorites();
      renderFavorites();
      drawPreview();
    });
    favoritesList.append(row);

    L.marker([favorite.lat, favorite.lng], { icon: favoriteIcon })
      .bindTooltip(escapeHtml(favorite.name), { direction: "top", offset: [0, -23] })
      .addTo(favoriteLayer);
  });
}

function drawPreview() {
  if (routeLine) return;
  if (previewLine) map.removeLayer(previewLine);
  previewLine = L.polyline(
    loopPoints(start, targetKm(), bearing, selectedFavorites(), 1, routeAlgorithm()),
    {
      color: "#476f64",
      weight: 3,
      opacity: 0.48,
      dashArray: "3 10",
      lineCap: "round",
    },
  ).addTo(map);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => (toast.hidden = true), 4200);
}

function endPointMode() {
  pinMode = undefined;
  pendingPoint = undefined;
  mapTip.hidden = true;
  pointForm.hidden = true;
  map.getContainer().style.cursor = "";
}

function beginPin(kind) {
  pinMode = kind;
  mapTip.hidden = false;
  map.getContainer().style.cursor = "crosshair";
  map.getContainer().scrollIntoView({ behavior: "smooth", block: "center" });
}

function openPointForm(latlng, kind = pinMode) {
  pendingPoint = latlng;
  pinMode = kind;
  mapTip.hidden = true;
  pointForm.hidden = false;
  $("#point-form-title").textContent =
    kind === "start" ? "Name this starting point" : "Name this walk-by spot";
  pointName.placeholder = kind === "start" ? "e.g. Home" : "e.g. Favorite café";
  pointName.value = "";
  pointName.focus();
}

function geolocationMessage(error) {
  if (!window.isSecureContext) return "Location needs HTTPS (or localhost) to work.";
  if (error?.code === 1) return "Location permission was denied.";
  if (error?.code === 2) return "Your position is currently unavailable.";
  if (error?.code === 3) return "Finding your position timed out.";
  return "Geolocation is not available in this browser.";
}

function requestLocation(onSuccess, button) {
  if (!window.isSecureContext || !navigator.geolocation) {
    showToast(geolocationMessage());
    if (button?.id === "locate") button.lastChild.textContent = " Use my location";
    return;
  }
  if (button) button.disabled = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      if (button) button.disabled = false;
      onSuccess(L.latLng(coords.latitude, coords.longitude));
    },
    (error) => {
      if (button) button.disabled = false;
      if (button?.id === "locate") button.lastChild.textContent = " Use my location";
      showToast(geolocationMessage(error));
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function locate() {
  const button = $("#locate");
  button.lastChild.textContent = " Locating…";
  requestLocation((latlng) => {
    selectedStartId = undefined;
    setStart({ lat: latlng.lat, lng: latlng.lng });
    showToast("Starting point updated to your location.");
    button.lastChild.textContent = " Use my location";
  }, button);
  if (!window.isSecureContext || !navigator.geolocation)
    button.lastChild.textContent = " Use my location";
}

async function searchPlaces(event) {
  event.preventDefault();
  const query = $("#place-query").value.trim();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  button.textContent = "Searching…";
  placeResults.textContent = "";

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
    );
    if (!response.ok) throw new Error();
    const results = await response.json();
    if (!results.length) placeResults.textContent = "No places found.";
    results.forEach((result) => {
      const resultButton = document.createElement("button");
      resultButton.type = "button";
      resultButton.textContent = result.display_name;
      resultButton.addEventListener("click", () => {
        favorites.push({
          id: crypto.randomUUID(),
          name: result.name || result.display_name.split(",")[0],
          lat: Number(result.lat),
          lng: Number(result.lon),
          selected: true,
        });
        saveFavorites();
        renderFavorites();
        placeResults.textContent = "";
        map.setView([result.lat, result.lon], 15);
        drawPreview();
        showToast("Walk-by spot saved.");
      });
      placeResults.append(resultButton);
    });
  } catch {
    placeResults.textContent = "Place search is temporarily unavailable.";
  } finally {
    button.disabled = false;
    button.textContent = "Search";
  }
}

async function makeRoute() {
  const requestedKm = targetKm();
  if (!Number.isFinite(requestedKm) || requestedKm < 0.5 || requestedKm > 30) {
    showToast("Choose a walk between 0.5 and 30 km.");
    return;
  }

  makeRouteButton.disabled = true;
  makeRouteButton.querySelector("span").textContent = "Comparing route options…";
  if (routeLine) map.removeLayer(routeLine);
  routeLine = undefined;
  const routeBearing = bearing;
  const inputDebug = {
    start: {
      name: starts.find(({ id }) => id === selectedStartId)?.name,
      coordinates: start,
    },
    mode,
    enteredTarget: Number(targetInput.value),
    targetKm: requestedKm,
    paceKmH: pace(),
    bearing: routeBearing,
    algorithm: routeAlgorithm(),
    selectedSpots: favorites
      .filter(({ selected }) => selected)
      .map(({ name, lat, lng }) => ({ name, coordinates: [lat, lng] })),
  };

  try {
    const route = await walkingLoop(
      start,
      requestedKm,
      routeBearing,
      selectedFavorites(),
      routeAlgorithm(),
    );
    const routeCoordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    if (previewLine) map.removeLayer(previewLine);
    previewLine = undefined;
    routeLine = L.polyline(routeCoordinates, {
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
    $("#route-repeat").textContent = Math.round(route.repeatRatio * 100);
    $("#route-repeat-metric").hidden = false;
    $("#route-note").textContent = selectedFavorites().length
      ? "Includes your selected walk-by spots."
      : `Starts and ends at ${starts.find(({ id }) => id === selectedStartId)?.name || "your starting point"}.`;
    routeSummary.hidden = false;
    routeDebug = {
      schemaVersion: 12,
      generatedAt: new Date().toISOString(),
      input: inputDebug,
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
    };
    bearing = (bearing + 67) % 360;
  } catch (error) {
    if (error.code === "ROUTE_QUALITY") {
      routeDebug = {
        schemaVersion: 12,
        generatedAt: new Date().toISOString(),
        input: inputDebug,
        error: error.message,
      };
      routeSummary.hidden = true;
      bearing = (bearing + 67) % 360;
      drawPreview();
      showToast("No low-backtracking route found. Try again or choose another route shape.");
      return;
    }
    const fallback = loopPoints(
      start,
      requestedKm,
      routeBearing,
      selectedFavorites(),
      1,
      routeAlgorithm(),
    );
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
    $("#route-repeat-metric").hidden = true;
    $("#route-note").textContent = "Preview only—street routing is temporarily unavailable.";
    routeSummary.hidden = false;
    routeDebug = {
      schemaVersion: 12,
      generatedAt: new Date().toISOString(),
      input: inputDebug,
      error: error.message,
      fallbackCoordinates: fallback,
    };
    showToast("Street routing is unavailable, so this is an approximate loop.");
  } finally {
    makeRouteButton.disabled = false;
    makeRouteButton.querySelector("span").textContent = routeLine
      ? "Make another route"
      : "Try another route";
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
  rememberTarget(targetRange.value);
  drawPreview();
});
targetInput.addEventListener("input", () => {
  targetRange.value = targetInput.value;
  updateRangeFill();
  rememberTarget(targetInput.value);
  drawPreview();
});
document.querySelectorAll('input[name="pace"]').forEach((input) => {
  input.addEventListener("change", () => {
    savePreferences();
    drawPreview();
  });
});
document.querySelectorAll('input[name="route-algorithm"]').forEach((input) => {
  input.addEventListener("change", () => {
    savePreferences();
    clearRoute();
  });
});
$("#locate").addEventListener("click", locate);
$("#add-current-start").addEventListener("click", (event) =>
  requestLocation((latlng) => openPointForm(latlng, "start"), event.currentTarget),
);
$("#add-map-start").addEventListener("click", () => beginPin("start"));
$("#make-route").addEventListener("click", makeRoute);
$("#clear-route").addEventListener("click", clearRoute);
$("#copy-debug").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(routeDebug, null, 2));
    showToast("Debugging information copied.");
  } catch {
    showToast("Couldn’t copy debugging information.");
  }
});
$("#add-spot").addEventListener("click", () => beginPin("favorite"));
$("#cancel-point").addEventListener("click", endPointMode);
$("#center-point").addEventListener("click", () => openPointForm(map.getCenter()));
$(".point-form-close").addEventListener("click", endPointMode);
$("#place-search").addEventListener("submit", searchPlaces);

map.on("click", ({ latlng }) => {
  if (pinMode) openPointForm(latlng);
});

pointForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingPoint || !pointName.value.trim()) return;
  const point = {
    id: crypto.randomUUID(),
    name: pointName.value.trim(),
    lat: pendingPoint.lat,
    lng: pendingPoint.lng,
  };
  if (pinMode === "start") {
    starts.push(point);
    setStart(point);
    showToast("Starting point saved.");
  } else {
    favorites.push({ ...point, selected: true });
    saveFavorites();
    renderFavorites();
    drawPreview();
    showToast("Walk-by spot saved.");
  }
  endPointMode();
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

renderStarts();
renderFavorites();
document.querySelector(`input[name="route-algorithm"][value="${savedAlgorithm}"]`).checked = true;
document.querySelector(`input[name="pace"][value="${savedPace}"]`).checked = true;
setMode(mode);
setTimeout(() => map.invalidateSize(), 0);
