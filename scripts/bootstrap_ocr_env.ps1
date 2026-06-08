param(
  [string[]]$Engines = @('paddleocr', 'easyocr'),
  [string]$PrewarmLanguage = 'eng',
  [switch]$SkipPrewarm,
  [switch]$UseGPU
)

if ($env:OCR_USE_GPU -eq '1' -or $env:OCR_USE_ZLUDA -eq '1' -or $env:USE_ZLUDA -eq '1') {
  $UseGPU = $true
}

if (-not $UseGPU) {
  # Auto-detect GPU for Windows platform to maximize AMD/Intel/NVIDIA utilization out-of-the-box
  try {
    $gpus = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue
    if (-not $gpus) {
      $gpus = Get-WmiObject Win32_VideoController -ErrorAction SilentlyContinue
    }
    if ($gpus) {
      foreach ($gpu in $gpus) {
        $gpuName = "$($gpu.Name) $($gpu.Caption)".ToLower()
        if ($gpuName -like "*nvidia*" -or $gpuName -like "*amd*" -or $gpuName -like "*radeon*" -or $gpuName -like "*intel(r) iris*" -or $gpuName -like "*intel(r) arc*") {
          Write-Host "[ocr:bootstrap] Auto-detected GPU capable hardware: $($gpu.Name)"
          Write-Host '[ocr:bootstrap] Enabling GPU mode automatically to accelerate OCR performance.'
          $UseGPU = $true
          break
        }
      }
    }
  } catch {
    # Fail silently
  }
}

$ErrorActionPreference = 'Stop'

# Ensure $Engines is a proper array even if passed as a comma-separated string from CLI
if ($Engines -and $Engines.Count -eq 1 -and $Engines[0].Contains(',')) {
  $Engines = $Engines[0].Split(',').Trim()
}

$root = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $root '.venv-ocr'
$pythonExe = Join-Path $venvPath 'Scripts\python.exe'
$bridgePath = Join-Path $root 'scripts\external_ocr_bridge.py'

if (Test-Path $venvPath) {
  Write-Host '[ocr:bootstrap] Stopping python.exe instances running from .venv-ocr to prevent file lock...'
  Get-Process | Where-Object { $_.Path -like "*$venvPath*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

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

  return ($major -eq 3 -and $minor -ge 8 -and $minor -le 11 -and $Bits -eq 64)
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
  param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [switch]$UseGPU
  )

  # CRITICAL: PaddlePaddle <= 3.3 was built against numpy 1.x ABI.
  # Pin numpy<2 BEFORE installing paddle to avoid `_multiarray_umath` DLL load failures.
  Write-Host '[ocr:bootstrap] Pinning numpy<2 (Paddle ABI requirement)'
  Invoke-CheckedExternal -Executable $PythonPath -Arguments @('-m', 'pip', 'install', 'numpy<2') -Step 'Pinning numpy<2'

  if ($UseGPU) {
    Write-Host '[ocr:bootstrap] Uninstalling existing paddlepaddle packages'
    & $PythonPath -m pip uninstall -y paddlepaddle paddlepaddle-gpu | Out-Null

    # Clean up leftovers in site-packages to avoid CUDA dependencies conflict with Paddle DirectML
    $spPath = Join-Path $venvPath 'Lib\site-packages'
    foreach ($pkg in @('paddle', 'paddleocr', 'paddlepaddle', 'paddlepaddle-gpu')) {
      $pkgPath = Join-Path $spPath $pkg
      if (Test-Path $pkgPath) {
        Write-Host "[ocr:bootstrap] Cleaning up legacy package directory: $pkgPath"
        Remove-Item -LiteralPath $pkgPath -Recurse -Force -ErrorAction SilentlyContinue
      }
      Get-ChildItem -Path $spPath -Filter "$pkg-*.dist-info" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
      Get-ChildItem -Path $spPath -Filter "~$pkg*" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    # DirectML on Windows works best by using the standard CPU build of PaddlePaddle
    # combined with ONNX Runtime DirectML. For Nvidia GPUs, we use CUDA.
    $isNvidia = $false
    try {
      $gpus = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue
      if (-not $gpus) {
        $gpus = Get-WmiObject Win32_VideoController -ErrorAction SilentlyContinue
      }
      foreach ($gpu in $gpus) {
        if ("$($gpu.Name) $($gpu.Caption)".ToLower() -like "*nvidia*") {
          $isNvidia = $true
          break
        }
      }
    } catch {}

    if ($isNvidia) {
      Write-Host '[ocr:bootstrap] Installing GPU-enabled PaddlePaddle stack (CUDA)'
      & $PythonPath -m pip install paddlepaddle-gpu -i https://www.paddlepaddle.org.cn/packages/stable/gpu/
      if ($LASTEXITCODE -ne 0) {
        Write-Warning '[ocr:bootstrap] CUDA PaddlePaddle-GPU install failed. Falling back to CPU.'
        & $PythonPath -m pip install paddlepaddle -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
      }
    } else {
      Write-Host '[ocr:bootstrap] Installing GPU-enabled PaddlePaddle stack (DirectML via ONNX Runtime)'
      & $PythonPath -m pip install paddlepaddle -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
      if ($LASTEXITCODE -ne 0) {
        throw '[ocr:bootstrap] Failed to install paddlepaddle CPU base.'
      }
      Write-Host '[ocr:bootstrap] Installing paddle2onnx and onnxruntime-directml'
      & $PythonPath -m pip install paddle2onnx==1.3.1 onnxruntime-directml
      if ($LASTEXITCODE -ne 0) {
        Write-Warning '[ocr:bootstrap] DirectML package installation failed.'
      }
    }
  } else {
    Write-Host '[ocr:bootstrap] Installing PaddleOCR stack (CPU)'
    & $PythonPath -m pip install paddlepaddle 'paddleocr<=2.8.1'
    if ($LASTEXITCODE -eq 0) {
      # Re-pin in case paddleocr deps bumped numpy
      & $PythonPath -m pip install 'numpy<2' | Out-Null
      return
    }

    Write-Warning '[ocr:bootstrap] Default PyPI install for paddlepaddle failed, retrying with official Paddle CPU index'
    & $PythonPath -m pip install paddlepaddle -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
    if ($LASTEXITCODE -ne 0) {
      throw '[ocr:bootstrap] Failed to install paddlepaddle. Ensure Python 3.8-3.12 (64-bit) is installed and network can reach paddlepaddle.org.cn.'
    }
  }

  Invoke-CheckedExternal -Executable $PythonPath -Arguments @('-m', 'pip', 'install', 'paddleocr<=2.8.1') -Step 'Installing paddleocr'
  # Re-pin numpy<2 after dependency installs
  & $PythonPath -m pip install 'numpy<2' | Out-Null
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
  Install-PaddleStack -PythonPath $pythonExe -UseGPU:$UseGPU
}

if ($Engines -contains 'easyocr') {
  Write-Host '[ocr:bootstrap] Installing EasyOCR stack'
  if ($UseGPU) {
    Write-Host '[ocr:bootstrap] Uninstalling existing PyTorch packages'
    & $pythonExe -m pip uninstall -y torch torchvision torchaudio torch-directml | Out-Null

    # CRITICAL: Clean up leftovers in site-packages to avoid WinError 127 with legacy CUDA DLLs
    $spPath = Join-Path $venvPath 'Lib\site-packages'
    foreach ($pkg in @('torch', 'torchvision', 'torchaudio', 'torch_directml', 'torch-directml')) {
      $pkgPath = Join-Path $spPath $pkg
      if (Test-Path $pkgPath) {
        Write-Host "[ocr:bootstrap] Cleaning up legacy package directory: $pkgPath"
        Remove-Item -LiteralPath $pkgPath -Recurse -Force -ErrorAction SilentlyContinue
      }
      Get-ChildItem -Path $spPath -Filter "$pkg-*.dist-info" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
      Get-ChildItem -Path $spPath -Filter "~$pkg*" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host '[ocr:bootstrap] Installing CPU-based PyTorch (base for DirectML)'
    # NOTE: No --force-reinstall here — we already removed the torch folder manually above.
    # --force-reinstall would try to uninstall Pillow (a torchvision dep) which is locked by the running app.
    Invoke-CheckedExternal -Executable $pythonExe -Arguments @('-m', 'pip', 'install', 'torch==2.4.1', 'torchvision==0.19.1', '--index-url', 'https://download.pytorch.org/whl/cpu') -Step 'Installing PyTorch CPU Base'

    Write-Host '[ocr:bootstrap] Installing torch-directml'
    Invoke-CheckedExternal -Executable $pythonExe -Arguments @('-m', 'pip', 'install', 'torch-directml') -Step 'Installing torch-directml'

    $env:OCR_USE_DIRECTML = '1'
  }
  Invoke-CheckedExternal -Executable $pythonExe -Arguments @('-m', 'pip', 'install', 'easyocr') -Step 'Installing easyocr'
}

Write-Host '[ocr:bootstrap] Enforcing final numpy<2 downgrade for PaddleOCR/EasyOCR compatibility'
Get-Process | Where-Object { $_.Path -like "*$venvPath*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Invoke-CheckedExternal -Executable $pythonExe -Arguments @('-m', 'pip', 'install', 'numpy<2') -Step 'Enforcing final numpy<2'

if (-not $SkipPrewarm) {
  if (-not (Test-Path $bridgePath)) {
    throw "Bridge script not found: $bridgePath"
  }

  $execCmd = $pythonExe
  $execArgs = @()
  if ($UseGPU -and ($env:OCR_USE_ZLUDA -eq '1' -or $env:USE_ZLUDA -eq '1')) {
    $zludaPath = if ($env:ZLUDA_PATH) { $env:ZLUDA_PATH } else { 'zluda.exe' }
    $execCmd = $zludaPath
    $execArgs = @('--', $pythonExe)
    Write-Host "[ocr:bootstrap] Running prewarm under ZLUDA ($zludaPath)"
  }

  if ($Engines -contains 'paddleocr') {
    Write-Host "[ocr:bootstrap] Prewarming PaddleOCR model(s) (language=$PrewarmLanguage)"
    Invoke-CheckedExternal -Executable $execCmd -Arguments ($execArgs + @($bridgePath, '--action', 'prewarm', '--engine', 'paddleocr', '--language', $PrewarmLanguage, '--pipeline-profile', 'panel')) -Step 'Prewarming PaddleOCR'
  }

  if ($Engines -contains 'easyocr') {
    Write-Host "[ocr:bootstrap] Prewarming EasyOCR model(s) (language=$PrewarmLanguage)"
    Invoke-CheckedExternal -Executable $execCmd -Arguments ($execArgs + @($bridgePath, '--action', 'prewarm', '--engine', 'easyocr', '--language', $PrewarmLanguage, '--pipeline-profile', 'panel')) -Step 'Prewarming EasyOCR'
  }
}

Write-Host '[ocr:bootstrap] OCR virtualenv ready'
Write-Host "[ocr:bootstrap] Electron bridge will auto-detect: $pythonExe"
