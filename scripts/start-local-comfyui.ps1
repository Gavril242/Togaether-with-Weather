param(
  [ValidatePattern('^[A-Za-z0-9_.-]+\.safetensors$')]
  [string]$CheckpointFile = 'sd_xl_turbo_1.0_fp16.safetensors',
  [switch]$InstallCheckpoint
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$comfyRoot = Join-Path $repositoryRoot '.local\comfyui'
$python = Join-Path $comfyRoot '.venv\Scripts\python.exe'
$checkpoint = Join-Path $comfyRoot "models\checkpoints\$CheckpointFile"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw 'ComfyUI is not installed in .local. Follow docs/LOCAL_IMAGE_GENERATION.md first.'
}
if (-not (Test-Path -LiteralPath $checkpoint -PathType Leaf)) {
  if ($InstallCheckpoint) {
    Write-Output 'Install the SDXL Turbo checkpoint from ComfyUI Templates, then stop this first run and restart without -InstallCheckpoint.'
  } else {
    throw "The selected checkpoint is missing: .local/comfyui/models/checkpoints/$CheckpointFile"
  }
}

& $python -c "import torch; print(torch.__version__); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No ROCm GPU detected'); raise SystemExit(0 if torch.cuda.is_available() else 1)"
if ($LASTEXITCODE -ne 0) {
  throw 'The isolated PyTorch runtime cannot see an AMD GPU. Check the ROCm and driver setup before starting ComfyUI.'
}

Push-Location -LiteralPath $comfyRoot
try {
  & $python main.py --listen 127.0.0.1 --port 8188
  if ($LASTEXITCODE -ne 0) { throw "ComfyUI exited with status $LASTEXITCODE." }
}
finally {
  Pop-Location
}
