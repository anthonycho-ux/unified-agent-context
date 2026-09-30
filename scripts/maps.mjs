#!/usr/bin/env node
// Google Maps CLI for agents — resolve places, routes, distances, timezones.
// --remember stores the resolved result as a shared UAC fact so every agent
// inherits the place memory (scope global, fact_type project_state).
//
// Usage:
//   node scripts/maps.mjs geocode "address" [--remember]
//   node scripts/maps.mjs place "query" [--remember]
//   node scripts/maps.mjs route "origin" "dest" [--mode driving|walking|transit|bicycling] [--now] [--remember]
//   node scripts/maps.mjs matrix "A|B" "C|D" [--mode driving]
//   node scripts/maps.mjs tz <lat> <lng>
//
// Env: GOOGLE_MAPS_API_KEY (required)
import { geocode, placesSearch, directions, distanceMatrix, timezone } from '../src/maps.mjs';
import { recordFact } from '../src/recorder.mjs';

function parseFlags(argv) {
  const flags = { remember: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--remember') flags.remember = true;
    else if (argv[i] === '--now') flags.now = true;
    else if (argv[i] === '--mode') flags.mode = argv[++i];
    else rest.push(argv[i]);
  }
  return { flags, rest };
}

async function remember(statement) {
  const fact = await recordFact({
    statement,
    fact_type: 'project_state',
    scope: 'global',
    source_ref: 'cli:maps',
  });
  return fact.recorded;
}

function usage() {
  process.stderr.write(
    'usage: maps.mjs <geocode|place|route|matrix|tz> <args...> [--remember] [--mode <mode>] [--now]\n',
  );
  process.exit(1);
}

const { flags, rest } = parseFlags(process.argv.slice(2));
const cmd = rest[0];

try {
  switch (cmd) {
    case 'geocode': {
      const r = await geocode(rest.slice(1).join(' '));
      if (!r) { process.stdout.write('NO RESULTS\n'); break; }
      process.stdout.write(`${r.formattedAddress}  (${r.lat},${r.lng})  ${r.placeId}\n`);
      if (flags.remember) {
        const how = await remember(`Place "${rest.slice(1).join(' ')}" resolves to ${r.formattedAddress} (${r.lat},${r.lng}), place_id ${r.placeId}`);
        process.stdout.write(`REMEMBERED:${how}\n`);
      }
      break;
    }
    case 'place': {
      const results = await placesSearch(rest.slice(1).join(' '));
      for (const p of results.slice(0, 5)) {
        process.stdout.write(`${p.name}  —  ${p.address}  rating=${p.rating ?? '-'} open=${p.openNow ?? '-'}  ${p.placeId}\n`);
      }
      if (flags.remember && results[0]) {
        const p = results[0];
        const how = await remember(`Place "${rest.slice(1).join(' ')}" best match: ${p.name}, ${p.address} (rating ${p.rating ?? 'n/a'}, place_id ${p.placeId})`);
        process.stdout.write(`REMEMBERED:${how}\n`);
      }
      break;
    }
    case 'route': {
      const [origin, dest] = rest.slice(1);
      const r = await directions(origin, dest, { mode: flags.mode ?? 'driving', departureTime: flags.now ? 'now' : undefined });
      if (!r) { process.stdout.write('NO ROUTE\n'); break; }
      const traffic = r.durationInTrafficText ? ` (traffic: ${r.durationInTrafficText})` : '';
      process.stdout.write(`${r.distanceText}, ${r.durationText}${traffic} — ${r.summary ?? ''}\n`);
      if (flags.remember) {
        const how = await remember(`Route ${origin} → ${dest}: ${r.distanceText}, ${r.durationText}${traffic} (${r.summary ?? 'no summary'})`);
        process.stdout.write(`REMEMBERED:${how}\n`);
      }
      break;
    }
    case 'matrix': {
      const rows = await distanceMatrix(rest[1].split('|'), rest[2].split('|'), { mode: flags.mode ?? 'driving' });
      for (const row of rows) {
        process.stdout.write(row.map((e) => `${e.distanceText ?? '-'}/${e.durationText ?? '-'}${e.status !== 'OK' ? ` (${e.status})` : ''}`).join('  |  ') + '\n');
      }
      break;
    }
    case 'tz': {
      const r = await timezone(rest[1], rest[2]);
      process.stdout.write(r ? `${r.timeZoneId}  ${r.timeZoneName}\n` : 'NO TIMEZONE\n');
      break;
    }
    default:
      usage();
  }
} catch (error) {
  process.stderr.write(`[maps] ERROR: ${error.message}\n`);
  process.exit(1);
}
