// Google Maps Platform client — thin fetch wrapper, no SDK dependency.
// Key comes from GOOGLE_MAPS_API_KEY (env) or an explicit apiKey option.
// Every function takes { fetchImpl } so tests can inject a fake — tests
// must never hit the network (repo rule).

const BASE = 'https://maps.googleapis.com/maps/api';

export class MapsConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapsConfigError';
  }
}

export class MapsApiError extends Error {
  constructor(status, message) {
    super(`Google Maps API ${status}${message ? `: ${message}` : ''}`);
    this.name = 'MapsApiError';
    this.status = status;
  }
}

function resolveKey(apiKey) {
  const key = apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new MapsConfigError(
      'GOOGLE_MAPS_API_KEY is not set — create a key in Google Cloud and export it (see docs/maps-api.md)',
    );
  }
  return key;
}

async function call(endpoint, params, { apiKey, fetchImpl } = {}) {
  const fetcher = fetchImpl ?? fetch;
  const url = new URL(`${BASE}${endpoint}`);
  url.searchParams.set('key', resolveKey(apiKey));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetcher(url);
  if (!res.ok) throw new MapsApiError(`HTTP_${res.status}`, `request to ${endpoint} failed`);
  const body = await res.json();
  if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
    throw new MapsApiError(body.status, body.error_message);
  }
  return body;
}

/** address string → { formattedAddress, lat, lng, placeId } | null */
export async function geocode(address, opts = {}) {
  const body = await call('/geocode/json', { address }, opts);
  const r = body.results?.[0];
  if (!r) return null;
  return {
    formattedAddress: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    placeId: r.place_id,
  };
}

/** (lat,lng) → formatted address string | null */
export async function reverseGeocode(lat, lng, opts = {}) {
  const body = await call('/geocode/json', { latlng: `${lat},${lng}` }, opts);
  return body.results?.[0]?.formatted_address ?? null;
}

/** origin → dest → { distanceText, durationText, durationInTrafficText?, summary } | null.
 * departureTime:'now' turns on traffic-aware duration for driving. */
export async function directions(origin, destination, { mode = 'driving', departureTime } = {}, opts = {}) {
  const body = await call('/directions/json', {
    origin,
    destination,
    mode,
    departure_time: departureTime === 'now' ? 'now' : undefined,
  }, opts);
  const leg = body.routes?.[0]?.legs?.[0];
  if (!leg) return null;
  return {
    summary: body.routes[0].summary,
    distanceText: leg.distance.text,
    durationText: leg.duration.text,
    durationInTrafficText: leg.duration_in_traffic?.text ?? null,
  };
}

/** free-text place query → [{ name, address, rating, openNow, placeId }] */
export async function placesSearch(query, opts = {}) {
  const body = await call('/place/textsearch/json', { query }, opts);
  return (body.results ?? []).map((r) => ({
    name: r.name,
    address: r.formatted_address,
    rating: r.rating ?? null,
    openNow: r.opening_hours?.open_now ?? null,
    placeId: r.place_id,
  }));
}

/** origins[] × destinations[] → matrix of { distanceText, durationText, status } */
export async function distanceMatrix(origins, destinations, { mode = 'driving' } = {}, opts = {}) {
  const body = await call('/distancematrix/json', {
    origins: origins.join('|'),
    destinations: destinations.join('|'),
    mode,
  }, opts);
  return (body.rows ?? []).map((row) =>
    (row.elements ?? []).map((e) => ({
      status: e.status,
      distanceText: e.distance?.text ?? null,
      durationText: e.duration?.text ?? null,
    })),
  );
}

/** (lat,lng) → { timeZoneId, timeZoneName } | null */
export async function timezone(lat, lng, opts = {}) {
  const body = await call('/timezone/json', {
    location: `${lat},${lng}`,
    timestamp: Math.floor(Date.now() / 1000),
  }, opts);
  if (!body.timeZoneId) return null;
  return { timeZoneId: body.timeZoneId, timeZoneName: body.timeZoneName };
}
