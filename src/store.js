// This is where the actual data lives. Right now everything is kept in
// memory (plain Maps and arrays), which is fine for one running server and
// makes the whole thing easy to test.
//
// I kept every method here really "dumb" - it just reads or writes data,
// it never decides whether something is ALLOWED to happen. All of those
// decisions live in rulesEngine.js instead. That split is what would let
// someone swap this file out for a real database later (Postgres, whatever)
// without having to touch a single rule.

function createStore(config) {
  // seatNumber -> { number, status: 'available' | 'held' | 'confirmed', holdCode }
  const seats = new Map();
  for (let seatNumber = 1; seatNumber <= config.totalSeats; seatNumber++) {
    seats.set(seatNumber, { number: seatNumber, status: 'available', holdCode: null });
  }

  // holdCode -> hold object. I never delete from this map, even once a hold
  // is released/expired/confirmed - I just flip its status. That way a code
  // that already had a life can still be looked up (so we can tell the user
  // "that code is no longer valid" instead of "that code doesn't exist").
  const holds = new Map();

  // plain array of emails, first in line is index 0
  const waitlist = [];

  // email -> array of millisecond timestamps, one per hold they've placed.
  // used only for the "X holds per hour" rule
  const hourlyHistory = new Map();

  // append-only event log. every entry just gets pushed, never edited.
  const log = [];

  return {
    // ---- seats ----
    getSeat(seatNumber) {
      return seats.get(seatNumber);
    },
    getAllSeats() {
      return Array.from(seats.values());
    },
    setSeatStatus(seatNumber, status, holdCode) {
      const seat = seats.get(seatNumber);
      seat.status = status;
      seat.holdCode = holdCode;
    },

    // ---- holds ----
    getHoldByCode(code) {
      return holds.get(code);
    },
    saveHold(hold) {
      holds.set(hold.code, hold);
    },
    // a code counts as "in use" only while its hold is still active or
    // confirmed - once a hold ends its code is free to be reused later
    isCodeInUse(code) {
      const hold = holds.get(code);
      return Boolean(hold) && (hold.status === 'active' || hold.status === 'confirmed');
    },
    countActiveHoldsForUser(email) {
      let count = 0;
      for (const hold of holds.values()) {
        if (hold.email === email && hold.status === 'active') count++;
      }
      return count;
    },
    hasActiveHoldOrConfirmedSeat(email) {
      for (const hold of holds.values()) {
        if (hold.email === email && (hold.status === 'active' || hold.status === 'confirmed')) {
          return true;
        }
      }
      return false;
    },
    getActiveHoldsExpiringBefore(timestamp) {
      const expired = [];
      for (const hold of holds.values()) {
        if (hold.status === 'active' && hold.expiresAt !== null && hold.expiresAt < timestamp) {
          expired.push(hold);
        }
      }
      return expired;
    },

    // ---- hourly rate limit history ----
    recordHourlyHold(email, timestamp) {
      if (!hourlyHistory.has(email)) hourlyHistory.set(email, []);
      hourlyHistory.get(email).push(timestamp);
    },
    countHourlyHolds(email, nowTimestamp) {
      const oneHourAgo = nowTimestamp - 60 * 60 * 1000;
      const timestamps = hourlyHistory.get(email) || [];
      return timestamps.filter((t) => t > oneHourAgo).length;
    },

    // ---- waitlist ----
    isOnWaitlist(email) {
      return waitlist.includes(email);
    },
    addToWaitlist(email) {
      waitlist.push(email);
    },
    popFirstFromWaitlist() {
      return waitlist.shift();
    },
    getWaitlist() {
      // returning a copy so nobody outside can mess with the real array
      return [...waitlist];
    },
    getWaitlistPosition(email) {
      const index = waitlist.indexOf(email);
      return index === -1 ? null : index + 1;
    },

    // ---- event log ----
    appendLog(entry) {
      log.push({ id: log.length + 1, ...entry });
    },
    getLog(seatNumber) {
      if (seatNumber === undefined || seatNumber === null) return [...log];
      return log.filter((entry) => entry.seatNumber === seatNumber);
    },
  };
}

module.exports = { createStore };
