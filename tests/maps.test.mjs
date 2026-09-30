import assert from 'node:assert/strict';
import test from 'node:test';

import { geocode, directions, placesSearch, timezone, MapsConfigError, MapsApiError } from '../src/maps.mjs';

function fakeFetch(body, { ok = true, status = 200, capture } = {}) {
  return async (url) => {
    if (capture) capture.url = url.toString();
    return { ok, status, json: async () => body };
  };
}

test('geocode: parses first result', async () => {
  const r = await geocode('Seoul City Hall', {
    apiKey: 'k',
    fetchImpl: fakeFetch({
      status: 'OK',
      results: [{
        formatted_address: '110 Sejong-daero, Jung-gu, Seoul',
        geometry: { location: { lat: 37.5663, lng: 126.9779 } },
        place_id: 'ChIJabc',
      }],
    }),
  });
  assert.deepEqual(r, {
    formattedAddress: '110 Sejong-daero, Jung-gu, Seoul',
    lat: 37.5663,
    lng: 126.9779,
    placeId: 'ChIJabc',
  });
});

test('geocode: ZERO_RESULTS → null', async () => {
  const r = await geocode('nowhere', { apiKey: 'k', fetchImpl: fakeFetch({ status: 'ZERO_RESULTS', results: [] }) });
  assert.equal(r, null);
});

test('api key: appended to URL, env fallback respected', async () => {
  const capture = {};
  await geocode('x', { apiKey: 'MYKEY', fetchImpl: fakeFetch({ status: 'OK', results: [] }, { capture }) });
  assert.ok(capture.url.includes('key=MYKEY'));
});

test('api key: missing key throws MapsConfigError before any fetch', async () => {
  const prev = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  try {
    let fetched = false;
    await assert.rejects(
      geocode('x', { fetchImpl: async () => { fetched = true; return { ok: true, json: async () => ({}) }; } }),
      MapsConfigError,
    );
    assert.equal(fetched, false);
  } finally {
    if (prev !== undefined) process.env.GOOGLE_MAPS_API_KEY = prev;
  }
});

test('api error: non-OK status throws MapsApiError with message', async () => {
  await assert.rejects(
    geocode('x', { apiKey: 'k', fetchImpl: fakeFetch({ status: 'REQUEST_DENIED', error_message: 'bad key' }) }),
    (e) => e instanceof MapsApiError && e.message.includes('REQUEST_DENIED') && e.message.includes('bad key'),
  );
});

test('api error: HTTP failure throws MapsApiError', async () => {
  await assert.rejects(
    geocode('x', { apiKey: 'k', fetchImpl: fakeFetch({}, { ok: false, status: 500 }) }),
    MapsApiError,
  );
});

test('directions: returns leg summary and traffic duration when present', async () => {
  const r = await directions('A', 'B', { departureTime: 'now' }, {
    apiKey: 'k',
    fetchImpl: fakeFetch({
      status: 'OK',
      routes: [{
        summary: 'I-25 S',
        legs: [{
          distance: { text: '12.4 km' },
          duration: { text: '18 mins' },
          duration_in_traffic: { text: '25 mins' },
        }],
      }],
    }),
  });
  assert.equal(r.distanceText, '12.4 km');
  assert.equal(r.durationText, '18 mins');
  assert.equal(r.durationInTrafficText, '25 mins');
  assert.equal(r.summary, 'I-25 S');
});

test('directions: departureTime=now is forwarded to the API', async () => {
  const capture = {};
  await directions('A', 'B', { departureTime: 'now' }, {
    apiKey: 'k',
    fetchImpl: fakeFetch({ status: 'ZERO_RESULTS', routes: [] }, { capture }),
  });
  assert.ok(capture.url.includes('departure_time=now'));
});

test('placesSearch: maps results to compact shape', async () => {
  const out = await placesSearch('coffee', {
    apiKey: 'k',
    fetchImpl: fakeFetch({
      status: 'OK',
      results: [{
        name: 'Cafe X',
        formatted_address: '1 Main St',
        rating: 4.5,
        opening_hours: { open_now: true },
        place_id: 'p1',
      }],
    }),
  });
  assert.deepEqual(out[0], { name: 'Cafe X', address: '1 Main St', rating: 4.5, openNow: true, placeId: 'p1' });
});

test('timezone: returns id and name', async () => {
  const r = await timezone(37.5, 127, {
    apiKey: 'k',
    fetchImpl: fakeFetch({ status: 'OK', timeZoneId: 'Asia/Seoul', timeZoneName: 'Korea Standard Time' }),
  });
  assert.deepEqual(r, { timeZoneId: 'Asia/Seoul', timeZoneName: 'Korea Standard Time' });
});
