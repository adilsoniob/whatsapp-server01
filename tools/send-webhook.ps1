param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$ApiKey,
  [Parameter(Mandatory=$true)][string]$Phone,
  [Parameter(Mandatory=$true)][string]$Message,
  [int]$RotationLimit = 0
)

$body = @{
  phone = $Phone
  message = $Message
}

if ($RotationLimit -gt 0) {
  $body.rotationLimit = $RotationLimit
}

$json = $body | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri "$BaseUrl/api/webhook/send" `
  -Headers @{ "x-api-key" = $ApiKey } `
  -ContentType "application/json; charset=utf-8" `
  -Body $json

