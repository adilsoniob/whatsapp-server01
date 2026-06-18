$ErrorActionPreference = "Stop"

$projectPath = "C:\xampp\htdocs\envio\painel-shortcode"
$outputDir = Join-Path $projectPath "ngrok-output"
$outputFile = Join-Path $outputDir "dominio-ngrok.txt"
$preferredDomain = "https://shortcode.ngrok.app"

Add-Type -AssemblyName System.Windows.Forms

if (!(Test-Path $projectPath)) {
    [System.Windows.Forms.MessageBox]::Show("Pasta do projeto nao encontrada:`n$projectPath", "Erro")
    exit 1
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Set-Location $projectPath

# Start app hidden
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start" -WindowStyle Hidden
Start-Sleep -Seconds 8

# Mata processos antigos do ngrok para evitar conflito
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

function Get-NgrokUrl {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 5
        return ($resp.tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1 -ExpandProperty public_url)
    }
    catch {
        return $null
    }
}

function Wait-NgrokUrl {
    param([int]$Attempts = 20, [int]$DelaySeconds = 2)

    for ($i = 0; $i -lt $Attempts; $i++) {
        $u = Get-NgrokUrl
        if ($u) { return $u }
        Start-Sleep -Seconds $DelaySeconds
    }

    return $null
}

$url = $null

# 1) Tenta subir com dominio fixo
Start-Process -FilePath "cmd.exe" -ArgumentList "/c ngrok http 3000 --url=$preferredDomain" -WindowStyle Hidden
$url = Wait-NgrokUrl -Attempts 20 -DelaySeconds 2

# 2) Fallback automatico se falhar
if (-not $url) {
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c ngrok http 3000" -WindowStyle Hidden
    $url = Wait-NgrokUrl -Attempts 20 -DelaySeconds 2
}

if (-not $url) {
    [System.Windows.Forms.MessageBox]::Show("Nao foi possivel obter o link do ngrok, nem com dominio fixo nem com fallback automatico.", "Aviso")
    exit 1
}

Set-Content -Path $outputFile -Value $url -Encoding UTF8
Set-Clipboard -Value $url
Start-Process $url

$msg = "Link ativo:`n`n$url`n`nCopiado para a area de transferencia e salvo em:`n$outputFile"
[System.Windows.Forms.MessageBox]::Show($msg, "Painel Shortcode")
