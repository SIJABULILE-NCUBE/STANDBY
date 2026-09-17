// A quick manual check for the concurrency requirement - not part of the
// automated test suite, just something to run against a live server and
// watch happen with your own eyes (and to show on the Loom recording).
//
// It fires two "hold seat 1" requests at the exact same time and checks
// that only one of them actually wins the seat.
//
// Run the server first (npm start), then in another terminal:
//   node scripts/concurrency-test.js

const SEAT_NUMBER = 1;
const BASE_URL = 'http://localhost:3000';

async function attemptHold(email) {
  const response = await fetch(`${BASE_URL}/api/seats/${SEAT_NUMBER}/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await response.json();
  return { email, ok: response.ok, status: response.status, body };
}

async function main() {
  console.log(`Firing two simultaneous hold requests at seat ${SEAT_NUMBER}...\n`);

  // Promise.all kicks both fetch calls off before either one has finished,
  // so they're genuinely racing each other rather than running one after
  // the other
  const [resultA, resultB] = await Promise.all([
    attemptHold('userA@example.com'),
    attemptHold('userB@example.com'),
  ]);

  [resultA, resultB].forEach((result) => {
    console.log(`${result.email} -> status ${result.status}`);
    console.log(JSON.stringify(result.body, null, 2));
    console.log('');
  });

  const successes = [resultA, resultB].filter((r) => r.ok);

  if (successes.length === 1) {
    console.log(`PASS: exactly one request succeeded (${successes[0].email} got the seat).`);
  } else {
    console.log(`FAIL: ${successes.length} requests succeeded - expected exactly 1.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Script failed to run:', err.message);
  console.error('Is the server running? Try "npm start" in another terminal first.');
  process.exitCode = 1;
});
