const express = require('express');
const { sendResult, sendValidationError } = require('../responses');

function createHoldsRouter({ engine }) {
  const router = express.Router();

  function getEmailOrFail(req, res) {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      sendValidationError(res, 'An email address is required.');
      return null;
    }
    return email.trim().toLowerCase();
  }

  // POST /api/holds/:code/extend  body: { email }
  router.post('/:code/extend', (req, res) => {
    const email = getEmailOrFail(req, res);
    if (!email) return; // getEmailOrFail already sent the response
    const result = engine.extendHold(email, req.params.code.trim().toUpperCase());
    return sendResult(res, result);
  });

  // POST /api/holds/:code/confirm  body: { email }
  router.post('/:code/confirm', (req, res) => {
    const email = getEmailOrFail(req, res);
    if (!email) return;
    const result = engine.confirmHold(email, req.params.code.trim().toUpperCase());
    return sendResult(res, result);
  });

  // POST /api/holds/:code/release  body: { email }
  router.post('/:code/release', (req, res) => {
    const email = getEmailOrFail(req, res);
    if (!email) return;
    const result = engine.releaseHold(email, req.params.code.trim().toUpperCase());
    return sendResult(res, result);
  });

  return router;
}

module.exports = { createHoldsRouter };
