$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EngineRoot = Join-Path $ProjectRoot "grok-engine"
$RuntimeRoot = Join-Path $EngineRoot "runtime"
$VenvRoot = Join-Path $RuntimeRoot ".venv"
$VenvPython = Join-Path $VenvRoot "Scripts\python.exe"

function Resolve-Python {
    foreach ($candidate in @("python", "python3")) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        try {
            $version = & $command.Source -c "import sys; print(sys.version_info.major * 100 + sys.version_info.minor)"
            if ([int]$version -ge 310) { return $command.Source }
        } catch {}
    }
    $launcher = Get-Command "py" -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($minor in @("3.13", "3.12", "3.11", "3.10")) {
            try {
                $resolved = & $launcher.Source "-$minor" -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved.Trim() }
            } catch {}
        }
    }
    throw "Python 3.10 or newer was not found."
}

$BasePython = Resolve-Python
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

if (-not (Test-Path -LiteralPath $VenvPython)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
    Write-Host "[Grok 1/4] Creating the MercuryPro Grok virtual environment..."
    & $BasePython -m venv $VenvRoot
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Grok virtual environment." }
}

Write-Host "[Grok 2/4] Installing Grok registration dependencies..."
& $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $EngineRoot "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Failed to install Grok backend dependencies." }

Write-Host "[Grok 3/4] Installing local Turnstile Solver dependencies..."
& $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $EngineRoot "vendor\turnstile-solver\requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Failed to install Turnstile Solver dependencies." }

Write-Host "[Grok 4/4] Downloading the Camoufox fingerprint browser..."
& $VenvPython -m camoufox fetch
if ($LASTEXITCODE -ne 0) { throw "Failed to download the Camoufox browser runtime." }

Write-Host "MercuryPro Grok engine is ready: $VenvPython"
