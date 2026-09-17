// All the "tweakable numbers" for the reservation system live in one place.
// I did this on purpose so nobody has to go hunting through the rules engine
// just to change how many seats there are or how long a hold lasts.
// If this ever needs to come from a database or an admin screen instead of
// a plain object, this is the only file that would need to change.

module.exports = {
  // how many seats the event has, numbered 1..totalSeats
  totalSeats: 20,

  // how long (in seconds) a hold stays valid before it expires
  holdExpirySeconds: 60,

  // how many holds a single user can have "in the air" at once (not counting
  // seats they've already confirmed)
  maxActiveHoldsPerUser: 2,

  // how many holds a user is allowed to place in a rolling 60 minute window.
  // this counts holds even if they were later confirmed, released or expired
  maxHoldsPerUserPerHour: 5,

  // how many times a single hold can be extended before it's stuck with its
  // current expiry time
  maxExtensionsPerHold: 2,
};
