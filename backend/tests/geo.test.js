import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplicateBoundingBox, DUPLICATE_RADIUS_METERS, haversineDistanceMeters } from '../src/utils/geo.js';

// Synthetic global geometry fixtures; none are campus coordinates.
test('campus pilot duplicate radius is 25 metres', () => {
  assert.equal(DUPLICATE_RADIUS_METERS, 25);
});

test('Haversine gives zero for identical points and a known one-degree equatorial distance', () => {
  assert.equal(haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
  const distance = haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
  assert.ok(Math.abs(distance - 111194.9266) < 0.001);
});

test('Haversine is symmetric and finite at antipodes', () => {
  const a = { latitude: 30, longitude: -40 };
  const b = { latitude: -30, longitude: 140 };
  const distance = haversineDistanceMeters(a, b);
  assert.ok(Number.isFinite(distance));
  assert.equal(distance, haversineDistanceMeters(b, a));
});

test('bounding box encloses the location and is narrow away from poles', () => {
  const bounds = duplicateBoundingBox({ latitude: 0, longitude: 0 });
  assert.ok(bounds.minLatitude < 0 && bounds.maxLatitude > 0);
  assert.ok(bounds.maxLatitude - bounds.minLatitude < 0.001);
  assert.equal(bounds.longitudeRanges.length, 1);
  assert.ok(bounds.longitudeRanges[0][0] < 0 && bounds.longitudeRanges[0][1] > 0);
});

test('bounding box splits on either side of the antimeridian', () => {
  for (const longitude of [-180, -179.99999, 179.99999, 180]) {
    const { longitudeRanges } = duplicateBoundingBox({ latitude: 0, longitude });
    assert.equal(longitudeRanges.length, 2);
    for (const [west, east] of longitudeRanges) assert.ok(west >= -180 && east <= 180 && west <= east);
  }
});

test('bounding box permits all longitudes when the radius contains a pole', () => {
  for (const latitude of [-90, -89.99999, 89.99999, 90]) {
    const bounds = duplicateBoundingBox({ latitude, longitude: 120 });
    assert.ok(bounds.minLatitude >= -90 && bounds.maxLatitude <= 90);
    assert.deepEqual(bounds.longitudeRanges, [[-180, 180]]);
  }
});

test('geographic utilities reject invalid coordinates', () => {
  const origin = { latitude: 0, longitude: 0 };
  for (const location of [
    { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 },
    { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
    { latitude: '0', longitude: 0 },
  ]) {
    assert.throws(() => duplicateBoundingBox(location), RangeError);
    assert.throws(() => haversineDistanceMeters(origin, location), RangeError);
  }
});
