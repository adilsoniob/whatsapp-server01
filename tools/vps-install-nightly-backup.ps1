param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [string]$SshUser = "root",
  [int]$Hour = 23,
  [int]$Minute = 30
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
$backupScript = Join-Path $projectDir "tools\vps-backup-data.sh"
$installScript = Join-Path $projectDir "tools\vps-install-nightly-backup.sh"

if (-not (Test-Path $backupScript)) { throw "Arquivo nao encontrado: $backupScript" }
if (-not (Test-Path $installScript)) { throw "Arquivo nao encontrado: $installScript" }

$remote = "$SshUser@$HostIp"

scp $backupScript "$remote`:/root/vps-backup-data.sh"
scp $installScript "$remote`:/root/vps-install-nightly-backup.sh"
ssh $remote "chmod +x /root/vps-backup-data.sh /root/vps-install-nightly-backup.sh && sudo bash /root/vps-install-nightly-backup.sh $Hour $Minute"

Write-Host "Backup noturno configurado para ${Hour}:$('{0:D2}' -f $Minute) na VPS."
