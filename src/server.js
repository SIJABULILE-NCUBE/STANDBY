// This is the entry point. All it does is:
//   1. build the store, engine and background timer
//   2. wire up the routes
//   3. serve the frontend files
// It doesn't contain any business rules itself - if you're looking for
// "why did my hold get rejected", that logic is in rulesEngine.js, not here.

const path = require('path');
const express = require('express');

const config = require('./config');
const { createStore } = require('./store');
const { createRulesEngine } = require('./rulesEngine');
const { startExpiryTimer } = require('./timer');

const { createSeatsRouter } = require('./routes/seats');
const { createHoldsRouter } = require('./routes/holds');
const { createWaitlistRouter } = require('./routes/waitlist');
const { createLogRouter } = require('./routes/log');

function createApp() {
  const store = createStore(config);
  const engine = createRulesEngine({ store, config, now: () => Date.now() });

  const app = express();
  app.use(express.json());

  // serve the plain HTML/CSS/JS frontend from the public/ folder
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api/seats', createSeatsRouter({ engine, store }));
  app.use('/api/holds', createHoldsRouter({ engine }));
  app.use('/api/waitlist', createWaitlistRouter({ engine }));
  app.use('/api/log', createLogRouter({ store }));

  // also hand back the config so the frontend can show things like
  // "seats: 20" or "holds expire after 60s" without hardcoding them twice
  app.get('/api/config', (req, res) => {
    res.status(200).json({ data: config });
  });

  return { app, engine, store };
}

// only actually start listening if this file is run directly - this way
// the tests can import createApp() without spinning up a real server
if (require.main === module) {
  const { app, engine } = createApp();
  const stopTimer = startExpiryTimer(engine);
  const PORT = process.env.PORT || 3000;

  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Seat reservation server running on http://localhost:${PORT}`);
  });

  // clean shutdown so the interval timer doesn't keep the process alive
  process.on('SIGINT', () => {
    stopTimer();
    server.close(() => process.exit(0));
  });
}

module.exports = { createApp };
