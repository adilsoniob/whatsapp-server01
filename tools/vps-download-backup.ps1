param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [string]$SshUser = "root",
  [string]$RemotePattern = "nightly-*",
  [string]$LocalDir = ".\vps-backups",
  [switch]$LatestOnly
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Comando nao encontrado: $name"
  }
}

Require-Command ssh
Require-Command scp

$remote = "$SshUser@$HostIp"
$localPath = Join-Path (Resolve-Path ".").Path $LocalDir
New-Item -ItemType Directory -Force -Path $localPath | Out-Null

if ($LatestOnly) {
  $remoteOutput = @(ssh $remote "ls -1dt /var/backups/painel-shortcode/$RemotePattern 2>/dev/null | head -n 1")
  $remoteFile = $null
  if ($remoteOutput.Count -gt 0) {
    $remoteFile = [string]($remoteOutput | Select-Object -Last 1)
    $remoteFile = $remoteFile.Trim()
  }
  if (-not $remoteFile) { throw "Nenhum backup encontrado para o padrao: $RemotePattern" }
  scp -r "$remote`:$remoteFile" "$localPath\"
  Write-Host "Backup baixado: $remoteFile"
  exit 0
}

scp -r "$remote`:/var/backups/painel-shortcode/$RemotePattern" "$localPath\"
Write-Host "Backups baixados em: $localPath"
