param(
  [string[]]$Engines = @('paddleocr', 'easyocr'),
  [string]$PrewarmLanguage = 'eng',
  [switch]$SkipPrewarm
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $root '.venv-ocr'
$pythonExe = Join-Path $venvPath 'Scripts\python.exe'
$bridgePath = Join-Path $root 'scripts\external_ocr_bridge.py'

function Invoke-CheckedExternal {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter()][object[]]$Arguments = @(),
    [Parameter(Mandatory = $true)][string]$Step
  )

  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "[ocr:bootstrap] $Step failed (exit code $LASTEXITCODE)"
  }
}

function Get-PythonRuntimeInfo {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter()][string[]]$PrefixArgs = @()
  )

  $probeCode = "import sys,struct; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'|'+str(struct.calcsize('P')*8))"
  $raw = & $Executable @PrefixArgs -c $probeCode
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  if ($raw -is [array]) {
    $raw = $raw[-1]
  }

  $value = "$raw".Trim()
  if (-not $value.Contains('|')) {
    return $null
  }

  $parts = $value.Split('|', 2)
  $version = $parts[0]
  $bits = 0
  [void][int]::TryParse($parts[1], [ref]$bits)

  return @{
    version = $version
    bits = $bits
  }
}

function Test-PaddleCompatiblePython {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][int]$Bits
  )

  $parts = $Version.Split('.', 2)
  if ($parts.Length -ne 2) {
    return $false
  }

  $major = 0
  $minor = 0
  if (-not [int]::TryParse($parts[0], [ref]$major)) {
    return $false
  }
  if (-not [int]::TryParse($parts[1], [ref]$minor)) {
    return $false
  }

  return ($major -eq 3 -and $minor -ge 8 -and $minor -le 12 -and $Bits -eq 64)
}

function Get-PythonCandidates {
  $candidates = @()

  if ($env:OCR_BOOTSTRAP_PYTHON) {
    $candidates += @{ label = 'OCR_BOOTSTRAP_PYTHON'; command = $env:OCR_BOOTSTRAP_PYTHON; prefixArgs = @() }
  }

  if (Get-Command py -ErrorAction SilentlyContinue) {
    $candidates += @{ label = 'py -3.12'; command = 'py'; prefixArgs = @('-3.12') }
    $candidates += @{ label = 'py -3.11'; command = 'py'; prefixArgs = @('-3.11') }
    $candidates += @{ label = 'py -3.10'; command = 'py'; prefixArgs = @('-3.10') }
    $candidates += @{ label = 'py -3.9'; command = 'py'; prefixArgs = @('-3.9') }
    $candidates += @{ label = 'py -3.8'; command = 'py'; prefixArgs = @('-3.8') }
  }

  if (Get-Command python -ErrorAction SilentlyContinue) {
    $candidates += @{ label = 'python'; command = 'python'; prefixArgs = @() }
  }

  return ,$candidates
}

function Install-PaddleStack {
  param([Parameter(Mandatory = $true)][string]$PythonPath)

  Write-Host '[ocr:bootstrap] Installing PaddleOCR stack'
  & $PythonPath -m pip install paddlepaddle paddleocr
  if ($LASTEXITCODE -eq 0) {
    return
  }

  Write-Warning '[ocr:bootstrap] Default PyPI install for paddlepaddle failed, retrying with official Paddle CPU index'
  & $PythonPath -m pip install paddlepaddle -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
  if ($LASTEXITCODE -ne 0) {
    throw '[ocr:bootstrap] Failed to install paddlepaddle. Ensure Python 3.8-3.12 (64-bit) is installed and network can reach paddlepaddle.org.cn.'
  }

  Invoke-CheckedExternal -Executable $PythonPath -Arguments @('-m', 'pip', 'install', 'paddleocr') -Step 'Installing paddleocr'
}

if ($Engines.Count -eq 0) {
  throw '[ocr:bootstrap] No OCR engines requested.'
}

$needsPaddle = $Engines -contains 'paddleocr'
$candidates = Get-PythonCandidates

if ($candidates.Count -eq 0) {
  throw '[ocr:bootstrap] No Python interpreter found. Install Python (and optionally py launcher) first.'
}

$candidateDiagnostics = @()
$selectedCandidate = $null
foreach ($candidate in $candidates) {
  $runtime = Get-PythonRuntimeInfo -Executable $candidate.command -PrefixArgs $candidate.prefixArgs
  if (-not $runtime) {
    $candidateDiagnostics += "$($candidate.label)=unavailable"
    continue
  }

  $candidateDiagnostics += "$($candidate.label)=Python $($runtime.version) ($($runtime.bits)-bit)"
  if ($needsPaddle) {
    if (Test-PaddleCompatiblePython -Version $runtime.version -Bits $runtime.bits) {
      $selectedCandidate = $candidate
      break
    }
  } else {
    $selectedCandidate = $candidate
    break
  }
}

if (-not $selectedCandidate) {
  $detected = if ($candidateDiagnostics.Count -gt 0) { $candidateDiagnostics -join '; ' } else { 'none' }
  if ($needsPaddle) {
    throw "[ocr:bootstrap] No compatible Python found for PaddleOCR. Need Python 3.8-3.12 (64-bit). Detected: $detected"
  }
  throw "[ocr:bootstrap] Unable to select a Python interpreter. Detected: $detected"
}

Write-Host "[ocr:bootstrap] Using interpreter: $($selectedCandidate.label)"

$shouldCreateVenv = -not (Test-Path $pythonExe)
if (-not $shouldCreateVenv) {
  $venvRuntime = Get-PythonRuntimeInfo -Executable $pythonExe
  if (-not $venvRuntime) {
    $shouldCreateVenv = $true
  } elseif ($needsPaddle -and -not (Test-PaddleCompatiblePython -Version $venvRuntime.version -Bits $venvRuntime.bits)) {
    Write-Warning "[ocr:bootstrap] Existing OCR virtualenv uses incompatible Python ($($venvRuntime.version), $($venvRuntime.bits)-bit). Recreating venv."
    $shouldCreateVenv = $true
  }
}

if ($shouldCreateVenv) {
  if (Test-Path $venvPath) {
    Remove-Item -LiteralPath $venvPath -Recurse -Force
  }

  Write-Host "[ocr:bootstrap] Creating virtualenv at $venvPath"
  Invoke-CheckedExternal -Executable $selectedCandidate.command -Arguments ($selectedCandidate.prefixArgs + @('-m', 'venv', $venvPath)) -Step 'Creating OCR virtualenv'
}

if (-not (Test-Path $pythonExe)) {
  throw "Failed to create OCR virtualenv: $pythonExe not found"
}

Write-Host "[ocr:bootstrap] Upgrading pip/setuptools/wheel"
Invoke-CheckedExternal -Executable $pythonExe -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel') -Step 'Upgrading pip/setuptools/wheel'

if ($Engines -contains 'paddleocr') {
  Install-PaddleStack -PythonPath $pythonExe
}

if ($Engines -contains 'easyocr') {
  Write-Host '[ocr:bootstrap] Installing EasyOCR stack'
  Invoke-CheckedExternal -Executable $pythonExe -Arguments @('-m', 'pip', 'install', 'easyocr') -Step 'Installing easyocr'
}

if (-not $SkipPrewarm) {
  if (-not (Test-Path $bridgePath)) {
    throw "Bridge script not found: $bridgePath"
  }

  if ($Engines -contains 'paddleocr') {
    Write-Host "[ocr:bootstrap] Prewarming PaddleOCR model(s) (language=$PrewarmLanguage)"
    Invoke-CheckedExternal -Executable $pythonExe -Arguments @($bridgePath, '--action', 'prewarm', '--engine', 'paddleocr', '--language', $PrewarmLanguage, '--pipeline-profile', 'panel') -Step 'Prewarming PaddleOCR'
  }

  if ($Engines -contains 'easyocr') {
    Write-Host "[ocr:bootstrap] Prewarming EasyOCR model(s) (language=$PrewarmLanguage)"
    Invoke-CheckedExternal -Executable $pythonExe -Arguments @($bridgePath, '--action', 'prewarm', '--engine', 'easyocr', '--language', $PrewarmLanguage, '--pipeline-profile', 'panel') -Step 'Prewarming EasyOCR'
  }
}

Write-Host '[ocr:bootstrap] OCR virtualenv ready'
Write-Host "[ocr:bootstrap] Electron bridge will auto-detect: $pythonExe"
