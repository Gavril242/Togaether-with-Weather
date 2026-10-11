# Local image generation on Windows

This is an optional development setup for an AMD Radeon RX 9070 XT. Fourcast calls a local ComfyUI API at `127.0.0.1:8188`. Keep that address on loopback: ComfyUI is not an authenticated public service. The adapter is disabled in production mode; the reviewer setup uses the hosted Gemini provider described in the main README.

The workflow uses Stability AI SDXL Turbo in FP16 at 768 × 512, one image, and four sampling steps. This keeps the test small enough for the 9070 XT's 16 GiB of VRAM without enabling CPU offload. The SDXL Turbo community license is non-commercial; use it only for local evaluation unless your use is covered by its license. [Model and license](https://huggingface.co/stabilityai/sdxl-turbo).

## Install ComfyUI

Install the AMD graphics driver version required by the [AMD Windows compatibility table](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/windows/windows_compatibility.html). AMD's current Windows instructions use Python 3.12 and ROCm 7.2.1 PyTorch wheels. This installation stays under `.local`, which is ignored by Git.

From the repository root, in PowerShell:

```powershell
New-Item -ItemType Directory -Force .local | Out-Null
git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git .local/comfyui
py -3.12 -m venv .local/comfyui/.venv
$python = Resolve-Path .local/comfyui/.venv/Scripts/python.exe
& $python -m pip install --upgrade pip
& $python -m pip install --no-cache-dir `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm_sdk_core-7.2.1-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl `
  https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/rocm-7.2.1.tar.gz
& $python -m pip install --no-cache-dir `
  'https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/torch-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl' `
  'https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/torchaudio-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl' `
  'https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/torchvision-0.24.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl'
# Keep the AMD PyTorch wheels: ComfyUI's upstream requirements list torch and
# torchvision without ROCm-specific versions.
$requirements = Get-Content .local/comfyui/requirements.txt | Where-Object { $_ -notmatch '^(torch|torchvision)$' }
$requirementsFile = Join-Path (Resolve-Path .local/comfyui) 'requirements-rocm.txt'
[System.IO.File]::WriteAllLines($requirementsFile, [string[]]$requirements, [System.Text.UTF8Encoding]::new($false))
& $python -m pip install --no-cache-dir -r .local/comfyui/requirements-rocm.txt
& $python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

AMD documents Windows ROCm support for PyTorch; its entire ROCm stack is not supported on Windows. The last three lines should report a ROCm PyTorch build, `True`, and `AMD Radeon RX 9070 XT`. If they do not, stop here and check the AMD driver and versioned installation instructions; do not enable CPU offload to mask a driver problem.

Start ComfyUI once in checkpoint-install mode so its template browser can fetch the model. The helper confirms the AMD GPU and binds ComfyUI to loopback:

```powershell
.\scripts\start-local-comfyui.ps1 -InstallCheckpoint
```

Open <http://127.0.0.1:8188>, choose Templates, search for **SDXL Turbo**, and install its checkpoint. Fourcast expects `sd_xl_turbo_1.0_fp16.safetensors` in `.local/comfyui/models/checkpoints/`. If the template installs a differently named checkpoint, set `COMFYUI_CHECKPOINT` to that exact filename.

After the download completes, stop the server with Ctrl+C. Start it normally with `.\scripts\start-local-comfyui.ps1` and no `-InstallCheckpoint` flag. For a different checkpoint filename, pass `-CheckpointFile 'your-file.safetensors'` and set the same value for `COMFYUI_CHECKPOINT` in `.env.local`.

## Run Fourcast against ComfyUI

Copy `.env.example` to `.env.local` if you have not already done so. Set these server-side values in `.env.local`, then restart Next.js:

```dotenv
IMAGE_GENERATION_ENABLED=true
IMAGE_PROVIDER=comfyui
COMFYUI_API_URL=http://127.0.0.1:8188
COMFYUI_CHECKPOINT=sd_xl_turbo_1.0_fp16.safetensors
```

In another terminal, run `npm run dev -- --port 3100`, add four places, wait for their weather to load, and select **Generate image**. If ComfyUI is stopped or returns an invalid image, the dashboard shows a provider error and its weather cards remain usable. Image jobs that time out are not automatically resubmitted because ComfyUI may still finish the original local job.

For a quick provider check before opening the dashboard, ComfyUI exposes its queue API at `http://127.0.0.1:8188/queue`. Stop the model server with Ctrl+C when finished. Generated test images stay in ComfyUI's local output directory; Fourcast itself does not persist them.

AMD's setup and current package versions can change. Refer to its [ComfyUI guide](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/advanced/advancedrad/windows/comfyui/installcomfyui.html) and [PyTorch installation guide](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/install/installrad/windows/install-pytorch.html) if a package URL has been retired.
