#!/usr/bin/env node
// Session-start context injector CLI.
// Usage: node scripts/inject-context.mjs [--scope project:<id>|global] [--cwd <dir>]
// Prints the shared-context block to stdout. Degraded mode: warning on stderr,
// exit 0 (harnesses must not crash) unless UAC_STRICT=1 (exit 2).
import { getInjectionBlock, InjectorDegradedError } from '../src/injector.mjs';

function parseArgs(argv) {
  const args = { cwd: process.cwd(), scope: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scope') args.scope = argv[++i];
    else if (argv[i] === '--cwd') args.cwd = argv[++i];
  }
  return args;
}

const { cwd, scope } = parseArgs(process.argv.slice(2));

try {
  const result = await getInjectionBlock({ cwd, scope });
  if (!result.degraded && result.block) {
    process.stdout.write(result.block + '\n');
  }
  process.exit(0);
} catch (error) {
  if (error instanceof InjectorDegradedError) {
    process.exit(2);
  }
  process.stderr.write(`[uac-injector] ERROR: ${error?.message ?? error}\n`);
  process.exit(process.env.UAC_STRICT === '1' ? 2 : 0);
}
