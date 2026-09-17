const express = require('express');
const { sendResult, sendValidationError } = require('../responses');

function createWaitlistRouter({ engine }) {
  const router = express.Router();

  // POST /api/waitlist  body: { email }
  router.post('/', (req, res) => {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return sendValidationError(res, 'An email address is required.');
    }
    const result = engine.joinWaitlist(email.trim().toLowerCase());
    return sendResult(res, result);
  });

  return router;
}

module.exports = { createWaitlistRouter };
