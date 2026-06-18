const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class JobStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.jobsPath = path.join(dataDir, 'jobs.json');
    this.logPath = path.join(dataDir, 'sms-log.jsonl');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  readJobs() {
    if (!fs.existsSync(this.jobsPath)) return [];

    try {
      return JSON.parse(fs.readFileSync(this.jobsPath, 'utf8'));
    } catch {
      return [];
    }
  }

  writeJobs(jobs) {
    fs.writeFileSync(this.jobsPath, JSON.stringify(jobs, null, 2));
  }

  addJobs(items) {
    const jobs = this.readJobs();
    const now = new Date().toISOString();
    const newJobs = items.map((item) => ({
      id: crypto.randomUUID(),
      createdBy: item.createdBy ? { ...item.createdBy } : null,
      phone: item.phone,
      message: item.message,
      selectedAccounts: item.selectedAccounts || [],
      rotationLimit: item.rotationLimit,
      billable: Boolean(item.billable),
      creditCharged: Boolean(item.creditCharged),
      creditRefunded: Boolean(item.creditRefunded),
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      account: null,
      lastError: null,
      providerResponse: null
    }));

    this.writeJobs([...jobs, ...newJobs]);
    return newJobs;
  }

  nextQueuedJob() {
    return this.readJobs().find((job) => job.status === 'queued');
  }

  updateJob(id, patch) {
    const jobs = this.readJobs();
    const index = jobs.findIndex((job) => job.id === id);
    if (index === -1) return null;

    jobs[index] = { ...jobs[index], ...patch, updatedAt: new Date().toISOString() };
    this.writeJobs(jobs);
    return jobs[index];
  }

  appendLog(entry) {
    fs.appendFileSync(this.logPath, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
  }

  clearCompleted() {
    const jobs = this.readJobs();
    const remaining = jobs.filter((job) => !['sent', 'failed'].includes(job.status));
    const removed = jobs.length - remaining.length;
    this.writeJobs(remaining);
    this.appendLog({ type: 'clear_completed', removed });
    return { removed, remaining: remaining.length };
  }

  clearCompletedByUserId(userId) {
    const jobs = this.readJobs();
    const remaining = jobs.filter((job) => {
      if (!job || !['sent', 'failed'].includes(job.status)) return true;
      return !(job.createdBy && job.createdBy.userId === userId);
    });
    const removed = jobs.length - remaining.length;
    this.writeJobs(remaining);
    this.appendLog({ type: 'clear_completed_user', removed, userId });
    return { removed, remaining: remaining.length };
  }

  listByUserId(userId, { limit = 50 } = {}) {
    const jobs = this.readJobs();
    const filtered = jobs.filter((job) => job && job.createdBy && job.createdBy.userId === userId);
    return filtered.slice(-limit).reverse();
  }

  statsByUserId(userId) {
    const jobs = this.readJobs();
    const filtered = jobs.filter((job) => job && job.createdBy && job.createdBy.userId === userId);

    return {
      total: filtered.length,
      queued: filtered.filter((j) => j.status === 'queued').length,
      sending: filtered.filter((j) => j.status === 'sending').length,
      sent: filtered.filter((j) => j.status === 'sent').length,
      failed: filtered.filter((j) => j.status === 'failed').length
    };
  }

  summary() {
    const jobs = this.readJobs();
    return {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === 'queued').length,
      sending: jobs.filter((job) => job.status === 'sending').length,
      sent: jobs.filter((job) => job.status === 'sent').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      recent: jobs.slice(-20).reverse()
    };
  }
}

module.exports = { JobStore };
