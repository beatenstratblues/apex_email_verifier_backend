const test = require('node:test');
const assert = require('node:assert');
const dns = require('dns').promises;
const net = require('net');

// Mock DNS MX resolution
test.mock.method(dns, 'resolveMx', async (domain) => {
  if (domain === 'gmail.com') {
    return [{ priority: 10, exchange: 'gmail-smtp-in.l.google.com' }];
  }
  if (domain === 'mailinator.com') {
    return [{ priority: 10, exchange: 'mail.mailinator.com' }];
  }
  if (domain === 'invalid-mx.com') {
    throw new Error('queryMx ENOTFOUND invalid-mx.com');
  }
  return [{ priority: 10, exchange: 'mail.example.com' }];
});

// Mock Net connection for SMTP
test.mock.method(net, 'createConnection', (port, host) => {
  const { EventEmitter } = require('events');
  const mockSocket = new EventEmitter();
  
  mockSocket.write = function(data) {
    if (data.startsWith('EHLO')) {
      setTimeout(() => mockSocket.emit('data', '250-smtp.example.com\r\n250 HELP\r\n'), 5);
    } else if (data.startsWith('MAIL FROM')) {
      setTimeout(() => mockSocket.emit('data', '250 2.1.0 OK\r\n'), 5);
    } else if (data.startsWith('RCPT TO')) {
      if (data.includes('nonexistent')) {
        setTimeout(() => mockSocket.emit('data', '550 5.1.1 User unknown\r\n'), 5);
      } else {
        setTimeout(() => mockSocket.emit('data', '250 2.1.5 OK\r\n'), 5);
      }
    }
  };
  mockSocket.setTimeout = () => {};
  mockSocket.destroy = () => {};
  
  // Send greeting
  setTimeout(() => mockSocket.emit('data', '220 smtp.example.com ESMTP\r\n'), 5);
  
  return mockSocket;
});

// Import the verifier under test
const { validateSyntax, verifyEmail } = require('../utils/verifier');

test('validateSyntax should validate email syntax formats correctly', () => {
  // Valid cases
  assert.strictEqual(validateSyntax('test@example.com'), true);
  assert.strictEqual(validateSyntax('user.name+tag@domain.co.uk'), true);
  
  // Invalid cases
  assert.strictEqual(validateSyntax('plainaddress'), false);
  assert.strictEqual(validateSyntax('@missinglocal.com'), false);
  assert.strictEqual(validateSyntax('missingdomain@'), false);
  assert.strictEqual(validateSyntax('double@@domain.com'), false);
  assert.strictEqual(validateSyntax(''), false);
  assert.strictEqual(validateSyntax(null), false);
});

test('verifyEmail should identify invalid syntax immediately', async () => {
  const result = await verifyEmail('invalid-syntax');
  assert.strictEqual(result.isValidSyntax, false);
  assert.strictEqual(result.status, 'undeliverable');
  assert.strictEqual(result.message, 'Invalid syntax format');
});

test('verifyEmail should check MX records and return undeliverable if none exist', async () => {
  const result = await verifyEmail('test@invalid-mx.com');
  assert.strictEqual(result.isValidSyntax, true);
  assert.strictEqual(result.hasMxRecords, false);
  assert.strictEqual(result.status, 'undeliverable');
  assert.strictEqual(result.message, 'Domain has no MX records (cannot receive emails)');
});

test('verifyEmail should check deliverable email', async () => {
  const result = await verifyEmail('deliverable@example.com');
  assert.strictEqual(result.isValidSyntax, true);
  assert.strictEqual(result.hasMxRecords, true);
  assert.strictEqual(result.smtpCheck.success, true);
  assert.strictEqual(result.status, 'deliverable');
});

test('verifyEmail should flag role-based deliverable email as risky', async () => {
  const result = await verifyEmail('admin@example.com');
  assert.strictEqual(result.isValidSyntax, true);
  assert.strictEqual(result.isRoleBased, true);
  assert.strictEqual(result.status, 'risky');
});

test('verifyEmail should flag disposable deliverable email as risky', async () => {
  const result = await verifyEmail('test@mailinator.com');
  assert.strictEqual(result.isValidSyntax, true);
  assert.strictEqual(result.isDisposable, true);
  assert.strictEqual(result.status, 'risky');
});

test('verifyEmail should flag nonexistent mailbox as undeliverable', async () => {
  const result = await verifyEmail('nonexistent@example.com');
  assert.strictEqual(result.isValidSyntax, true);
  assert.strictEqual(result.smtpCheck.success, false);
  assert.strictEqual(result.status, 'undeliverable');
});
