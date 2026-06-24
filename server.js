require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { verifyEmail } = require('./utils/verifier');
const { logVerification, getStats, getRecentLogs } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS for all domains as requested ("completely open")
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Helper to extract client IP address
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Single email verification endpoint
app.post('/api/verify', async (req, res) => {
  const { email } = req.body;
  const ip = getClientIp(req);

  if (!email || typeof email !== 'string') {
    return res.status(400).json({
      error: 'Invalid Request',
      message: 'Please provide an email address in the body'
    });
  }

  const trimmedEmail = email.trim();

  try {
    const report = await verifyEmail(trimmedEmail);
    
    // Log the verification attempt (email & result)
    logVerification(ip, report.email, report.status, {
      syntax: report.isValidSyntax,
      dns: report.hasMxRecords,
      disposable: report.isDisposable,
      free: report.isFreeProvider,
      role: report.isRoleBased,
      smtp: report.smtpCheck.code,
      error: report.smtpCheck.success ? null : report.smtpCheck.message
    });

    res.json(report);
  } catch (error) {
    console.error('Unhandled error during verification:', error);
    
    // Log exception
    logVerification(ip, trimmedEmail, 'unknown', {
      error: error.message
    });

    res.status(500).json({
      error: 'Verification failed',
      message: error.message
    });
  }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// Recent verification logs endpoint (public)
app.get('/api/logs', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  try {
    const logs = await getRecentLogs(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` Email Verifier Backend running on port ${PORT}`);
  console.log(` API Endpoint: http://localhost:${PORT}/api/verify`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  console.log(`===============================================`);
});
