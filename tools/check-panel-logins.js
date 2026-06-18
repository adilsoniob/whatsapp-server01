const { getConfig } = require('../src/config');
const { SmsProvider } = require('../src/smsProvider');
(async () => {
  const config = getConfig();
  const provider = new SmsProvider({ mode: config.providerMode, api: config.api, smpp: config.smpp, panel: config.panel });
  const statuses = await provider.checkPanelAccounts(config.accounts);
  console.log(JSON.stringify(statuses, null, 2));
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
