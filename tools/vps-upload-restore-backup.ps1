param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [string]$SshUser = "root"
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Comando nao encontrado: $name"
  }
}

Require-Command ssh
Require-Command scp

$projectDir = (Resolve-Path ".").Path
$restoreScript = Join-Path $projectDir "tools\vps-restore-data.sh"
$backupPath = (Resolve-Path $BackupFile).Path

if (-not (Test-Path $restoreScript)) { throw "Arquivo nao encontrado: $restoreScript" }
if (-not (Test-Path $backupPath)) { throw "Backup nao encontrado: $backupPath" }

$remote = "$SshUser@$HostIp"
$remoteRestore = "/root/vps-restore-data.sh"
$remoteBackup = "/root/restore-data.tar.gz"

scp $restoreScript "$remote`:$remoteRestore"
scp $backupPath "$remote`:$remoteBackup"
ssh $remote "chmod +x $remoteRestore && sudo bash $remoteRestore $remoteBackup"

Write-Host "Restore enviado e executado na VPS."
