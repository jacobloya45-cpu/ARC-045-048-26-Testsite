const requests = [
  { initials: 'AL', name: 'Avery Lee', pickup: 'North Gate', route: 'North Gate → Student Union', time: '4 min ago', tone: '' },
  { initials: 'KS', name: 'Kai Santos', pickup: 'Library entrance', route: 'Library entrance → East Parking', time: '2 min ago', tone: 'yellow' },
  { initials: 'MR', name: 'Maya Rivera', pickup: 'West Residences', route: 'West Residences → Arts Quad', time: 'Just now', tone: 'blue' }
];

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
const ntfyDriverQr = document.querySelector('#ntfy-driver-qr');
const ntfyStudentQr = document.querySelector('#ntfy-student-qr');
const qrUrl = document.querySelector('#qr-url');
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
const driverAuthKey = 'arc-van-driver-auth';
const driverRequestList = document.querySelector('#driver-request-list');

let latestStudentAlertId = 0;
let currentVanLocation = '';
let accessGrants = loadAccessGrants();
const ntfyUrl = 'https://ntfy.sh/ViylM4A5cfMQgIYQ';

function isDriverAuthenticated() {
  return sessionStorage.getItem(driverAuthKey) === 'true';
}

function setDriverAuthenticated(val) {
  if (val) sessionStorage.setItem(driverAuthKey, 'true'); 
  else sessionStorage.removeItem(driverAuthKey);
}

function updateDriverControls() {
  const driverView = document.querySelector('#driver-view');
  if (!driverView) return;
  const controls = driverView.querySelectorAll('.location-btn, .destination-btn, #send-other-alert, #send-destination-other, #announce-btn, .departure-option, #departure-alert-btn, #van-full-return-btn, #no-rides-btn, .request-alert-btn, #access-form button, #driver-name, #driver-email');
  const enabled = isDriverAuthenticated();
  controls.forEach((el) => {
    try { el.disabled = !enabled; } catch (e) {}
    el.classList.toggle('locked', !enabled);
  });
}

function showPinModal(message) {
  const modal = document.querySelector('#driver-pin-modal');
  if (!modal) return;
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
  const err = modal.querySelector('.pin-error');
  if (err) err.textContent = message || '';
  const input = modal.querySelector('.pin-input');
  if (input) { input.value = ''; input.focus(); }
}

function hidePinModal() {
  const modal = document.querySelector('#driver-pin-modal');
  if (!modal) return;
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

window.addEventListener('load', () => {
  updateDriverControls();
  
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.view === 'driver' && !isDriverAuthenticated()) {
        showPinModal('Enter driver PIN to unlock console');
      }
    });
  });

  const modal = document.querySelector('#driver-pin-modal');
  if (modal) {
    modal.querySelector('.pin-submit').addEventListener('click', () => {
      const val = modal.querySelector('.pin-input').value.trim();
      if (val === driverPin) {
        setDriverAuthenticated(true);
        hidePinModal();
        updateDriverControls();
        showToast('Driver console unlocked');
      } else {
        modal.querySelector('.pin-error').textContent = 'Invalid PIN';
        modal.querySelector('.pin-input').focus();
      }
    });
    modal.querySelector('.pin-cancel').addEventListener('click', () => { hidePinModal(); });
    modal.querySelector('.pin-input').addEventListener('keydown', (e) => { 
      if (e.key === 'Enter') modal.querySelector('.pin-submit').click(); 
    });
  }

  const driverView = document.querySelector('#driver-view');
  if (driverView) {
    driverView.addEventListener('click', (e) => {
      if (isDriverAuthenticated()) return;
      const target = e.target.closest('.location-btn, .destination-btn, #send-other-alert, #send-destination-other, #announce-btn, .departure-option, #departure-alert-btn, #van-full-return-btn, #no-rides-btn, .request-alert-btn, #access-form button');
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        showPinModal('Driver PIN required');
      }
    }, true);
  }
});

function displayVanName(text) {
  return (text || '').replace(/Van 02|VAN 02/g, '045/048 Van');
}

if (ntfyDriverQr) ntfyDriverQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=312x312&margin=8&data=${encodeURIComponent(ntfyUrl)}`;
if (ntfyStudentQr) ntfyStudentQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=312x312&margin=8&data=${encodeURIComponent(ntfyUrl)}`;
if (qrUrl) qrUrl.textContent = ntfyUrl;

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
    showToast('Failed to post alert to Ntfy');
  }
}

// Step 1 - Choose Where Van is Now (Broadcasts instantly upon button click)
function showDestinationStep(location) {
  currentVanLocation = location;
  const prompt = document.querySelector('#location-prompt');
  if (prompt) prompt.textContent = `Step 2: The Van is going to... (currently at ${location})`;
  const destControls = document.querySelector('#destination-controls');
  if (destControls) destControls.classList.add('visible');
  const otherLoc = document.querySelector('#other-location');
  if (otherLoc) otherLoc.classList.remove('visible');

  // Immediately send location update to Ntfy
  sendDriverAlert(
    `🚐 Van Location: ${location}`,
    `045/048 Van is currently at ${location}.`,
    `Van location posted: ${location}`,
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

// Step 2 - Send destination update
function sendLocationUpdate(destination) {
  const currentLocation = currentVanLocation || 'Van Route';
  sendDriverAlert(
    `🚐 Van En Route: ${destination}`,
    `The Van is currently at ${currentLocation} and heading to ${destination}.`,
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

// Departure alert button
if (departureAlertButton) {
  departureAlertButton.addEventListener('click', () => {
    const activeOption = document.querySelector('.departure-option.active');
    const waitTime = activeOption ? activeOption.dataset.wait : '5';
    const departure = new Date(Date.now() + Number(waitTime) * 60000);
    const departureLabel = departure.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
    sendDriverAlert(
      `⏱️ 045/048 Van departs at ${departureLabel}`,
      `The driver expects to depart in about ${waitTime} minutes.`,
      `Departure alert sent: ${departureLabel}`
    );
  });
}

// Availability buttons
if (vanFullReturnButton) {
  vanFullReturnButton.addEventListener('click', () => {
    sendDriverAlert(
      '🚐 045/048 Van is currently full',
      'The van is at capacity. The driver will return shortly for more rides.',
      'Alert sent: Van is full'
    );
  });
}

if (noRidesButton) {
  noRidesButton.addEventListener('click', () => {
    sendDriverAlert(
      '🛑 No rides available right now',
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
  window.setTimeout(() => toast.classList.remove('show'), 3000);
}

function switchView(view) {
  document.querySelectorAll('.view').forEach((section) => section.classList.remove('active-view'));
  const targetView = document.querySelector(`#${view}-view`);
  if (targetView) targetView.classList.add('active-view');
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
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

function renderRequests() {
  if (!requestList || !requestBadge || !waitingCount) return;
  requestList.innerHTML = requests.map((request) => `
    <div class="request-item">
      <div class="request-avatar ${request.tone}">${request.initials}</div>
      <div class="request-info"><strong>${request.name}</strong><span>${request.route}</span></div>
      <span class="request-time">${request.time}</span>
      <button class="request-alert-btn" data-student="${request.name}" data-pickup="${request.pickup}">Alert student</button>
    </div>`).join('');
  requestBadge.textContent = requests.length;
  waitingCount.innerHTML = `${requests.length} <small>students</small>`;
}

if (requestList) {
  requestList.addEventListener('click', (event) => {
    const button = event.target.closest('.request-alert-btn');
    if (!button) return;
    sendDriverAlert(
      `🚐 Pickup Alert: ${button.dataset.student}`,
      `045/048 Van is currently at ${button.dataset.pickup} for pickup.`,
      `Alert sent to ${button.dataset.student}`
    );
    button.textContent = 'Alert sent';
    button.disabled = true;
  });
  renderRequests();
}

updateDriverControls();
updateWalkingCount();
window.setInterval(updateWalkingCount, 5000);
