const path = require('path');
const fs = require('fs');
const { AccountRotator } = require('../src/accountRotator');

const statePath = path.join(__dirname, '..', 'data', 'rotation-test-state.json');
if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

const accounts = ['A', 'B', 'C', 'D'].map((account, index) => ({ id: String(index + 1), account, password: 'x' }));
const rotator = new AccountRotator({ accounts, rotationLimit: 10, statePath });
const selectedAccounts = ['A', 'B', 'C', 'D'];
const sent = [];

for (let i = 0; i < 8; i += 1) {
  const account = rotator.getCurrentAccount(selectedAccounts, 1);
  sent.push(account.account);
  rotator.markSuccess(account, selectedAccounts, 1);
}

console.log(sent.join(','));
if (sent.join(',') !== 'A,B,C,D,A,B,C,D') {
  throw new Error(`Rotacao limite 1 falhou: ${sent.join(',')}`);
}

if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
