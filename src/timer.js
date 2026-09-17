// A tiny background job. Every couple of seconds it asks the rules engine
// to check for expired holds. It uses the exact same engine.processExpiries()
// function that everything else uses, so an expiry behaves identically
// whether it's caught by this timer or triggered some other way - there's
// only one place that logic lives.

function startExpiryTimer(engine, intervalMs = 1500) {
  const timer = setInterval(() => {
    try {
      engine.processExpiries();
    } catch (err) {
      // I don't want one bad tick to crash the whole server
      // eslint-disable-next-line no-console
      console.error('Error while checking for expired holds:', err);
    }
  }, intervalMs);

  // so tests / a clean shutdown can stop this if they need to
  return () => clearInterval(timer);
}

module.exports = { startExpiryTimer };
