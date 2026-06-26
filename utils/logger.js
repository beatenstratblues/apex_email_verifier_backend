const fs = require('fs');
const path = require('path');

const logDirectory = path.join(__dirname, '..', 'logs');
const logFilePath = path.join(logDirectory, 'activity.log');

// Ensure log directory exists
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

/**
 * Logs a verification event to the activity.log file.
 * @param {string} ip - Client IP address
 * @param {string} email - The email address verified
 * @param {string} status - Final status (deliverable, undeliverable, risky, unknown)
 * @param {Object} details - Breakdown of verification steps
 */
function logVerification(ip, email, status, details) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip: ip || 'unknown',
    email,
    status,
    details
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  fs.appendFile(logFilePath, logLine, (err) => {
    if (err) {
      console.error('Failed to write to verification log:', err);
    }
  });

  // Also print to console for development visibility
  console.log(`[LOG] [${logEntry.timestamp}] IP: ${logEntry.ip} | Email: ${email} | Status: ${status}`);
}

/**
 * Reads the last N logs from the file for stats or dashboard view.
 * @param {number} limit - Max number of logs to return
 * @returns {Promise<Array>}
 */
function getRecentLogs(limit = 100) {
  return new Promise((resolve) => {
    if (!fs.existsSync(logFilePath)) {
      return resolve([]);
    }

    fs.readFile(logFilePath, 'utf8', (err, data) => {
      if (err) {
        console.error('Failed to read logs:', err);
        return resolve([]);
      }

      const lines = data.trim().split('\n').filter(Boolean);
      const logs = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .reverse() // Newest first
        .slice(0, limit);

      resolve(logs);
    });
  });
}

/**
 * Gets aggregate statistics from the log file.
 * @returns {Promise<Object>}
 */
function getStats() {
  return new Promise((resolve) => {
    if (!fs.existsSync(logFilePath)) {
      return resolve({ total: 0, deliverable: 0, undeliverable: 0, risky: 0 });
    }

    fs.readFile(logFilePath, 'utf8', (err, data) => {
      if (err) {
        console.error('Failed to read logs for stats:', err);
        return resolve({ total: 0, deliverable: 0, undeliverable: 0, risky: 0 });
      }

      const lines = data.trim().split('\n').filter(Boolean);
      let total = 0;
      let deliverable = 0;
      let undeliverable = 0;
      let risky = 0;

      lines.forEach(line => {
        try {
          const entry = JSON.parse(line);
          total++;
          if (entry.status === 'deliverable') deliverable++;
          else if (entry.status === 'undeliverable') undeliverable++;
          else if (entry.status === 'risky') risky++;
        } catch {
          // ignore malformed lines
        }
      });

      resolve({ total, deliverable, undeliverable, risky });
    });
  });
}

module.exports = {
  logVerification,
  getRecentLogs,
  getStats
};
