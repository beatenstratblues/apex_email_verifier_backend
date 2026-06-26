const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

test('logger: getStats should aggregate stats correctly', async (t) => {
  const mockLogs = [
    JSON.stringify({ status: 'deliverable' }),
    JSON.stringify({ status: 'undeliverable' }),
    JSON.stringify({ status: 'risky' }),
    JSON.stringify({ status: 'deliverable' }),
  ].join('\n');

  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFile', (path, encoding, callback) => {
    callback(null, mockLogs);
  });

  const { getStats } = require('../utils/logger');
  const stats = await getStats();

  assert.deepStrictEqual(stats, {
    total: 4,
    deliverable: 2,
    undeliverable: 1,
    risky: 1
  });
});

test('logger: getRecentLogs should parse and return logs in reverse order', async (t) => {
  const log1 = { timestamp: '2026-06-26T12:00:00Z', email: 'a@example.com', status: 'deliverable' };
  const log2 = { timestamp: '2026-06-26T12:01:00Z', email: 'b@example.com', status: 'undeliverable' };
  const mockLogs = [JSON.stringify(log1), JSON.stringify(log2)].join('\n');

  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFile', (path, encoding, callback) => {
    callback(null, mockLogs);
  });

  const { getRecentLogs } = require('../utils/logger');
  const logs = await getRecentLogs(2);

  assert.strictEqual(logs.length, 2);
  assert.deepStrictEqual(logs[0], log2); // Newest first
  assert.deepStrictEqual(logs[1], log1);
});

test('logger: logVerification should format and append log line', async (t) => {
  let writtenData = '';
  t.mock.method(fs, 'appendFile', (path, data, callback) => {
    writtenData = data;
    callback(null);
  });

  const { logVerification } = require('../utils/logger');
  logVerification('127.0.0.1', 'test@example.com', 'deliverable', { syntax: true });

  // Let call resolve since appendFile is async callback
  await new Promise(resolve => setTimeout(resolve, 15));

  const parsed = JSON.parse(writtenData.trim());
  assert.strictEqual(parsed.ip, '127.0.0.1');
  assert.strictEqual(parsed.email, 'test@example.com');
  assert.strictEqual(parsed.status, 'deliverable');
  assert.deepStrictEqual(parsed.details, { syntax: true });
});
