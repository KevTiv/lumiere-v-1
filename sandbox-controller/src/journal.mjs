import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export class JournalError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function scopeKey(scope) {
  return createHash('sha256').update(JSON.stringify([
    scope.actorIdentity, scope.organizationId, scope.companyId, scope.runId, scope.policyGeneration,
  ])).digest('hex');
}

/** Private, single-replica operational storage. It never becomes ERP authority. */
export class ExecutionJournal {
  #db;
  constructor(path) {
    if (path !== ':memory:') {
      if (!isAbsolute(path)) throw new JournalError('journal_path_must_be_absolute');
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.#db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executions (
        request_key TEXT PRIMARY KEY, scope_key TEXT NOT NULL,
        organization_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        status TEXT NOT NULL, reserved_cpu_ms INTEGER NOT NULL,
        charged_cpu_ms INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL,
        record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        hash TEXT NOT NULL, scope_key TEXT NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY (hash, scope_key)
      );
    `);
  }

  close() { this.#db.close(); }
  putDataset(record) {
    this.#db.prepare('INSERT INTO datasets VALUES (?, ?, ?)')
      .run(record.id, Date.parse(record.expiresAt), JSON.stringify(record));
  }
  getDataset(id) {
    const row = this.#db.prepare('SELECT record FROM datasets WHERE id = ?').get(id);
    return row ? JSON.parse(row.record) : undefined;
  }
  revokeDataset(id) {
    const record = this.getDataset(id);
    if (!record) return;
    record.revoked = true;
    // Access revocation and removal of the temporary row copy are one write.
    record.rows = [];
    this.#db.prepare('UPDATE datasets SET record = ? WHERE id = ?').run(JSON.stringify(record), id);
  }
  purgeExpiredDatasets(now = Date.now()) {
    const rows = this.#db.prepare('SELECT id FROM datasets WHERE expires_at <= ?').all(now);
    for (const row of rows) this.revokeDataset(row.id);
    return rows.length;
  }

  getExecution(requestKey) {
    const row = this.#db.prepare('SELECT record FROM executions WHERE request_key = ?').get(requestKey);
    return row ? JSON.parse(row.record) : undefined;
  }

  /** Admission and reservation serialize across processes using the same volume. */
  claimExecution(record, { maxConcurrent, maxCpuMsPerDay, reservedCpuMs }) {
    if (![maxConcurrent, maxCpuMsPerDay, reservedCpuMs].every(Number.isSafeInteger)
      || Math.min(maxConcurrent, maxCpuMsPerDay, reservedCpuMs) <= 0) throw new JournalError('invalid_quota');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getExecution(record.requestKey);
      if (existing) {
        if (scopeKey(existing.scope) !== scopeKey(record.scope)
          || existing.requestHash !== record.requestHash) throw new JournalError('execution_identity_conflict');
        this.#db.exec('COMMIT');
        return { created: false, record: existing };
      }
      const day = record.createdAt.slice(0, 10);
      const org = record.scope.organizationId;
      const active = this.#db.prepare(`SELECT COUNT(*) AS count FROM executions
        WHERE organization_id = ? AND reserved_cpu_ms > 0`).get(org).count;
      const used = this.#db.prepare(`SELECT COALESCE(SUM(reserved_cpu_ms + charged_cpu_ms), 0) AS total
        FROM executions WHERE organization_id = ? AND day = ?`).get(org, day).total;
      if (active >= maxConcurrent) throw new JournalError('sandbox_concurrency_exhausted');
      if (used + reservedCpuMs > maxCpuMsPerDay) throw new JournalError('sandbox_compute_budget_exhausted');
      this.#db.prepare('INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)').run(
        record.requestKey, scopeKey(record.scope), org, record.requestHash,
        record.status, reservedCpuMs, day, JSON.stringify(record),
      );
      this.#db.exec('COMMIT');
      return { created: true, record };
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  updateExecution(requestKey, patch) {
    const record = this.getExecution(requestKey);
    if (!record) throw new JournalError('execution_missing');
    // Completed ownership is immutable. A delayed observer may neither change
    // its outcome nor replace the validated output with stale observations.
    if (['completed', 'failed', 'cancelled'].includes(record.status)) return record;
    for (const key of Object.keys(patch)) {
      if (!['status', 'updatedAt', 'sandboxHandle', 'sessionName', 'failureCode', 'evidence', 'artifacts', 'terminalStatus',
        'cleanupPending', 'finishedAt', 'cancelRequested'].includes(key)) throw new JournalError('immutable_execution_field');
    }
    const encoded = JSON.stringify(patch);
    // Patch at the SQL write boundary so another observer's cancellation or
    // terminal commit cannot be overwritten by a stale JSON read.
    this.#db.prepare(`UPDATE executions SET
      status = COALESCE(json_extract(?, '$.status'), status), record = json_patch(record, ?)
      WHERE request_key = ? AND status NOT IN ('completed', 'failed', 'cancelled')`)
      .run(encoded, encoded, requestKey);
    return this.getExecution(requestKey);
  }

  settleExecution(requestKey, chargedCpuMs) {
    // Unknown outcomes retain the entire reservation until teardown is confirmed.
    if (!Number.isSafeInteger(chargedCpuMs) || chargedCpuMs < 0) throw new JournalError('invalid_compute_charge');
    const row = this.#db.prepare('SELECT reserved_cpu_ms FROM executions WHERE request_key = ?').get(requestKey);
    if (!row) throw new JournalError('execution_missing');
    if (row.reserved_cpu_ms === 0) return;
    if (chargedCpuMs > row.reserved_cpu_ms) throw new JournalError('compute_charge_exceeds_reservation');
    this.#db.prepare('UPDATE executions SET charged_cpu_ms = ?, reserved_cpu_ms = 0 WHERE request_key = ?')
      .run(chargedCpuMs, requestKey);
  }

  /** Terminal status and the original reservation settle in one durable commit. */
  finalizeExecution(requestKey, patch) {
    if (!['completed', 'failed', 'cancelled'].includes(patch.status)) throw new JournalError('invalid_terminal_status');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const record = this.getExecution(requestKey);
      if (!record) throw new JournalError('execution_missing');
      if (!['completed', 'failed', 'cancelled'].includes(record.status)) {
        if (record.cancelRequested) patch = { ...patch, status: 'cancelled', terminalStatus: 'cancelled' };
        this.updateExecution(requestKey, patch);
      }
      this.#db.prepare(`UPDATE executions SET charged_cpu_ms = charged_cpu_ms + reserved_cpu_ms,
        reserved_cpu_ms = 0 WHERE request_key = ?`).run(requestKey);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
    return this.getExecution(requestKey);
  }

  listUnsettled() {
    return this.#db.prepare('SELECT record FROM executions WHERE reserved_cpu_ms > 0')
      .all().map((row) => JSON.parse(row.record));
  }
  putArtifact(scope, artifact) {
    const key = scopeKey(scope);
    // Names and dataset lineage belong to execution descriptors, not blob identity.
    const content = JSON.stringify({ sha256: artifact.sha256, mimeType: artifact.mimeType,
      content: artifact.content, bytes: artifact.bytes });
    const existing = this.#db.prepare('SELECT record FROM artifacts WHERE hash = ? AND scope_key = ?')
      .get(artifact.sha256, key);
    if (existing && existing.record !== content) throw new JournalError('artifact_hash_conflict');
    this.#db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?, ?)').run(artifact.sha256, key, content);
  }
  getArtifact(scope, hash) {
    const row = this.#db.prepare('SELECT record FROM artifacts WHERE hash = ? AND scope_key = ?')
      .get(hash, scopeKey(scope));
    return row ? JSON.parse(row.record) : undefined;
  }
}
