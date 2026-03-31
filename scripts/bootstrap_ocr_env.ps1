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

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw 'python is not available on PATH'
}

if (-not (Test-Path $pythonExe)) {
  Write-Host "[ocr:bootstrap] Creating virtualenv at $venvPath"
  python -m venv $venvPath
}

if (-not (Test-Path $pythonExe)) {
  throw "Failed to create OCR virtualenv: $pythonExe not found"
}

Write-Host "[ocr:bootstrap] Upgrading pip/setuptools/wheel"
& $pythonExe -m pip install --upgrade pip setuptools wheel

if ($Engines -contains 'paddleocr') {
  Write-Host '[ocr:bootstrap] Installing PaddleOCR stack'
  & $pythonExe -m pip install paddlepaddle paddleocr
}

if ($Engines -contains 'easyocr') {
  Write-Host '[ocr:bootstrap] Installing EasyOCR stack'
  & $pythonExe -m pip install easyocr
}

if (-not $SkipPrewarm) {
  if (-not (Test-Path $bridgePath)) {
    throw "Bridge script not found: $bridgePath"
  }

  if ($Engines -contains 'paddleocr') {
    Write-Host "[ocr:bootstrap] Prewarming PaddleOCR model(s) (language=$PrewarmLanguage)"
    & $pythonExe $bridgePath --action prewarm --engine paddleocr --language $PrewarmLanguage --pipeline-profile panel
  }

  if ($Engines -contains 'easyocr') {
    Write-Host "[ocr:bootstrap] Prewarming EasyOCR model(s) (language=$PrewarmLanguage)"
    & $pythonExe $bridgePath --action prewarm --engine easyocr --language $PrewarmLanguage --pipeline-profile panel
  }
}

Write-Host '[ocr:bootstrap] OCR virtualenv ready'
Write-Host "[ocr:bootstrap] Electron bridge will auto-detect: $pythonExe"
