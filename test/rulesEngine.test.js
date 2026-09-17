// Testing the rules engine directly, with no Express and no real time
// involved. I fake the clock with a plain variable I can move forward
// myself - that's the whole trick that lets an "expires after 60 seconds"
// test run in a few milliseconds instead of actually waiting a minute.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createStore } = require('../src/store');
const { createRulesEngine } = require('../src/rulesEngine');
const { ALLOWED_CHARS, CODE_LENGTH } = require('../src/holdCode');

// builds a fresh store + engine + fake clock for each test, so tests never
// leak state into each other
function setup(configOverrides = {}) {
  const config = {
    totalSeats: 5,
    holdExpirySeconds: 60,
    maxActiveHoldsPerUser: 2,
    maxHoldsPerUserPerHour: 5,
    maxExtensionsPerHold: 2,
    ...configOverrides,
  };

  let currentTime = 1_700_000_000_000; // arbitrary fixed starting point

  const store = createStore(config);
  const engine = createRulesEngine({ store, config, now: () => currentTime });

  return {
    config,
    store,
    engine,
    advance(ms) {
      currentTime += ms;
    },
  };
}

test('hold code is 6 characters, only allowed characters, and unique among active holds', () => {
  const { engine } = setup({ totalSeats: 20 });
  const seenCodes = new Set();
  const allowedSet = new Set(ALLOWED_CHARS.split(''));

  for (let seatNumber = 1; seatNumber <= 20; seatNumber++) {
    const result = engine.placeHold(`user${seatNumber}@example.com`, seatNumber);
    assert.equal(result.success, true);
    const { code } = result.data;

    assert.equal(code.length, CODE_LENGTH);
    for (const char of code) {
      assert.ok(allowedSet.has(char), `character "${char}" should not appear in a hold code`);
    }
    // 0, O, 1, I, L should never show up
    assert.doesNotMatch(code, /[0O1IL]/);

    assert.equal(seenCodes.has(code), false, 'hold codes should be unique among active holds');
    seenCodes.add(code);
  }
});

test('a hold expires after the configured time and frees the seat', () => {
  const { engine, store, advance } = setup({ holdExpirySeconds: 60 });

  const placeResult = engine.placeHold('reader@example.com', 1);
  assert.equal(placeResult.success, true);
  assert.equal(store.getSeat(1).status, 'held');

  // not expired yet at 59 seconds
  advance(59_000);
  let expiredList = engine.processExpiries();
  assert.equal(expiredList.length, 0);
  assert.equal(store.getSeat(1).status, 'held');

  // now push past the 60 second mark
  advance(2_000);
  expiredList = engine.processExpiries();
  assert.equal(expiredList.length, 1);
  assert.equal(store.getSeat(1).status, 'available');

  // the old code should no longer work, even though the seat is free again
  const confirmResult = engine.confirmHold('reader@example.com', placeResult.data.code);
  assert.equal(confirmResult.success, false);
  assert.equal(confirmResult.reasonCode, 'HOLD_NOT_ACTIVE');
});

test('a user cannot exceed the max active holds limit', () => {
  const { engine } = setup({ maxActiveHoldsPerUser: 2 });

  assert.equal(engine.placeHold('busy@example.com', 1).success, true);
  assert.equal(engine.placeHold('busy@example.com', 2).success, true);

  const thirdAttempt = engine.placeHold('busy@example.com', 3);
  assert.equal(thirdAttempt.success, false);
  assert.equal(thirdAttempt.reasonCode, 'MAX_ACTIVE_HOLDS');
});

test('a user cannot exceed the max holds per hour, even counting released holds', () => {
  const { engine, advance } = setup({ maxHoldsPerUserPerHour: 3, maxActiveHoldsPerUser: 10 });

  const first = engine.placeHold('frequent@example.com', 1);
  engine.releaseHold('frequent@example.com', first.data.code);

  const second = engine.placeHold('frequent@example.com', 2);
  engine.releaseHold('frequent@example.com', second.data.code);

  const third = engine.placeHold('frequent@example.com', 3);
  assert.equal(third.success, true);

  // fourth attempt within the same hour should be blocked, even though
  // seats 1 and 2 are free again
  const fourth = engine.placeHold('frequent@example.com', 4);
  assert.equal(fourth.success, false);
  assert.equal(fourth.reasonCode, 'HOURLY_LIMIT');

  // moving the clock forward past an hour should clear the window
  advance(61 * 60 * 1000);
  const afterAnHour = engine.placeHold('frequent@example.com', 4);
  assert.equal(afterAnHour.success, true);
});

test('a hold cannot be extended more than the configured number of times', () => {
  const { engine } = setup({ maxExtensionsPerHold: 2 });

  const placed = engine.placeHold('extender@example.com', 1);
  const code = placed.data.code;

  assert.equal(engine.extendHold('extender@example.com', code).success, true);
  assert.equal(engine.extendHold('extender@example.com', code).success, true);

  const thirdExtend = engine.extendHold('extender@example.com', code);
  assert.equal(thirdExtend.success, false);
  assert.equal(thirdExtend.reasonCode, 'MAX_EXTENSIONS');
});

test('confirming a hold is idempotent', () => {
  const { engine, store } = setup();

  const placed = engine.placeHold('confirmer@example.com', 1);
  const code = placed.data.code;

  const firstConfirm = engine.confirmHold('confirmer@example.com', code);
  assert.equal(firstConfirm.success, true);
  assert.equal(firstConfirm.data.alreadyConfirmed, false);

  const logLengthAfterFirst = store.getLog().length;

  const secondConfirm = engine.confirmHold('confirmer@example.com', code);
  assert.equal(secondConfirm.success, true);
  assert.equal(secondConfirm.data.alreadyConfirmed, true);
  assert.equal(secondConfirm.data.seatNumber, firstConfirm.data.seatNumber);

  // nothing new should have been written to the log the second time
  assert.equal(store.getLog().length, logLengthAfterFirst);
  assert.equal(store.getSeat(1).status, 'confirmed');
});

test('a confirmed seat can only be released, not re-confirmed after expiry logic runs', () => {
  const { engine, store } = setup();

  const placed = engine.placeHold('safe@example.com', 1);
  engine.confirmHold('safe@example.com', placed.data.code);

  // confirmed seats should not show up as expired, ever
  const expiredList = engine.processExpiries();
  assert.equal(expiredList.length, 0);
  assert.equal(store.getSeat(1).status, 'confirmed');
});

test('waitlist: joining is rejected while a seat is still available', () => {
  const { engine } = setup({ totalSeats: 5 });
  const result = engine.joinWaitlist('early@example.com');
  assert.equal(result.success, false);
  assert.equal(result.reasonCode, 'SEATS_AVAILABLE');
});

test('waitlist: a freed seat is automatically offered to the first person in line', () => {
  const { engine, store } = setup({ totalSeats: 2, maxActiveHoldsPerUser: 5, maxHoldsPerUserPerHour: 20 });

  // fill every seat so the event is sold out
  const holdA = engine.placeHold('userA@example.com', 1);
  const holdB = engine.placeHold('userB@example.com', 2);
  assert.equal(holdA.success, true);
  assert.equal(holdB.success, true);

  const waitlistResult = engine.joinWaitlist('waiting@example.com');
  assert.equal(waitlistResult.success, true);
  assert.equal(waitlistResult.data.position, 1);

  // now free up seat 1
  const releaseResult = engine.releaseHold('userA@example.com', holdA.data.code);
  assert.equal(releaseResult.success, true);
  assert.ok(releaseResult.data.promotion, 'expected the waitlisted user to be promoted');
  assert.equal(releaseResult.data.promotion.email, 'waiting@example.com');
  assert.equal(releaseResult.data.promotion.seatNumber, 1);

  // the seat should now be held by the promoted user, not available
  assert.equal(store.getSeat(1).status, 'held');
  // and they should be off the waitlist
  assert.equal(store.isOnWaitlist('waiting@example.com'), false);

  // the promoted hold should be confirmable like any normal hold
  const confirmResult = engine.confirmHold('waiting@example.com', releaseResult.data.promotion.code);
  assert.equal(confirmResult.success, true);
});

test('waitlist: promotion also happens automatically when a hold simply expires', () => {
  const { engine, store, advance } = setup({ totalSeats: 1, maxActiveHoldsPerUser: 5, maxHoldsPerUserPerHour: 20 });

  const holdA = engine.placeHold('firstInLine@example.com', 1);
  engine.joinWaitlist('secondInLine@example.com');

  advance(61_000);
  const expiredList = engine.processExpiries();

  assert.equal(expiredList.length, 1);
  assert.ok(expiredList[0].promotion);
  assert.equal(expiredList[0].promotion.email, 'secondInLine@example.com');
  assert.equal(store.getSeat(1).status, 'held');
  assert.equal(store.getSeat(1).holdCode, expiredList[0].promotion.code);
  // silence the unused var check for holdA - kept for readability of the test
  assert.notEqual(holdA.data.code, expiredList[0].promotion.code);
});

test('the event log can reconstruct what happened to a seat', () => {
  const { engine, store } = setup({ totalSeats: 1 });

  const placed = engine.placeHold('logtest@example.com', 1);
  engine.confirmHold('logtest@example.com', placed.data.code);
  engine.releaseHold('logtest@example.com', placed.data.code);

  const entries = store.getLog(1);
  const types = entries.map((entry) => entry.type);
  assert.deepEqual(types, ['hold_placed', 'hold_confirmed', 'seat_released']);
});
