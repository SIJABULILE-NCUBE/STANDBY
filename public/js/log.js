// Logic for the read-only event log screen.

const tableBody = document.getElementById('log-table-body');
const emptyState = document.getElementById('empty-state');
const seatFilterInput = document.getElementById('seat-filter');
const filterButton = document.getElementById('filter-button');
const clearFilterButton = document.getElementById('clear-filter-button');

// turns "hold_placed" into "Hold placed", just so the table reads nicely
function formatEventType(type) {
  const withSpaces = type.replace(/_/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

async function fetchLog(seatNumber) {
  const url = seatNumber ? `/api/log?seat=${encodeURIComponent(seatNumber)}` : '/api/log';
  const response = await fetch(url);
  const body = await response.json();
  return body.data.entries;
}

function renderLog(entries) {
  tableBody.innerHTML = '';

  if (entries.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  // newest first is usually more useful to look at, but the log itself
  // stays chronological in storage - I'm just reversing it for display
  const rows = [...entries].reverse();

  rows.forEach((entry) => {
    const row = document.createElement('tr');
    const time = new Date(entry.timestamp).toLocaleString();

    row.innerHTML = `
      <td>${entry.id}</td>
      <td>${time}</td>
      <td>${formatEventType(entry.type)}</td>
      <td>${entry.seatNumber ?? '-'}</td>
      <td>${entry.email ?? '-'}</td>
      <td class="hold-code">${entry.code ?? '-'}</td>
    `;
    tableBody.appendChild(row);
  });
}

async function loadLog(seatNumber) {
  const entries = await fetchLog(seatNumber);
  renderLog(entries);
}

filterButton.addEventListener('click', () => {
  const value = seatFilterInput.value.trim();
  loadLog(value ? Number(value) : undefined);
});

clearFilterButton.addEventListener('click', () => {
  seatFilterInput.value = '';
  loadLog();
});

// first paint, then just poll every couple of seconds so new entries show
// up without needing a manual refresh
loadLog();
setInterval(() => {
  const value = seatFilterInput.value.trim();
  loadLog(value ? Number(value) : undefined);
}, 2000);
