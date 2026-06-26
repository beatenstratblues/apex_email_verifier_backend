const dns = require('dns').promises;
const net = require('net');

// A list of common disposable email domains
const disposableDomains = new Set([
  'mailinator.com', 'yopmail.com', 'tempmail.com', 'trashmail.com', 'guerrillamail.com',
  '10minutemail.com', 'getairmail.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc',
  'mailnesia.com', 'mailcatch.com', 'temp-mail.org', 'throwawaymail.com', 'burnermail.io',
  'fakeinbox.com', 'generator.email', 'tempmailaddress.com', 'mockemail.com', 'mytemp.email',
  'crazymailing.com', 'mail5.club', 'tempmail.net', 'boun.cr', 'tempmail.dev', 'tempail.com'
]);

// A list of common free email provider domains
const freeDomains = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'mail.com', 'aol.com', 'zoho.com', 'protonmail.com', 'proton.me', 'gmx.com',
  'yandex.com', 'mail.ru', 'comcast.net', 'verizon.net', 'cox.net', 'charter.net'
]);

// A list of common role-based local parts (before the @)
const roleLocalParts = new Set([
  'admin', 'administrator', 'support', 'info', 'contact', 'sales', 'billing', 'finance',
  'jobs', 'careers', 'hr', 'marketing', 'webmaster', 'postmaster', 'hostmaster',
  'newsletter', 'subscribe', 'help', 'team', 'office', 'staff', 'mail', 'press',
  'media', 'legal', 'compliance', 'admin-group', 'api', 'dev', 'developer', 'sysadmin'
]);

/**
 * Validates the email address format using standard regex.
 * @param {string} email 
 * @returns {boolean}
 */
function validateSyntax(email) {
  if (!email || typeof email !== 'string') return false;
  // Standard robust email regex
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!regex.test(email)) return false;
  
  // Double check basic length guidelines
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length > 64) return false;
  if (parts[1].length > 255) return false;
  
  return true;
}

/**
 * Attempts a socket-level SMTP handshake with a mail server to verify recipient existence.
 * Runs with a strict timeout to avoid blocking.
 * @param {string} mxHost - Mail server hostname
 * @param {string} email - Email address to verify
 * @returns {Promise<Object>} - SMTP check result
 */
function checkSMTPHandshake(mxHost, email) {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mxHost);
    let step = 0;
    let isResolved = false;
    let responseBuffer = '';

    const finish = (success, code, message) => {
      if (isResolved) return;
      isResolved = true;
      socket.destroy();
      resolve({ success, code, message });
    };

    socket.setTimeout(3000); // 3 seconds timeout

    socket.on('connect', () => {
      // Socket connected, wait for greeting
    });

    socket.on('timeout', () => {
      finish(false, 'TIMEOUT', 'Connection to SMTP server timed out (Port 25 blocked or rate-limited)');
    });

    socket.on('error', (err) => {
      finish(false, 'ERROR', `SMTP connection error: ${err.message}`);
    });

    socket.on('data', (chunk) => {
      responseBuffer += chunk.toString();
      
      // Wait until we have a full line (ends with \r\n or \n)
      if (!responseBuffer.includes('\n')) {
        return;
      }

      const lines = responseBuffer.split(/\r?\n/).filter(Boolean);
      // Process the last complete line
      const lastLine = lines[lines.length - 1];
      responseBuffer = ''; // Reset buffer for next lines

      // SMTP response codes: multiline responses have '-' after the code (e.g. 220-), single line has ' '
      // Check if it is a intermediate multi-line response (e.g., 220-xxx)
      if (/^\d{3}-/.test(lastLine)) {
        // Keep buffering
        responseBuffer = lastLine + '\n';
        return;
      }

      const code = lastLine.substring(0, 3);

      if (step === 0) {
        if (code === '220') {
          socket.write('EHLO emailverifier.local\r\n');
          step = 1;
        } else {
          finish(false, code, `Unexpected greeting: ${lastLine}`);
        }
      } else if (step === 1) {
        if (code === '250') {
          socket.write('MAIL FROM:<verify@emailverifier.local>\r\n');
          step = 2;
        } else {
          finish(false, code, `EHLO rejected: ${lastLine}`);
        }
      } else if (step === 2) {
        if (code === '250') {
          socket.write(`RCPT TO:<${email}>\r\n`);
          step = 3;
        } else {
          finish(false, code, `MAIL FROM rejected: ${lastLine}`);
        }
      } else if (step === 3) {
        if (code === '250' || code === '251' || code === '252') {
          // 250: Deliverable, 251: User not local will forward, 252: Cannot VRFY but will accept
          finish(true, code, 'Mailbox exists and is deliverable');
        } else if (['550', '551', '552', '553', '554'].includes(code)) {
          finish(false, code, `Mailbox unavailable or invalid: ${lastLine}`);
        } else {
          finish(false, code, `SMTP status code ${code}: ${lastLine}`);
        }
      }
    });
  });
}

/**
 * Performs full verification of an email address.
 * @param {string} email - Email address to verify
 * @returns {Promise<Object>} - Verification report
 */
async function verifyEmail(email) {
  const result = {
    email: email,
    isValidSyntax: false,
    isDisposable: false,
    isFreeProvider: false,
    isRoleBased: false,
    hasMxRecords: false,
    mxRecords: [],
    smtpCheck: {
      success: false,
      code: 'UNCHECKED',
      message: 'SMTP check not initiated'
    },
    status: 'undeliverable', // deliverable, risky, undeliverable
    message: ''
  };

  // 1. Syntax Check
  if (!validateSyntax(email)) {
    result.message = 'Invalid syntax format';
    result.status = 'undeliverable';
    return result;
  }
  result.isValidSyntax = true;

  const parts = email.split('@');
  const localPart = parts[0].toLowerCase();
  const domain = parts[1].toLowerCase();

  // 2. Checks on attributes
  result.isDisposable = disposableDomains.has(domain);
  result.isFreeProvider = freeDomains.has(domain);
  result.isRoleBased = roleLocalParts.has(localPart);

  // 3. DNS MX Check
  let mxRecords = [];
  try {
    mxRecords = await dns.resolveMx(domain);
    result.hasMxRecords = mxRecords && mxRecords.length > 0;
  } catch {
    result.hasMxRecords = false;
  }

  if (!result.hasMxRecords) {
    result.message = 'Domain has no MX records (cannot receive emails)';
    result.status = 'undeliverable';
    return result;
  }

  // Sort MX records by priority (lowest number is highest priority)
  result.mxRecords = mxRecords.sort((a, b) => a.priority - b.priority);
  const primaryMxHost = result.mxRecords[0].exchange;

  // 4. SMTP check
  // We run SMTP check on the highest priority server.
  try {
    const smtpResult = await checkSMTPHandshake(primaryMxHost, email);
    result.smtpCheck = smtpResult;
  } catch (err) {
    result.smtpCheck = {
      success: false,
      code: 'ERROR',
      message: `Verification exception: ${err.message}`
    };
  }

  // 5. Determine Overall Status
  // If SMTP is verified deliverable:
  if (result.smtpCheck.success) {
    if (result.isDisposable) {
      result.status = 'risky';
      result.message = 'Email is valid but uses a temporary/disposable domain';
    } else if (result.isRoleBased) {
      result.status = 'risky';
      result.message = 'Email is valid but belongs to a generic role/alias (e.g. admin@)';
    } else {
      result.status = 'deliverable';
      result.message = 'Email is valid and safe to send';
    }
  } else {
    // If SMTP rejected with a definitive error code (e.g., 550, 554)
    const smtpCode = result.smtpCheck.code;
    const isDefiniteReject = ['550', '551', '552', '553', '554'].includes(smtpCode);

    if (isDefiniteReject) {
      result.status = 'undeliverable';
      result.message = `Mailbox does not exist (${result.smtpCheck.message})`;
    } else {
      // Port 25 is blocked locally or server greylisted/timed out
      // Since MX record is valid, the domain exists, but we couldn't complete the handshake.
      if (result.isDisposable) {
        result.status = 'risky';
        result.message = 'Domain is valid but known as a temporary/disposable email provider';
      } else {
        result.status = 'risky';
        result.message = `Domain exists, but mailbox existence could not be confirmed (${result.smtpCheck.message})`;
      }
    }
  }

  return result;
}

module.exports = {
  verifyEmail,
  validateSyntax
};
