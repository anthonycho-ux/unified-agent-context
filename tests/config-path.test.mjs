import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..');

test('configured store entry is absolute outside the repository cwd', async () => {
  const env = { ...process.env };
  delete env.UAC_DATA_DIR;
  delete env.UAC_SERVER_ENTRY;
  delete env.UAC_REMOTE;
  delete env.UAC_STORE_HOST;

  const script = [
    `import { SERVER_SPECS } from ${JSON.stringify(path.join(repoRoot, 'src/config.mjs'))};`,
    'const spec = SERVER_SPECS[0];',
    // 바이너리 스펙은 command가 entry 자체, JS 스펙은 args[0]이 entry 경로.
    'process.stdout.write(spec.binary ? spec.command : spec.args[0]);',
  ].join('\n');
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: os.tmpdir(),
    env,
  });

  assert.ok(path.isAbsolute(stdout), `entry must resolve absolute outside repo cwd, got: ${stdout}`);
  assert.match(stdout, /uac-store$|mcp-memory-keeper\/dist\/index\.js$/);
});
