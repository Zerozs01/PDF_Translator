const { spawnSync } = require('child_process');
const path = require('path');

if (process.env.SKIP_ELECTRON_REBUILD === '1') {
  console.log('[postinstall:electron] SKIP_ELECTRON_REBUILD=1, skipping native rebuild');
  process.exit(0);
}

const retryDelaysMs = [0, 1000, 2000, 4000];
const rebuildArgs = ['-f', '-w', 'better-sqlite3'];
const electronRebuildPackageJson = require.resolve('electron-rebuild/package.json');
const electronRebuildCli = path.resolve(
  path.dirname(electronRebuildPackageJson),
  require(electronRebuildPackageJson).bin['electron-rebuild']
);

function isLockError(result) {
  const stderr = `${result.stderr ?? ''}`.toLowerCase();
  const stdout = `${result.stdout ?? ''}`.toLowerCase();
  return [stderr, stdout].some((text) =>
    text.includes('eperm') ||
    text.includes('ebusy') ||
    text.includes('unlink') ||
    text.includes('better_sqlite3.node')
  );
}

function forwardCapturedOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  let lastResult = null;

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) {
      console.warn(`[postinstall:electron] Retrying native rebuild in ${retryDelaysMs[attempt]}ms (attempt ${attempt + 1}/${retryDelaysMs.length})`);
      await sleep(retryDelaysMs[attempt]);
    }

    lastResult = spawnSync(process.execPath, [electronRebuildCli, ...rebuildArgs], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env: process.env,
      encoding: 'utf8',
      shell: false,
    });

    forwardCapturedOutput(lastResult);

    if (!lastResult.error && lastResult.status === 0) {
      console.log('[postinstall:electron] Native rebuild completed');
      return 0;
    }

    if (lastResult.error && lastResult.error.code === 'ENOENT') {
      console.error('[postinstall:electron] electron-rebuild CLI could not be resolved');
      return 1;
    }

    if (!isLockError(lastResult)) {
      const exitCode = typeof lastResult.status === 'number' ? lastResult.status : 1;
      console.error('[postinstall:electron] Native rebuild failed');
      return exitCode;
    }

    console.warn('[postinstall:electron] Native rebuild hit a Windows file lock while updating better-sqlite3');
  }

  console.warn('[postinstall:electron] Native rebuild still hit a Windows file lock after retries. Skipping the rebuild so npm install can continue; rerun npm install after closing any Electron/Node process that may be holding better_sqlite3.node.');
  return 0;
}

run().then((exitCode) => process.exit(exitCode));