const requestList = document.querySelector('#request-list');
const waitingCount = document.querySelector('#waiting-count');
const walkingCount = document.querySelector('#walking-count');
const requestBadge = document.querySelector('#request-badge');
const toast = document.querySelector('#toast');
const departureTime = document.querySelector('#departure-time');
const departureAlertButton = document.querySelector('#departure-alert-btn');
const studentAlertTitle = document.querySelector('#student-alert-title');
const studentAlertDetail = document.querySelector('#student-alert-detail');
const studentAlertTime = document.querySelector('#student-alert-time');
const studentDepartureTime = document.querySelector('#student-departure-time');
const studentVanLocation = document.querySelector('#student-van-location');
const studentVanLocationTime = document.querySelector('#student-van-location-time');
const vanFullReturnButton = document.querySelector('#van-full-return-btn');
const noRidesButton = document.querySelector('#no-rides-btn');
const accessForm = document.querySelector('#access-form');
const accessHistory = document.querySelector('#access-history');
const accessCount = document.querySelector('#access-count');
const accessFormMessage = document.querySelector('#access-form-message');
const accessStorageKey = 'arc-van-driver-access';
const studentSignupForm = document.querySelector('#student-signup-form');
const signupMessage = document.querySelector('#signup-message');
const signupStorageKey = 'arc-van-alert-signups';
const headingToVanForm = document.querySelector('#heading-to-van-form');
const headingMessage = document.querySelector('#heading-message');
const rideRequestForm = document.querySelector('#ride-request-form');
const rideRequestMessage = document.querySelector('#ride-request-message');
const ridePickupInput = document.querySelector('#ride-pickup');
const otherPickup = document.querySelector('#other-pickup');
const otherPickupInput = document.querySelector('#other-pickup-input');
const driverPin = '045048';
const driverRequestList = document.querySelector('#driver-request-list');

let latestStudentAlertId = 0;
let currentVanLocation = '';
let accessGrants = loadAccessGrants();
let socket = null;

// Audio context for native ding sound
function playAlertTone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

// --- Native WebSocket Connection ---
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/alerts`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('✅ Connected to Native WebSocket Alerts');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'NEW_ALERT') {
        renderReceivedAlert(data.alert);
      } else if (data.type === 'WALKING_UPDATE') {
        if (walkingCount) walkingCount.innerHTML = `${data.count} <small>students</small>`;
      } else if (data.type === 'NEW_RIDE_REQUEST') {
        pollDriverRequests();
        showToast(`New Ride: ${data.name} (${data.pickup} → ${data.dropoff})`);
      }
    } catch (err) {
      console.error('Socket message parse error', err);
    }
  };

  socket.onclose = () => {
    console.log('⚠️ WebSocket disconnected. Reconnecting in 2s...');
    setTimeout(initWebSocket, 2000);
  };
}

function renderReceivedAlert(alert) {
  playAlertTone();
  if (studentAlertTitle) studentAlertTitle.textContent = displayVanName(alert.title);
  if (studentAlertDetail) studentAlertDetail.textContent = displayVanName(alert.detail);
  if (studentAlertTime) studentAlertTime.textContent = 'Just now';

  const departureMatch = alert.title && alert.title.match(/departs at (.+)$/i);
  if (departureMatch && studentDepartureTime) {
    studentDepartureTime.textContent = departureMatch[1];
  }

  if (alert.location && studentVanLocation) {
    studentVanLocation.textContent = alert.location;
    if (studentVanLocationTime) studentVanLocationTime.textContent = 'Updated just now';
  }

  showToast(`🚐 ${alert.title}`);
}

function displayVanName(text) {
  return (text || '').replace(/Van 02|VAN 02/g, '045/048 Van');
}

function updateDriverControls() {
  const driverView = document.querySelector('#driver-view');
  if (!driverView) return;
  const controls = driverView.querySelectorAll('.location-btn, .destination-btn, #send-other-alert, #send-destination-other, #announce-btn, .departure-option, #departure-alert-btn, #van-full-return-btn, #no-rides-btn, .request-alert-btn, #access-form button, #driver-name, #driver-email');
  controls.forEach((el) => {
    try { el.disabled = false; } catch (e) {}
    el.classList.remove('locked');
  });
}

window.addEventListener('load', () => {
  switchView('student');
  updateDriverControls();
  initWebSocket();
});

async function sendDriverAlert(title, detail, toastMessage, location = null) {
  try {
    const response = await fetch('/api/driver/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        pin: driverPin, 
        current_stop: location || currentVanLocation || 'Shuttle Route', 
        next_stop: location || 'Shuttle Route', 
        eta_mins: 0, 
        title: title, 
        detail: detail, 
        location: location || currentVanLocation 
      })
    });
    if (!response.ok) throw new Error('Alert failed');
    showToast(toastMessage);
  } catch (err) {
    showToast('Failed to broadcast alert');
  }
}

function showDestinationStep(location) {
  currentVanLocation = location;
  const prompt = document.querySelector('#location-prompt');
  if (prompt) prompt.textContent = `Step 2: The Van is going to... (currently at ${location})`;
  const destControls = document.querySelector('#destination-controls');
  if (destControls) destControls.classList.add('visible');
  const otherLoc = document.querySelector('#other-location');
  if (otherLoc) otherLoc.classList.remove('visible');

  sendDriverAlert(
    `045/048 Van is at ${location}`,
    `045/048 Van has arrived at ${location}.`,
    `Van location sent: ${location}`,
    location
  );
}

function resetLocationWorkflow() {
  currentVanLocation = '';
  const prompt = document.querySelector('#location-prompt');
  if (prompt) prompt.textContent = 'Step 1: Choose where the Van is now.';
  const destControls = document.querySelector('#destination-controls');
  if (destControls) destControls.classList.remove('visible');
  const otherLoc = document.querySelector('#other-location');
  if (otherLoc) otherLoc.classList.remove('visible');
  const otherDest = document.querySelector('#other-destination');
  if (otherDest) otherDest.classList.remove('visible');
  const otherLocInput = document.querySelector('#other-location-input');
  if (otherLocInput) otherLocInput.value = '';
  const otherDestInput = document.querySelector('#other-destination-input');
  if (otherDestInput) otherDestInput.value = '';
}

function sendLocationUpdate(destination) {
  const currentLocation = currentVanLocation || 'Van Route';
  sendDriverAlert(
    `045/048 Van En Route to ${destination}`,
    `The Van is leaving ${currentLocation} and heading to ${destination}.`,
    `Alert sent: Heading to ${destination}`,
    currentLocation
  ).then(resetLocationWorkflow);
}

document.querySelectorAll('.location-btn').forEach((button) => button.addEventListener('click', () => {
  resetDriverCounts();
  const otherLocation = document.querySelector('#other-location');
  if (button.dataset.location === 'Other') {
    if (otherLocation) {
      otherLocation.classList.toggle('visible');
      if (otherLocation.classList.contains('visible')) {
        const input = document.querySelector('#other-location-input');
        if (input) input.focus();
      }
    }
    return;
  }
  showDestinationStep(button.dataset.location);
}));

const sendOtherAlertBtn = document.querySelector('#send-other-alert');
if (sendOtherAlertBtn) {
  sendOtherAlertBtn.addEventListener('click', () => {
    resetDriverCounts();
    const input = document.querySelector('#other-location-input');
    const location = input ? input.value.trim() : '';
    if (!location) {
      if (input) input.focus();
      return;
    }
    showDestinationStep(location);
  });
}

document.querySelectorAll('.destination-btn').forEach((button) => button.addEventListener('click', () => {
  resetDriverCounts();
  const otherDestination = document.querySelector('#other-destination');
  if (button.dataset.location === 'Other') {
    if (otherDestination) {
      otherDestination.classList.toggle('visible');
      if (otherDestination.classList.contains('visible')) {
        const input = document.querySelector('#other-destination-input');
        if (input) input.focus();
      }
    }
    return;
  }
  sendLocationUpdate(button.dataset.location);
}));

const sendDestOtherBtn = document.querySelector('#send-destination-other');
if (sendDestOtherBtn) {
  sendDestOtherBtn.addEventListener('click', () => {
    resetDriverCounts();
    const input = document.querySelector('#other-destination-input');
    const destination = input ? input.value.trim() : '';
    if (!destination) {
      if (input) input.focus();
      return;
    }
    sendLocationUpdate(destination);
  });
}

if (departureAlertButton) {
  departureAlertButton.addEventListener('click', () => {
    const activeOption = document.querySelector('.departure-option.active');
    const waitTime = activeOption ? activeOption.dataset.wait : '5';
    const departure = new Date(Date.now() + Number(waitTime) * 60000);
    const departureLabel = departure.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
    sendDriverAlert(
      `045/048 Van departs at ${departureLabel}`,
      `The driver expects to depart in about ${waitTime} minutes.`,
      `Departure alert sent: ${departureLabel}`
    );
  });
}

if (vanFullReturnButton) {
  vanFullReturnButton.addEventListener('click', () => {
    sendDriverAlert(
      '045/048 Van is currently full',
      'The van is at capacity. The driver will return shortly for more rides.',
      'Alert sent: Van is full'
    );
  });
}

if (noRidesButton) {
  noRidesButton.addEventListener('click', () => {
    sendDriverAlert(
      'No rides available right now',
      'Service is paused. Please check back later for the next available ride.',
      'Alert sent: Service paused'
    );
  });
}

document.querySelectorAll('.departure-option').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.departure-option').forEach((option) => option.classList.remove('active'));
  button.classList.add('active');
  if (departureTime) departureTime.textContent = `${button.dataset.wait} min`;
}));

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3500);
}

function switchView(view) {
  document.querySelectorAll('.view').forEach((section) => section.classList.remove('active-view'));
  const targetView = document.querySelector(`#${view}-view`);
  if (targetView) targetView.classList.add('active-view');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const pageTitle = document.querySelector('#page-title');
  if (pageTitle) {
    pageTitle.innerHTML = view === 'driver' ? 'Monitor the App and be Accurate <span>✦</span>' : 'Your ride, on your time <span>✦</span>';
  }
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));

function updateWalkingCount() {
  fetch('/api/status', { cache: 'no-store' })
    .then((res) => res.json())
    .then((data) => {
      if (data.walking_count !== undefined && walkingCount) {
        walkingCount.innerHTML = `${data.walking_count} <small>students</small>`;
      }
    })
    .catch(() => {});
}

function resetDriverCounts() {
  if (waitingCount) waitingCount.innerHTML = '0 <small>students</small>';
  if (walkingCount) walkingCount.innerHTML = '0 <small>students</small>';
  fetch('/api/driver/clear-walking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: driverPin, request_id: 0, new_status: '' })
  }).catch(() => {});
}

function loadAccessGrants() {
  try {
    const stored = JSON.parse(localStorage.getItem(accessStorageKey) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function renderDriverRequests(requests) {
  if (!driverRequestList) return;
  driverRequestList.innerHTML = requests.length ? requests.map((request) => `
    <div class="driver-request-entry">
      <div class="request-avatar">${(request[1] || '?').slice(0, 2).toUpperCase()}</div>
      <div class="driver-request-info"><strong>${request[2]}</strong><span>To ${request[3]}</span></div>
      <span class="driver-request-status">${request[4]}</span>
    </div>`).join('') : '<p class="access-empty">No student pickup requests yet.</p>';
}

function pollDriverRequests() {
  fetch('/api/driver/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: driverPin }),
    cache: 'no-store'
  }).then((res) => res.json()).then((data) => renderDriverRequests(data.requests || [])).catch(() => {});
}

// Student form events
if (headingToVanForm) {
  headingToVanForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = headingToVanForm.elements.name.value.trim();
    const email = headingToVanForm.elements.email.value.trim().toLowerCase();
    if (!name || !email) return;
    fetch('/api/student/heading-to-van', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    }).then(() => {
      headingToVanForm.reset();
      showToast("Driver notified you're heading to the van!");
      updateWalkingCount();
    });
  });
}

if (rideRequestForm) {
  rideRequestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = rideRequestForm.elements.name.value.trim();
    const pickup = ridePickupInput ? ridePickupInput.value : '';
    const dropoff = rideRequestForm.elements.dropoff.value.trim();
    if (!name || !pickup || !dropoff) return;
    fetch('/api/request-ride', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pickup, dropoff })
    }).then(() => {
      rideRequestForm.reset();
      showToast('Ride requested successfully!');
    });
  });
}

document.querySelectorAll('.student-stop-btn').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.student-stop-btn').forEach((stop) => stop.classList.remove('selected'));
  button.classList.add('selected');
  if (ridePickupInput) ridePickupInput.value = button.dataset.pickup;
}));

updateWalkingCount();
