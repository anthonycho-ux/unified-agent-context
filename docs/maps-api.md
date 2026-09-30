# Google Maps API integration

**Why this exists (fit):** UAC is a shared memory store for agents. Maps data is a
natural category of shared fact — "where is X", "how long is the commute" — that
every agent should resolve once and inherit, instead of each agent re-geocoding
or guessing addresses. This module provides the resolution layer; `--remember`
persists results into the store so they survive sessions.

## Setup

1. Create a key in Google Cloud Console, enable: **Geocoding, Directions,
   Distance Matrix, Places (Text Search), Time Zone**.
2. `export GOOGLE_MAPS_API_KEY=...` (shell profile or `.env` sourced by agents).

No npm dependency — the client is a thin `fetch` wrapper (`src/maps.mjs`).

## CLI (`scripts/maps.mjs`)

```bash
node scripts/maps.mjs geocode "110 Sejong-daero, Seoul" --remember
node scripts/maps.mjs place "good coffee near gangnam" --remember
node scripts/maps.mjs route "home" "office" --mode driving --now   # traffic-aware
node scripts/maps.mjs matrix "home|work" "airport|downtown"
node scripts/maps.mjs tz 37.5663 126.9779
```

`--remember` writes a `project_state` fact at `global` scope via
`recordFact` — dedupe/correction semantics are inherited for free, and the
secret gate still applies to stored statements.

## Use cases this unlocks

- **Place memory:** agents resolve "that restaurant" to a canonical
  address/place_id once; later sessions read it from the store.
- **Commute awareness:** a scheduled job runs `route --now` and notifies on
  traffic anomalies.
- **Timezone correctness:** scheduled agents resolve the right local zone for
  remembered places (`tz`).

## Testing

`tests/maps.test.mjs` injects a fake `fetch` — tests never hit the network,
consistent with the repo's no-SSH/no-network test rule.
