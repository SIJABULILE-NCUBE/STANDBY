// Logic for the seat map screen. This file only ever talks to the API and
// updates the page - it doesn't decide whether a hold is allowed, the
// server does that. If the server says no, I just show the reason back to
// the person.

const seatGrid = document.getElementById('seat-grid');
const emailInput = document.getElementById('email-input');
const holdButton = document.getElementById('hold-button');
const waitlistButton = document.getElementById('waitlist-button');
const actionMessage = document.getElementById('action-message');

// I keep track of which seat is currently clicked so the "hold" button
// knows what to send
let selectedSeatNumber = null;

// how often to re-fetch the seat list, in ms. this is what makes expiries
// show up on screen without the user having to refresh the page
const POLL_INTERVAL_MS = 2000;

function showMessage(text, type) {
  actionMessage.innerHTML = `<div class="message ${type}">${text}</div>`;
}

function clearMessage() {
  actionMessage.innerHTML = '';
}

async function fetchSeats() {
  const response = await fetch('/api/seats');
  const body = await response.json();
  return body.data.seats;
}

function renderSeats(seats) {
  seatGrid.innerHTML = '';

  let anyAvailable = false;

  seats.forEach((seat) => {
    if (seat.status === 'available') anyAvailable = true;

    const seatEl = document.createElement('div');
    seatEl.className = `seat ${seat.status}`;
    if (seat.number === selectedSeatNumber) seatEl.classList.add('selected');
    seatEl.textContent = seat.number;
    seatEl.title = `Seat ${seat.number} - ${seat.status}`;

    // only available seats can actually be clicked to select
    if (seat.status === 'available') {
      seatEl.addEventListener('click', () => {
        selectedSeatNumber = seat.number;
        renderSeats(seats); // redraw so the "selected" outline shows up
        holdButton.disabled = false;
      });
    }

    seatGrid.appendChild(seatEl);
  });

  // toggle the waitlist button depending on whether the event is sold out
  waitlistButton.style.display = anyAvailable ? 'none' : 'inline-block';

  // if the seat we had selected just got taken by someone else (or
  // expired away from under us), deselect it
  if (selectedSeatNumber !== null) {
    const stillAvailable = seats.some((s) => s.number === selectedSeatNumber && s.status === 'available');
    if (!stillAvailable) {
      selectedSeatNumber = null;
      holdButton.disabled = true;
    }
  }
}

async function refreshSeats() {
  const seats = await fetchSeats();
  renderSeats(seats);
}

holdButton.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showMessage('Please enter your email first.', 'error');
    return;
  }
  if (selectedSeatNumber === null) {
    showMessage('Please select a seat first.', 'error');
    return;
  }

  const response = await fetch(`/api/seats/${selectedSeatNumber}/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await response.json();

  if (response.ok) {
    showMessage(
      `Seat ${body.data.seatNumber} is held for you. Your hold code is <strong>${body.data.code}</strong> - go to "Manage Hold" to confirm it before it expires.`,
      'success'
    );
    selectedSeatNumber = null;
    holdButton.disabled = true;
  } else {
    showMessage(body.error.message, 'error');
  }

  refreshSeats();
});

waitlistButton.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    showMessage('Please enter your email first.', 'error');
    return;
  }

  const response = await fetch('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await response.json();

  if (response.ok) {
    showMessage(
      `You're on the waitlist at position ${body.data.position}. We'll hold a seat for you automatically once one frees up.`,
      'success'
    );
  } else {
    showMessage(body.error.message, 'error');
  }
});

// clear any leftover message whenever the person starts typing a new email
emailInput.addEventListener('input', clearMessage);

// first paint, then keep polling so the grid stays in sync with expiries
refreshSeats();
setInterval(refreshSeats, POLL_INTERVAL_MS);
