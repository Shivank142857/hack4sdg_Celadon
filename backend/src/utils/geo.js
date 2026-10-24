// Spherical approximation, sufficient for initial campus duplicate suggestions.
export const EARTH_RADIUS_METERS = 6_371_000;
export const DUPLICATE_RADIUS_METERS = 25;
const radians = (degrees) => degrees * Math.PI / 180;
const degrees = (angle) => angle * 180 / Math.PI;

export function assertCoordinates({ latitude, longitude }) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError('Invalid latitude or longitude.');
  }
}

export function haversineDistanceMeters(from, to) {
  assertCoordinates(from);
  assertCoordinates(to);
  const dLatitude = radians(to.latitude - from.latitude);
  const dLongitude = radians(to.longitude - from.longitude);
  const a = Math.sin(dLatitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude))
    * Math.sin(dLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

// Geographic prefilter only; every candidate still needs a Haversine check.
// Separate longitude ranges preserve matches across the antimeridian.
export function duplicateBoundingBox(location) {
  assertCoordinates(location);
  const angularRadius = DUPLICATE_RADIUS_METERS / EARTH_RADIUS_METERS;
  const latitudeDelta = degrees(angularRadius);
  const padding = 1e-10; // Conservative floating-point padding in degrees.
  const minLatitude = Math.max(-90, location.latitude - latitudeDelta - padding);
  const maxLatitude = Math.min(90, location.latitude + latitudeDelta + padding);
  let longitudeRanges;
  if (minLatitude <= -90 || maxLatitude >= 90) {
    longitudeRanges = [[-180, 180]];
  } else {
    const longitudeDelta = degrees(Math.asin(Math.min(1,
      Math.sin(angularRadius) / Math.cos(radians(location.latitude))))) + padding;
    const west = location.longitude - longitudeDelta;
    const east = location.longitude + longitudeDelta;
    if (west < -180) longitudeRanges = [[west + 360, 180], [-180, east]];
    else if (east > 180) longitudeRanges = [[west, 180], [-180, east - 360]];
    else longitudeRanges = [[west, east]];
  }
  return { minLatitude, maxLatitude, longitudeRanges };
}
