const fs = require('fs');
const path = require('path');

class AccountRotator {
  constructor({ accounts, rotationLimit, statePath }) {
    this.accounts = accounts;
    this.rotationLimit = rotationLimit;
    this.statePath = statePath;
    this.state = this.loadState();
  }

  loadState() {
    if (!fs.existsSync(this.statePath)) {
      return this.defaultState();
    }

    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return { ...this.defaultState(), ...state, scopes: state.scopes || {} };
    } catch {
      return this.defaultState();
    }
  }

  defaultState() {
    return { totalSent: 0, accountTotals: {}, scopes: {} };
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  getAccountsForSelection(selectedAccounts = []) {
    if (this.accounts.length === 0) {
      throw new Error('Nenhuma conta SMS foi configurada no .env.');
    }

    if (!Array.isArray(selectedAccounts) || selectedAccounts.length === 0) {
      return this.accounts;
    }

    const selectedSet = new Set(selectedAccounts);
    const scopedAccounts = this.accounts.filter((item) => selectedSet.has(item.account));

    if (scopedAccounts.length === 0) {
      throw new Error('Nenhuma das contas selecionadas esta configurada no .env.');
    }

    return scopedAccounts;
  }

  normalizeLimit(rotationLimit = this.rotationLimit) {
    const limit = Number(rotationLimit);
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : this.rotationLimit;
  }

  getScopeKey(accounts, rotationLimit = this.rotationLimit) {
    return `${accounts.map((item) => item.account).sort().join('|')}::limit:${this.normalizeLimit(rotationLimit)}`;
  }

  getScope(accounts, rotationLimit = this.rotationLimit) {
    const scopeKey = this.getScopeKey(accounts, rotationLimit);

    if (!this.state.scopes[scopeKey]) {
      this.state.scopes[scopeKey] = { currentIndex: 0, sentInCurrentSlot: 0 };
    }

    const scope = this.state.scopes[scopeKey];
    if (scope.currentIndex >= accounts.length) {
      scope.currentIndex = 0;
      scope.sentInCurrentSlot = 0;
    }

    return { scopeKey, scope };
  }

  getCurrentAccount(selectedAccounts = [], rotationLimit = this.rotationLimit) {
    const accounts = this.getAccountsForSelection(selectedAccounts);
    const { scope } = this.getScope(accounts, rotationLimit);
    return accounts[scope.currentIndex];
  }

  markSuccess(account, selectedAccounts = [], rotationLimit = this.rotationLimit) {
    const accounts = this.getAccountsForSelection(selectedAccounts);
    const { scope } = this.getScope(accounts, rotationLimit);
    const limit = this.normalizeLimit(rotationLimit);

    scope.sentInCurrentSlot += 1;
    this.state.totalSent += 1;
    this.state.accountTotals[account.account] = (this.state.accountTotals[account.account] || 0) + 1;

    if (scope.sentInCurrentSlot >= limit) {
      scope.currentIndex = (scope.currentIndex + 1) % accounts.length;
      scope.sentInCurrentSlot = 0;
    }

    this.saveState();
  }

  status(selectedAccounts = [], rotationLimit = this.rotationLimit) {
    const accounts = this.accounts.length > 0 ? this.getAccountsForSelection(selectedAccounts) : [];
    const { scope } = accounts.length > 0 ? this.getScope(accounts, rotationLimit) : { scope: { currentIndex: 0, sentInCurrentSlot: 0 } };
    const currentAccount = accounts.length > 0 ? accounts[scope.currentIndex].account : null;

    return {
      currentAccount,
      rotationLimit: this.rotationLimit,
      sentInCurrentSlot: scope.sentInCurrentSlot,
      totalSent: this.state.totalSent,
      accountTotals: this.state.accountTotals,
      configuredAccounts: this.accounts.map((item) => item.account)
    };
  }
}

module.exports = { AccountRotator };
