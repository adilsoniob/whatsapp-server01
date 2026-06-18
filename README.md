# SMS Account Rotator

Sistema local para enfileirar SMS e alternar automaticamente entre contas autorizadas a cada X envios bem-sucedidos.

## O que ja esta pronto

- Painel web em `http://localhost:3000`.
- Fila de SMS com envio individual ou em lote.
- Rotacao entre contas a cada `SMS_ROTATION_LIMIT` envios.
- Logs em `data/sms-log.jsonl`.
- Estado da rotacao em `data/rotation-state.json`.
- Modo `mock` para testar sem gastar SMS.
- Modo `api` preparado para conectar na API oficial do provedor.
- Modo `smpp` preparado para conexao direta com gateway SMPP.
- Modo `panel` para login no painel web e envio pelo endpoint interno do site.

## Como rodar

1. Confira se o Node.js 18+ esta instalado:

```powershell
node -v
```

2. Preencha o arquivo `.env` com as contas reais apenas no seu computador.

3. Instale as dependencias se for usar SMPP:

```powershell
npm install
```

4. Inicie o sistema:

```powershell
npm start
```

5. Abra:

```text
http://localhost:3000
```

Observacao:
- Por padrao o servidor escuta em `127.0.0.1` (apenas na propria maquina). Para expor na rede local, use `HOST=0.0.0.0` no `.env`.

## Painel administrativo (usuarios)

Agora o sistema tem autenticacao local com:

- `http://localhost:3000/setup`: cria o primeiro admin (somente se ainda nao existir nenhum usuario).
- `http://localhost:3000/login`: login.
- `http://localhost:3000/app`: pagina do usuario (somente lista de numeros + mensagem).
- `http://localhost:3000/admin`: painel do admin (criar usuarios e vincular contas).
- `http://localhost:3000/admin/monitor`: tela completa com monitor e selecao de contas (admin).

## Configuracao das contas

No `.env`, use este formato:

```env
SMS_ROTATION_LIMIT=10
SMS_PROVIDER_MODE=mock

SMS_ACCOUNT_1=conta_aqui
SMS_PASSWORD_1=senha_aqui
SMS_ACCOUNT_2=conta_aqui
SMS_PASSWORD_2=senha_aqui
```

Quando `SMS_ROTATION_LIMIT=10`, a conta atual envia 10 SMS com sucesso e depois o sistema passa para a proxima conta configurada.

Para SMPP, `SMS_ACCOUNT_N` normalmente corresponde ao `system_id` e `SMS_PASSWORD_N` corresponde a senha de bind dessa conta.

Se a senha do painel e a senha SMPP forem diferentes, mantenha `SMS_PASSWORD_N` para o painel e preencha `SMS_SMPP_PASSWORD_N` com a senha de bind SMPP. Quando `SMS_PROVIDER_MODE=smpp`, o sistema usa `SMS_SMPP_PASSWORD_N`.

## Conectando a API real

Quando voce tiver a documentacao da Topying/MSG, altere:

```env
SMS_PROVIDER_MODE=api
SMS_API_URL=https://endpoint-oficial-aqui
SMS_API_METHOD=POST
SMS_API_AUTH_MODE=body
SMS_API_ACCOUNT_FIELD=account
SMS_API_PASSWORD_FIELD=password
SMS_API_PHONE_FIELD=phone
SMS_API_MESSAGE_FIELD=message
SMS_API_SUCCESS_PATH=
```

Campos importantes:

- `SMS_API_URL`: endpoint oficial de envio de SMS.
- `SMS_API_AUTH_MODE`: use `body` se a API pede conta/senha no JSON; use `basic` se usa HTTP Basic Auth.
- `SMS_API_*_FIELD`: nomes dos campos esperados pela API.
- `SMS_API_SUCCESS_PATH`: caminho no JSON que indica sucesso, por exemplo `success` ou `data.accepted`. Se ficar vazio, qualquer HTTP 2xx conta como sucesso.

## Conectando via SMPP

Use este modo quando o provedor entregar dados de conexao SMPP, como host, porta, system id e senha.

No `.env`:

```env
SMS_PROVIDER_MODE=smpp
SMS_ROTATION_LIMIT=10

SMS_ACCOUNT_1=system_id_1
SMS_PASSWORD_1=senha_do_painel_1
SMS_SMPP_PASSWORD_1=senha_bind_smpp_1
SMS_ACCOUNT_2=system_id_2
SMS_PASSWORD_2=senha_do_painel_2
SMS_SMPP_PASSWORD_2=senha_bind_smpp_2

SMPP_HOST=msg.topying.net
SMPP_PORT=2775
SMPP_SECURE=false
SMPP_BIND_MODE=transceiver
SMPP_SYSTEM_TYPE=
SMPP_INTERFACE_VERSION=52
SMPP_SOURCE_ADDR=SeuRemetente
SMPP_SOURCE_ADDR_TON=0
SMPP_SOURCE_ADDR_NPI=0
SMPP_DEST_ADDR_TON=1
SMPP_DEST_ADDR_NPI=1
SMPP_REGISTERED_DELIVERY=1
SMPP_TIMEOUT_MS=15000
```

Campos que voce deve pedir/confirmar com o provedor:

- `SMPP_HOST` e `SMPP_PORT`: endereco e porta do gateway.
- `SMPP_SECURE`: `true` se o provedor exigir TLS/SSL; caso contrario `false`.
- `SMPP_BIND_MODE`: normalmente `transceiver`; alguns provedores aceitam apenas `transmitter`.
- `SMPP_SYSTEM_TYPE`: alguns provedores exigem vazio; outros fornecem um valor especifico.
- `SMPP_SOURCE_ADDR`: remetente/sender id permitido pelo provedor.
- TON/NPI de origem e destino: se o provedor nao informar, comece com origem `0/0` e destino `1/1` para numeros internacionais.
- `SMPP_REGISTERED_DELIVERY`: `1` pede recibo de entrega quando o gateway suporta.

Observacao: para usar SMPP, rode `npm install` antes do `npm start`, pois o protocolo usa a biblioteca `smpp`.

## Envio pelo painel web

Use este modo quando o gateway SMPP nao estiver disponivel, mas o envio pelo painel web funcionar.

```env
SMS_PROVIDER_MODE=panel
PANEL_BASE_URL=https://msg.topying.net
PANEL_SENDER_ID=

SMS_ACCOUNT_1=0122C371A
SMS_PASSWORD_1=senha_do_painel_1
SMS_ACCOUNT_2=0122C371B
SMS_PASSWORD_2=senha_do_painel_2
```

Como funciona:

- O sistema carrega a chave publica do login em `/loadPuk`.
- A senha do painel e criptografada igual ao login do site.
- A sessao/cookies ficam em memoria enquanto o servidor local estiver aberto.
- Antes de enviar, o sistema busca o token em `/loadSessionToken`.
- O SMS e enviado por `/sendSms/sendSmsShortcut/save.ajax`.

No painel local, use `Verificar conexoes` para fazer login nas contas e ver quais estao conectadas.

## Seguranca

- Nao compartilhe o arquivo `.env`.
- Troque senhas que ja tenham sido coladas em chat, planilha ou outro lugar exposto.
- Use somente contas autorizadas e respeite limites/termos do provedor.
- Este sistema faz balanceamento configurado entre contas; ele nao deve ser usado para burlar bloqueios, consentimento, antifraude ou limites contratuais.

## Arquivos principais

- `server.js`: servidor HTTP, endpoints e processamento da fila.
- `src/accountRotator.js`: regra de rotacao das contas.
- `src/smsProvider.js`: envio mock ou via API real.
- `src/jobStore.js`: persistencia simples da fila e logs.
- `public/user.html`: pagina do usuario (envio simples).
- `public/admin.html`: painel administrativo.
- `public/admin-monitor.html`: monitor completo do admin.

## Enviar sem NBlock (webhook com chave)

Se voce estava usando o NBlock apenas para disparar requisoes HTTP e bateu o limite mensal, voce pode chamar este servidor diretamente usando um webhook com chave (sem login/cookies).

1. No `.env`, configure:

```env
WEBHOOK_API_KEY=sua-chave-forte-aqui
WEBHOOK_DEFAULT_ACCOUNTS=0122C371A,0122C371B
```

2. Dispare via HTTP:

```text
POST http://localhost:3000/api/webhook/send
Header: x-api-key: sua-chave-forte-aqui
Body: {"phone":"5511999999999","message":"Ola {{HORA}}","rotationLimit":10}
```

O body aceita o mesmo formato do `/api/send` (incluindo `bulkText` e `items`).

## Rodar sem ngrok (quando bater o limite)

Se o seu problema é o limite mensal do ngrok, use o Cloudflare Quick Tunnel (sem conta) para gerar uma URL pública alternativa.

- Script: `C:\xampp\htdocs\envio\painel-shortcode\painel-cloudflare-fallback\start-painel-cloudflare.ps1`
- Atalho (duplo clique): `C:\xampp\htdocs\envio\painel-shortcode\painel-cloudflare-fallback\Iniciar Painel Shortcode Cloudflare.vbs`
- Saída do link: `C:\xampp\htdocs\envio\painel-shortcode\ngrok-output\public-url.txt`

## Deploy na VPS (1 clique)

Para rodar sem ngrok e sem depender do seu PC ligado, rode o sistema numa VPS.

Arquivos:
- `tools/vps-deploy.ps1`: empacota no Windows, envia para a VPS e executa o bootstrap.
- `tools/vps-bootstrap.sh`: instala dependencias (Node/Nginx), cria service e publica em `http://IP/`.
- `tools/vps-backup.sh`: gera backup manual do app atual na VPS em `/var/backups/painel-shortcode`.
- `.env.vps.example`: template para criar `/.env.vps` (na sua maquina; nao commitar).

Passos (Windows):
1. Copie `.env.vps.example` para `.env.vps` e preencha as contas e `SMS_PROVIDER_MODE=panel`.
2. Rode:

```powershell
.\tools\vps-deploy.ps1 -HostIp 64.20.56.107 -EnvFile .\.env.vps
```

O deploy gera um backup remoto automaticamente antes de publicar a nova versao.
Os backups ficam em `/var/backups/painel-shortcode`.

Para criar um backup manual direto na VPS:

```bash
sudo bash /root/vps-backup.sh
```

## Backup diario dos usuarios, creditos e relatorios

Para agendar backup automatico noturno na VPS (exemplo: todo dia as 23:30), rode no PowerShell:

```powershell
.\tools\vps-install-nightly-backup.ps1 -HostIp 64.20.56.107 -Hour 23 -Minute 30
```

Esse backup salva principalmente:

- `users.json`: usuarios, creditos, permissoes
- `jobs.json`: fila/historico
- `sms-log.jsonl`: relatorio bruto
- `storefront.json`: contato/pacotes
- `rotation-state.json`
- `sessions.json`
- `data.tar.gz`: pacote completo do diretorio `data/`

Os backups ficam em `/var/backups/painel-shortcode/nightly-*`.

Para baixar o backup mais recente no PowerShell:

```powershell
.\tools\vps-download-backup.ps1 -HostIp 64.20.56.107 -LatestOnly
```

Para baixar todos os backups noturnos:

```powershell
.\tools\vps-download-backup.ps1 -HostIp 64.20.56.107
```

Para restaurar um backup `data.tar.gz` via PowerShell:

```powershell
.\tools\vps-upload-restore-backup.ps1 -HostIp 64.20.56.107 -BackupFile .\vps-backups\SEU_BACKUP\data.tar.gz
```
