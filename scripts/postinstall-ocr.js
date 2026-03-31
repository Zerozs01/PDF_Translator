const { spawnSync } = require('child_process');
const path = require('path');

if (process.env.SKIP_OCR_BOOTSTRAP === '1') {
  console.log('[postinstall:ocr] SKIP_OCR_BOOTSTRAP=1, skipping OCR bootstrap');
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.log('[postinstall:ocr] Non-Windows platform detected, skipping PowerShell OCR bootstrap');
  process.exit(0);
}

const scriptPath = path.join(__dirname, 'bootstrap_ocr_env.ps1');
const shellCandidates = ['powershell.exe', 'pwsh.exe', 'pwsh', 'powershell'];

let attempted = 0;
for (const shell of shellCandidates) {
  attempted += 1;
  const result = spawnSync(
    shell,
    ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
      shell: false,
    }
  );

  if (!result.error && result.status === 0) {
    console.log(`[postinstall:ocr] OCR bootstrap completed via ${shell}`);
    process.exit(0);
  }

  if (result.error && result.error.code === 'ENOENT') {
    continue;
  }

  const exitCode = typeof result.status === 'number' ? result.status : 1;
  console.error(`[postinstall:ocr] OCR bootstrap failed via ${shell}`);
  process.exit(exitCode);
}

if (attempted > 0) {
  console.error('[postinstall:ocr] No PowerShell executable found (powershell.exe/pwsh.exe).');
}
console.error('[postinstall:ocr] Install PowerShell and Python, or set SKIP_OCR_BOOTSTRAP=1 to bypass.');
process.exit(1);
