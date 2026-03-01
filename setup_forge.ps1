$ProgressPreference = 'SilentlyContinue'

Write-Host "=========================================="
Write-Host "Installing Local AI (Forge) for RTX 4060"
Write-Host "This will take about 15-30 minutes (downloading ~8 GB)."
Write-Host "Please DO NOT close this window!"
Write-Host "=========================================="

$forgeUrl = "https://github.com/lllyasviel/stable-diffusion-webui-forge/releases/download/latest/WebUI_Forge_cu121_torch231.7z"
$forgeArchive = "WebUI_Forge_cu121_torch231.7z"
$forgeDir = "Forge"

$modelUrl = "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors"
$modelFile = "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors"

if (-Not (Test-Path $forgeArchive)) {
    Write-Host "1/5 Downloading SD WebUI Forge package (1.7 GB)..."
    curl.exe -L -o $forgeArchive $forgeUrl
}
else {
    Write-Host "1/5 Forge package already downloaded."
}

if (-Not (Test-Path $forgeDir)) {
    Write-Host "2/5 Extracting Forge (this might take a few minutes)..."
    New-Item -ItemType Directory -Force -Path $forgeDir | Out-Null
    tar.exe -xf $forgeArchive -C $forgeDir
}
else {
    Write-Host "2/5 Forge folder already exists."
}

$modelDestDir = Join-Path $forgeDir "webui\models\Stable-diffusion"
$modelDestPath = Join-Path $modelDestDir $modelFile

if (-Not (Test-Path $modelDestDir)) {
    New-Item -ItemType Directory -Force -Path $modelDestDir | Out-Null
}

if (-Not (Test-Path $modelDestPath)) {
    Write-Host "3/5 Downloading Juggernaut XL Lightning model (6.6 GB)..."
    Write-Host "Please wait, this will take a while."
    curl.exe -L -o $modelDestPath $modelUrl
}
else {
    Write-Host "3/5 Model already downloaded."
}

Write-Host "4/5 Configuring API startup..."
$batPath = Join-Path $forgeDir "webui\webui-user.bat"
if (Test-Path $batPath) {
    $batContent = Get-Content $batPath
    $newBatContent = $batContent -replace 'set COMMANDLINE_ARGS=.*', 'set COMMANDLINE_ARGS=--api'
    if ($newBatContent -notmatch '--api') {
        $newBatContent += "`nset COMMANDLINE_ARGS=--api"
    }
    Set-Content -Path $batPath -Value $newBatContent
}
else {
    Write-Host "Warning: webui-user.bat not found."
}

Write-Host "5/5 Done!"
Write-Host "--------------------------------------------------------"
Write-Host "To start the local image server:"
Write-Host "1) Open folder $forgeDir\webui\"
Write-Host "2) First run: double-click update.bat, then run.bat"
Write-Host "3) Future runs: just double-click webui-user.bat"
Write-Host "Once 'API is ready' appears in the console, the game will connect to it."
Write-Host "--------------------------------------------------------"
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
