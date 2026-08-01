import assert from "node:assert/strict";
import {
  compareRoutes,
  loopPoints,
  needsMoreCandidates,
  pathRepetition,
  pointAt,
  repeatedPathRatio,
  routeIsAcceptable,
  scoreRoute,
  stationRepeatedDistance,
  targetKilometers,
} from "./route.mjs";

assert.equal(targetKilometers("distance", 4, 5), 4);
assert.equal(targetKilometers("time", 60, 5), 5);
assert.equal(loopPoints([52.52, 13.4], 4).length, 5);
assert.equal(loopPoints([52.52, 13.4], 4, 25, [], 1, "tangent").length, 5);
const spaghettiStart = [52.52, 13.4];
const spaghetti = loopPoints(spaghettiStart, 4, 25, [], 1, "spaghetti");
assert.equal(spaghetti.length, 6);
assert.notDeepEqual(spaghetti[1], pointAt(spaghettiStart, (4 / 11.5) * 0.9, 25));
assert.deepEqual(
  [25, 92, 159].map(
    (bearing) => loopPoints(spaghettiStart, 4, bearing, [], 1, "spaghetti").length,
  ),
  [6, 6, 6],
);
assert.equal(loopPoints(spaghettiStart, 4, 25, [], 1, "spaghetti-cross").length, 5);
assert.equal(loopPoints(spaghettiStart, 4, 25, [], 1, "spaghetti-safe").length, 5);
const spaghettiSignatures = [25, 92, 159, 226].map((bearing) => {
  const points = loopPoints(spaghettiStart, 4, bearing, [], 1, "spaghetti");
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point[0] - points[index][0], (point[1] - points[index][1]) * 0.61),
  );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return lengths.map((length) => (length / total).toFixed(2)).join(",");
});
assert.ok(new Set(spaghettiSignatures).size > 2);
const orbitSame = loopPoints([52.52, 13.4], 4, 25, [], 1, "orbit-same");
const orbitNear = loopPoints([52.52, 13.4], 4, 25, [], 1, "orbit-near");
assert.deepEqual(orbitSame[1], orbitSame.at(-2));
assert.notDeepEqual(orbitNear[1], orbitNear.at(-2));
assert.ok(Math.abs(pointAt([0, 0], 1, 0)[0] - 0.009) < 0.001);
const outAndBack = [
  [13.4, 52.52],
  [13.41, 52.52],
  [13.4, 52.52],
];
assert.ok(repeatedPathRatio(outAndBack) > 0.49);
assert.ok(pathRepetition(outAndBack).longestRepeatDistance > 600);
const station = [{ coordinates: [13.405, 52.52] }];
assert.ok(stationRepeatedDistance(outAndBack, station) > 600);
assert.equal(stationRepeatedDistance(outAndBack.slice(0, 2), station), 0);
const repeatedRoute = scoreRoute(
  { distance: 4000, geometry: { coordinates: outAndBack } },
  4,
);
const cleanRoute = scoreRoute(
  {
    distance: 4800,
    geometry: { coordinates: [
      [13.4, 52.52],
      [13.41, 52.52],
      [13.41, 52.53],
    ] },
  },
  4,
);
assert.ok(compareRoutes(cleanRoute, repeatedRoute) < 0);
assert.equal(
  routeIsAcceptable({
    candidate: { algorithm: "organic" },
    distanceError: 0.026,
    repeatRatio: 0.186,
    longestRepeatDistance: 1919,
    stationRepeatDistance: 0,
  }),
  false,
);
assert.equal(
  routeIsAcceptable({
    candidate: { algorithm: "organic" },
    distanceError: 0.1,
    repeatRatio: 0.02,
    longestRepeatDistance: 100,
    stationRepeatDistance: 0,
  }),
  true,
);
assert.equal(
  routeIsAcceptable({
    candidate: { algorithm: "spaghetti-cross" },
    distanceError: 0.1,
    repeatRatio: 0.03,
    longestRepeatDistance: 250,
    stationRepeatDistance: 0,
  }),
  true,
);
assert.equal(
  needsMoreCandidates(
    {
      candidate: { algorithm: "orbit-same" },
      distanceError: 0.087,
      repeatRatio: 0.154,
      longestRepeatDistance: 951,
      stationRepeatDistance: 0,
    },
    "orbit-same",
  ),
  true,
);
assert.ok(
  compareRoutes(
    {
      candidate: { algorithm: "organic" },
      distanceError: 0.1,
      distanceErrorDistance: 100,
      repeatRatio: 0.1,
      repeatedDistance: 1200,
      longestRepeatDistance: 900,
      score: 1,
    },
    {
      candidate: { algorithm: "organic" },
      distanceError: 0.2,
      distanceErrorDistance: 200,
      repeatRatio: 0.1,
      repeatedDistance: 800,
      longestRepeatDistance: 700,
      score: 0.9,
    },
  ) > 0,
);
assert.ok(
  compareRoutes(
    {
      candidate: { algorithm: "organic" },
      distanceError: 0.1,
      distanceErrorDistance: 100,
      repeatRatio: 0.04,
      repeatedDistance: 500,
      longestRepeatDistance: 100,
      stationRepeatDistance: 80,
    },
    {
      candidate: { algorithm: "organic" },
      distanceError: 0.1,
      distanceErrorDistance: 100,
      repeatRatio: 0.04,
      repeatedDistance: 500,
      longestRepeatDistance: 100,
      stationRepeatDistance: 0,
    },
  ) > 0,
);
console.log("route checks passed");
