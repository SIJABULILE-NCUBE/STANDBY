# Standby

A small event ticketing feature: an event has a fixed number of seats, users
can place a temporary hold on a seat and confirm it before the hold expires,
and if the event is sold out they can join a waitlist and be given a seat
automatically when one frees up.

## Project structure

```
src/
  config.js        all the tweakable numbers in one place
  holdCode.js       generates the 6-character hold codes
  store.js          in-memory storage for seats, holds, waitlist, event log
  rulesEngine.js     every business rule lives here, nothing else does
  responses.js       shared helper for consistent API success/error replies
  timer.js           background job that checks for expired holds
  server.js           wires everything together and serves the frontend
  routes/
    seats.js         GET seat list, POST place a hold
    holds.js          POST extend / confirm / release a hold
    waitlist.js        POST join the waitlist
    log.js             GET the event log
public/
  index.html         seat map screen
  manage.html         manage-a-hold screen
  log.html             event log screen
  css/style.css        one shared stylesheet (gold / ivory / white theme)
  js/                    one script per screen
test/
  rulesEngine.test.js  automated tests for the business rules
```

## Running it

```
npm install
npm start
```

Then open `http://localhost:3000` in a browser. The three screens are:

- `/index.html` - seat map, place a hold or join the waitlist
- `/manage.html` - extend, confirm or release a hold using your email and hold code
- `/log.html` - the append-only event log, filterable by seat number

## Running the tests

```
npm test
```

This uses Node's built-in test runner (`node --test`), no extra test
framework needed. The tests talk directly to the rules engine (no HTTP
involved) and use a fake clock, so things like "a hold expires after 60
seconds" run instantly instead of actually waiting a minute. Covered:

- hold code format, allowed characters, and uniqueness
- expiry
- the max-active-holds and max-holds-per-hour limits
- extension limits
- idempotent confirmation
- waitlist promotion, both from a manual release and from an automatic expiry
- the event log matching what actually happened to a seat

## Changing the configuration

Every tweakable number lives in `src/config.js`:

| Setting                     | Default |
| ---------------------------- | ------- |
| `totalSeats`                  | 20      |
| `holdExpirySeconds`           | 60      |
| `maxActiveHoldsPerUser`       | 2       |
| `maxHoldsPerUserPerHour`      | 5       |
| `maxExtensionsPerHold`        | 2       |

Edit the values in that file and restart the server - nothing else needs to
change, since every rule reads from this same object instead of hardcoding
a number of its own.

## Design notes

**Separation of concerns.** `rulesEngine.js` contains every decision the
system makes and nothing else - no Express, no database calls, no `Date.now()`
calls. It's given the current state, a request, and the current time, and it
returns either a success or a named failure reason. The route files in
`src/routes/` only translate HTTP requests into calls on the engine and turn
the result into a JSON response; they never decide anything themselves.

**Time.** The engine never reads the clock itself - it's handed a `now`
function when it's created. In production that's `() => Date.now()`, but in
the tests it's a fake clock I can move forward by hand. That's what makes it
possible to test a 60-second expiry, a 2-extension limit and an hourly rate
limit without ever actually waiting.

**Concurrency.** Two requests for the same seat "at the same instant" are
handled safely because of how Node itself works: all the code in
`rulesEngine.js` is synchronous (no `await` in the middle of a check), so a
single request runs start to finish - check the seat, decide, write the new
state - before the event loop gives the next request a turn. There's no
window where two requests can both pass the "is this seat available" check
before either one writes the new status. If this ever needed to run on more
than one server, that guarantee would no longer hold, since two different
processes each have their own single thread - at that point the seat status
would need to move into something like a database, using a row lock or a
conditional "update where status = available" write so only one process's
update wins.

**Swapping in a real database.** `store.js` is the only file that touches the
actual data (right now, plain `Map`s and arrays in memory). It exposes a set
of small, specific methods (`getSeat`, `saveHold`, `appendLog`, and so on)
rather than exposing its internal data structures. `rulesEngine.js` only ever
calls those methods - it never reaches into `store.js`'s internals. So
swapping the in-memory `Map`s for real database queries would mean rewriting
`store.js` (and probably making its methods `async`, with matching `await`s
in the engine), but the actual rules - the max-holds check, the expiry logic,
the waitlist promotion order - wouldn't need to change at all.

**State vs. the event log.** `store.js` keeps two different things: the
*current* state of each seat (available/held/confirmed, who holds it, when it
expires) and a separate, append-only *log* of every event that ever happened.
The current state is what the seat map and the manage-hold screen need to
answer "can this action happen right now". The log is what lets a dispute
("I confirmed my seat and it says I don't have it") be resolved by replaying
history, and it's also just a straightforward audit trail. Neither one can
stand in for the other - current state alone tells you where things are, not
how they got there.

**Waitlist promotion.** A promoted hold follows every rule a manually placed
hold does - it can be extended (up to the same limit), confirmed
(idempotently, same as any other), or it can expire. It's exempt from the
hourly rate limit specifically, since the user didn't ask for that hold at
that moment, the system handed it to them. If a promoted hold expires without
being confirmed, the seat is offered to the next person on the waitlist, and
the original user is not automatically re-added - they'd need to join again
if they still want a seat. That's a deliberate trade-off: it keeps the
waitlist moving instead of letting one unresponsive person block everyone
behind them, at the cost of that person having to act again if they still
want in.
