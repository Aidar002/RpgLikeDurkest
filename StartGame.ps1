$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 4173
$url = "http://127.0.0.1:$port"

function Test-GameUrl {
    param(
        [string]$TargetUrl
    )

    try {
        Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

Set-Location $projectRoot

if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
    npm install
}

if (-not (Test-GameUrl -TargetUrl $url)) {
    $command = "Set-Location '$projectRoot'; npm run dev -- --host 127.0.0.1 --port $port --strictPort"
    Start-Process powershell -ArgumentList @('-NoExit', '-Command', $command) | Out-Null

    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-GameUrl -TargetUrl $url) {
            break
        }
    }
}

Start-Process $url
