// Logic for the "manage a hold" screen: extend, confirm, release.
// Same pattern as the seat map - call the API, show whatever it says back.

const emailInput = document.getElementById('email-input');
const codeInput = document.getElementById('code-input');
const extendButton = document.getElementById('extend-button');
const confirmButton = document.getElementById('confirm-button');
const releaseButton = document.getElementById('release-button');
const actionMessage = document.getElementById('action-message');

function showMessage(text, type) {
  actionMessage.innerHTML = `<div class="message ${type}">${text}</div>`;
}

function getEmailAndCode() {
  const email = emailInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  return { email, code };
}

function validateInputs(email, code) {
  if (!email) {
    showMessage('Please enter your email.', 'error');
    return false;
  }
  if (!code) {
    showMessage('Please enter your hold code.', 'error');
    return false;
  }
  return true;
}

// one shared function for the three actions since they all work the same
// way - just the URL and the success message differ
async function callHoldAction(action, successMessageFn) {
  const { email, code } = getEmailAndCode();
  if (!validateInputs(email, code)) return;

  const response = await fetch(`/api/holds/${code}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await response.json();

  if (response.ok) {
    showMessage(successMessageFn(body.data), 'success');
  } else {
    // the message from the server already says exactly which rule was
    // broken, so I just show it straight through
    showMessage(body.error.message, 'error');
  }
}

extendButton.addEventListener('click', () => {
  callHoldAction('extend', (data) => {
    const expiryTime = new Date(data.expiresAt).toLocaleTimeString();
    return `Hold extended. It now expires at ${expiryTime} (extension ${data.extensions} used).`;
  });
});

confirmButton.addEventListener('click', () => {
  callHoldAction('confirm', (data) =>
    data.alreadyConfirmed
      ? `Seat ${data.seatNumber} was already confirmed for you - nothing changed.`
      : `Seat ${data.seatNumber} is now confirmed. It's yours until you release it.`
  );
});

releaseButton.addEventListener('click', () => {
  callHoldAction('release', (data) => `Seat ${data.seatNumber} has been released and is available again.`);
});
