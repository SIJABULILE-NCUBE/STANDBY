const express = require('express');
const { sendResult, sendValidationError } = require('../responses');

// this whole file only talks to the engine and the store to read data - it
// never decides whether an action is allowed. that decision always lives
// in rulesEngine.js
function createSeatsRouter({ engine, store }) {
  const router = express.Router();

  // GET /api/seats - the seat map screen polls this to draw the grid
  router.get('/', (req, res) => {
    const seats = store.getAllSeats();
    res.status(200).json({ data: { seats, totalSeats: seats.length } });
  });

  // POST /api/seats/:seatNumber/hold  body: { email }
  router.post('/:seatNumber/hold', (req, res) => {
    const seatNumber = Number(req.params.seatNumber);
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return sendValidationError(res, 'An email address is required.');
    }
    if (!Number.isInteger(seatNumber)) {
      return sendValidationError(res, 'Seat number must be a whole number.');
    }

    const result = engine.placeHold(email.trim().toLowerCase(), seatNumber);
    return sendResult(res, result);
  });

  return router;
}

module.exports = { createSeatsRouter };
