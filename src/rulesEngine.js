// This file is the heart of the whole system. It doesn't know anything
// about Express, HTTP, or the frontend - it just takes a request (like
// "place a hold for this email on this seat"), checks the rules in order,
// and either returns a success with some data, or a failure with a named
// reason so the caller knows exactly which rule got broken.
//
// I passed in "now" as a function instead of calling Date.now() directly
// inside here. That one decision is what makes it possible to test things
// like "does a hold actually expire after 60 seconds" in a few
// milliseconds, by just faking the clock in a test - see test/rulesEngine.test.js.
//
// A quick note on concurrency: because Node runs JavaScript on a single
// thread and none of the functions below ever "await" anything in the
// middle of a check, a whole request (all the checks + the actual write)
// finishes in one go before the next request gets a turn. That's what stops
// two people grabbing the same seat "at the same instant" - they don't
// actually run at the same instant, Node just makes them take turns.

const { generateCode } = require('./holdCode');

function createRulesEngine({ store, config, now }) {
  const engine = {};

  // small helpers so every function below returns results the same shape
  function ok(data) {
    return { success: true, data };
  }
  function fail(reasonCode, message) {
    return { success: false, reasonCode, message };
  }

  engine.placeHold = function placeHold(email, seatNumber, options = {}) {
    const fromWaitlist = Boolean(options.fromWaitlist);
    const nowTs = now();

    if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > config.totalSeats) {
      return fail('SEAT_INVALID', 'That seat number does not exist.');
    }

    const seat = store.getSeat(seatNumber);
    if (seat.status !== 'available') {
      return fail('SEAT_NOT_AVAILABLE', 'That seat is already held or confirmed by someone else.');
    }

    // holds that come from waitlist promotion skip the per-user checks
    // below - the person didn't "ask" for this hold right now, the system
    // is giving it to them because it's their turn
    if (!fromWaitlist) {
      const activeCount = store.countActiveHoldsForUser(email);
      if (activeCount >= config.maxActiveHoldsPerUser) {
        return fail(
          'MAX_ACTIVE_HOLDS',
          `You already have ${config.maxActiveHoldsPerUser} active hold(s). Confirm or release one before placing another.`
        );
      }

      const hourlyCount = store.countHourlyHolds(email, nowTs);
      if (hourlyCount >= config.maxHoldsPerUserPerHour) {
        return fail(
          'HOURLY_LIMIT',
          `You've reached the limit of ${config.maxHoldsPerUserPerHour} hold attempts per hour. Please try again later.`
        );
      }
    }

    // generate a code, and if by pure bad luck it collides with a code
    // that's already in use, just quietly try again - the user never
    // needs to know that happened
    let code = generateCode();
    while (store.isCodeInUse(code)) {
      code = generateCode();
    }

    const hold = {
      code,
      seatNumber,
      email,
      status: 'active',
      createdAt: nowTs,
      expiresAt: nowTs + config.holdExpirySeconds * 1000,
      extensions: 0,
      fromWaitlist,
    };

    store.saveHold(hold);
    store.setSeatStatus(seatNumber, 'held', code);
    if (!fromWaitlist) store.recordHourlyHold(email, nowTs);

    store.appendLog({
      type: fromWaitlist ? 'waitlist_promoted' : 'hold_placed',
      seatNumber,
      email,
      code,
      timestamp: nowTs,
    });

    if (fromWaitlist) {
      // "sending a notification" - for now that just means a clearly
      // formatted line in the server log, good enough for this stage
      // eslint-disable-next-line no-console
      console.log(
        `[NOTIFICATION] ${email} - a seat has opened up for you. Seat ${seatNumber}, hold code ${code}, expires at ${new Date(
          hold.expiresAt
        ).toISOString()}.`
      );
    }

    return ok({ seatNumber, code, expiresAt: hold.expiresAt });
  };

  engine.extendHold = function extendHold(email, code) {
    const hold = store.getHoldByCode(code);
    if (!hold) return fail('HOLD_NOT_FOUND', 'No hold exists with that code.');
    if (hold.email !== email) return fail('EMAIL_MISMATCH', 'That email address does not match this hold.');
    if (hold.status !== 'active') {
      return fail('HOLD_NOT_ACTIVE', 'This hold is no longer active (expired, released or already confirmed).');
    }
    if (hold.extensions >= config.maxExtensionsPerHold) {
      return fail(
        'MAX_EXTENSIONS',
        `This hold has already been extended the maximum of ${config.maxExtensionsPerHold} time(s).`
      );
    }

    const nowTs = now();
    hold.expiresAt = nowTs + config.holdExpirySeconds * 1000;
    hold.extensions += 1;
    store.saveHold(hold);

    store.appendLog({ type: 'hold_extended', seatNumber: hold.seatNumber, email, code, timestamp: nowTs });

    return ok({ seatNumber: hold.seatNumber, expiresAt: hold.expiresAt, extensions: hold.extensions });
  };

  engine.confirmHold = function confirmHold(email, code) {
    const hold = store.getHoldByCode(code);
    if (!hold) return fail('HOLD_NOT_FOUND', 'No hold exists with that code.');
    if (hold.email !== email) return fail('EMAIL_MISMATCH', 'That email address does not match this hold.');

    // this is the idempotent bit - if it's already confirmed under this
    // exact code, just hand back the same success again. no error, no
    // second change to state. this matters because a flaky connection
    // might make someone press "confirm" twice without meaning to
    if (hold.status === 'confirmed') {
      return ok({ seatNumber: hold.seatNumber, code: hold.code, alreadyConfirmed: true });
    }

    if (hold.status !== 'active') {
      return fail(
        'HOLD_NOT_ACTIVE',
        'This hold can no longer be confirmed (it expired or was released). Please place a new hold.'
      );
    }

    const nowTs = now();
    hold.status = 'confirmed';
    hold.expiresAt = null;
    store.saveHold(hold);
    store.setSeatStatus(hold.seatNumber, 'confirmed', hold.code);

    store.appendLog({ type: 'hold_confirmed', seatNumber: hold.seatNumber, email, code, timestamp: nowTs });

    return ok({ seatNumber: hold.seatNumber, code: hold.code, alreadyConfirmed: false });
  };

  engine.releaseHold = function releaseHold(email, code) {
    const hold = store.getHoldByCode(code);
    if (!hold) return fail('HOLD_NOT_FOUND', 'No hold exists with that code.');
    if (hold.email !== email) return fail('EMAIL_MISMATCH', 'That email address does not match this hold.');
    if (hold.status !== 'active' && hold.status !== 'confirmed') {
      return fail('HOLD_NOT_RELEASABLE', 'This hold or seat has already been released or has expired.');
    }

    const nowTs = now();
    const seatNumber = hold.seatNumber;
    hold.status = 'released';
    hold.expiresAt = null;
    store.saveHold(hold);
    store.setSeatStatus(seatNumber, 'available', null);

    store.appendLog({ type: 'seat_released', seatNumber, email, code, timestamp: nowTs });

    const promotion = engine._promoteWaitlistFor(seatNumber, nowTs);

    return ok({ seatNumber, promotion });
  };

  engine.joinWaitlist = function joinWaitlist(email) {
    const anySeatAvailable = store.getAllSeats().some((seat) => seat.status === 'available');
    if (anySeatAvailable) {
      return fail('SEATS_AVAILABLE', 'A seat is currently available - please place a hold instead of joining the waitlist.');
    }
    if (store.isOnWaitlist(email)) {
      return fail('ALREADY_ON_WAITLIST', 'You are already on the waitlist.');
    }
    if (store.hasActiveHoldOrConfirmedSeat(email)) {
      return fail('HAS_ACTIVE_HOLD_OR_SEAT', 'You already have an active hold or a confirmed seat.');
    }

    const nowTs = now();
    store.addToWaitlist(email);
    store.appendLog({ type: 'waitlist_joined', email, timestamp: nowTs });

    return ok({ position: store.getWaitlistPosition(email) });
  };

  // called by the background timer every second or two. finds every hold
  // whose time is up and expires it, then tries to promote the waitlist
  // for each seat that just freed up
  engine.processExpiries = function processExpiries() {
    const nowTs = now();
    const expired = store.getActiveHoldsExpiringBefore(nowTs);
    const results = [];

    for (const hold of expired) {
      hold.status = 'expired';
      hold.expiresAt = null;
      store.saveHold(hold);
      store.setSeatStatus(hold.seatNumber, 'available', null);

      store.appendLog({
        type: 'hold_expired',
        seatNumber: hold.seatNumber,
        email: hold.email,
        code: hold.code,
        timestamp: nowTs,
      });

      const promotion = engine._promoteWaitlistFor(hold.seatNumber, nowTs);
      results.push({ seatNumber: hold.seatNumber, email: hold.email, promotion });
    }

    return results;
  };

  // internal helper, not part of the public API surface used by routes.
  // assumes the given seat has *just* become available.
  engine._promoteWaitlistFor = function _promoteWaitlistFor(seatNumber) {
    if (store.getWaitlist().length === 0) return null;

    const nextEmail = store.popFirstFromWaitlist();
    const result = engine.placeHold(nextEmail, seatNumber, { fromWaitlist: true });

    if (!result.success) {
      // this shouldn't really happen since the seat is free and waitlist
      // promotion skips the hourly limit, but just in case someone on the
      // waitlist picked up an active hold elsewhere in the meantime and is
      // now over their active-hold limit, skip them and try the next
      // person instead of leaving the seat stuck
      return engine._promoteWaitlistFor(seatNumber);
    }

    return { email: nextEmail, seatNumber, code: result.data.code, expiresAt: result.data.expiresAt };
  };

  return engine;
}

module.exports = { createRulesEngine };
