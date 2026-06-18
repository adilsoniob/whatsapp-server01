param(
  [Parameter(Mandatory = $true)][string]$HostIp,
  [string]$SshUser = "root",
  [string]$RemoteDir = "/root",
  [string]$EnvFile = ".\\.env.vps",
  [string]$Domain = "",
  [switch]$SkipRemoteBackup
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Comando nao encontrado: $name"
  }
}

Require-Command ssh
Require-Command scp
Require-Command tar

$projectDir = (Resolve-Path ".").Path
$tarPath = Join-Path $projectDir "painel-shortcode.tgz"
$bootstrapLocal = Join-Path $projectDir "tools\\vps-bootstrap.sh"
$backupLocal = Join-Path $projectDir "tools\\vps-backup.sh"

if (-not (Test-Path $bootstrapLocal)) { throw "Arquivo nao encontrado: $bootstrapLocal" }
if (-not (Test-Path $backupLocal)) { throw "Arquivo nao encontrado: $backupLocal" }
if (-not (Test-Path $EnvFile)) { throw "Crie o arquivo $EnvFile com as configs/contas da VPS (nao commit)." }

Write-Host "Empacotando projeto..."
if (Test-Path $tarPath) { Remove-Item -Force -LiteralPath $tarPath }

tar -czf $tarPath `
  --exclude=node_modules `
  --exclude=data `
  --exclude=ngrok-output `
  --exclude=.git `
  --exclude=.env `
  .

$remote = "$SshUser@$HostIp"
$remoteTar = "$RemoteDir/painel-shortcode.tgz"
$remoteBootstrap = "$RemoteDir/vps-bootstrap.sh"
$remoteBackupScript = "$RemoteDir/vps-backup.sh"
$remoteEnv = "$RemoteDir/painel-shortcode.env"

Write-Host "Enviando arquivos para $remote..."
scp $tarPath "$remote`:$remoteTar"
scp $bootstrapLocal "$remote`:$remoteBootstrap"
scp $backupLocal "$remote`:$remoteBackupScript"
scp $EnvFile "$remote`:$remoteEnv"

if (-not $SkipRemoteBackup) {
  Write-Host "Gerando backup remoto antes do deploy..."
  ssh $remote "chmod +x $remoteBackupScript && sudo bash $remoteBackupScript"
}

Write-Host "Executando bootstrap na VPS..."
if ($Domain) {
  ssh $remote "chmod +x $remoteBootstrap && sudo bash $remoteBootstrap --app-tar $remoteTar --env $remoteEnv --domain $Domain"
} else {
  ssh $remote "chmod +x $remoteBootstrap && sudo bash $remoteBootstrap --app-tar $remoteTar --env $remoteEnv"
}

if ($Domain) {
  Write-Host "Pronto. Acesse: https://$Domain/"
} else {
  Write-Host "Pronto. Acesse: http://$HostIp/"
}
Write-Host "Backups remotos: /var/backups/painel-shortcode"
