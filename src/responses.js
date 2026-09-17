// Keeps every route replying with the same shape, so the frontend only
// has to know one format for "it worked" and one format for "it didn't".
//
// success -> { data: {...} }
// failure -> { error: { code: 'SOME_RULE_CODE', message: 'readable text' } }

// mapping rule failures to HTTP status codes. most of these are just
// "you broke a business rule" (422), but a couple make more sense as 404
// (nothing there) or 409 (conflict with current state)
const STATUS_BY_REASON = {
  SEAT_INVALID: 404,
  HOLD_NOT_FOUND: 404,
  SEAT_NOT_AVAILABLE: 409,
  MAX_ACTIVE_HOLDS: 422,
  HOURLY_LIMIT: 422,
  EMAIL_MISMATCH: 403,
  HOLD_NOT_ACTIVE: 409,
  MAX_EXTENSIONS: 422,
  HOLD_NOT_RELEASABLE: 409,
  SEATS_AVAILABLE: 422,
  ALREADY_ON_WAITLIST: 422,
  HAS_ACTIVE_HOLD_OR_SEAT: 422,
  VALIDATION_ERROR: 400,
};

function sendResult(res, result) {
  if (result.success) {
    return res.status(200).json({ data: result.data });
  }
  const status = STATUS_BY_REASON[result.reasonCode] || 422;
  return res.status(status).json({ error: { code: result.reasonCode, message: result.message } });
}

function sendValidationError(res, message) {
  return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message } });
}

module.exports = { sendResult, sendValidationError };
