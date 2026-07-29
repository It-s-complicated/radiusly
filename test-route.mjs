import assert from "node:assert/strict";
import { loopPoints, pointAt, targetKilometers } from "./route.mjs";

assert.equal(targetKilometers("distance", 4, 5), 4);
assert.equal(targetKilometers("time", 60, 5), 5);
assert.equal(loopPoints([52.52, 13.4], 4).length, 5);
assert.ok(Math.abs(pointAt([0, 0], 1, 0)[0] - 0.009) < 0.001);
console.log("route checks passed");
