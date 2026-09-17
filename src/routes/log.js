const express = require('express');

function createLogRouter({ store }) {
  const router = express.Router();

  // GET /api/log            -> everything, oldest first
  // GET /api/log?seat=5     -> just seat 5's history
  router.get('/', (req, res) => {
    const seatParam = req.query.seat;
    const seatNumber = seatParam ? Number(seatParam) : undefined;
    const entries = store.getLog(seatNumber);
    res.status(200).json({ data: { entries } });
  });

  return router;
}

module.exports = { createLogRouter };
