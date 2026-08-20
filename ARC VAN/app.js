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

function notifyButtonPress(button) {
  const label = (button.textContent || button.getAttribute('aria-label') || button.title || 'Unnamed button').trim();
  const view = button.closest('.view')?.id.replace('-view', '') || 'navigation';
  fetch('/api/button-press', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, view })
  }).catch(() => {});
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) notifyButtonPress(button);
}, true);

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

function setSignupMessage(message, isError = false) {
  if (!signupMessage) return;
  signupMessage.textContent = message;
  signupMessage.classList.toggle('error', isError);
}

if (ntfyDriverQr) ntfyDriverQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=312x312&margin=8&data=${encodeURIComponent(ntfyUrl)}`;
if (ntfyStudentQr) ntfyStudentQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=312x312&margin=8&data=${encodeURIComponent(ntfyUrl)}`;
if (qrUrl) qrUrl.textContent = ntfyUrl;

if (studentSignupForm) {
  studentSignupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = studentSignupForm.elements.name.value.trim();
    const email = studentSignupForm.elements.email.value.trim().toLowerCase();
    if (!name || !email || !studentSignupForm.elements.email.validity.valid) {
      setSignupMessage('Enter your name and a valid email address.', true);
      return;
    }
    fetch('/api/alerts/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    }).then((response) => {
      if (!response.ok) throw new Error('Signup failed');
      const signups = JSON.parse(localStorage.getItem(signupStorageKey) || '[]');
      signups.push({ name, email, signedUpAt: new Date().toISOString(), van: '045/048 Van' });
      localStorage.setItem(signupStorageKey, JSON.stringify(signups));
      studentSignupForm.reset();
      setSignupMessage('You are signed up. We will alert you about 045/048 Van updates.');
    }).catch(() => setSignupMessage('Signup is unavailable right now. Please try again.', true));
  });
}

if (headingToVanForm) {
  headingToVanForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = headingToVanForm.elements.name.value.trim();
    const email = headingToVanForm.elements.email.value.trim().toLowerCase();
    if (!name || !email || !headingToVanForm.elements.email.validity.valid) {
      setHeadingMessage('Enter your name and a valid email address.', true);
      return;
    }
    fetch('/api/student/heading-to-van', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    }).then((response) => {
      if (!response.ok) throw new Error('Request failed');
      headingToVanForm.reset();
      setHeadingMessage('Driver notified! You\'re on the list.');
      updateWalkingCount();
    }).catch(() => setHeadingMessage('Request failed. Please try again.', true));
  });
}

document.querySelectorAll('.student-stop-btn').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.student-stop-btn').forEach((stop) => stop.classList.remove('selected'));
  button.classList.add('selected');
  if (button.dataset.pickup === 'Other') {
    if (otherPickup) otherPickup.classList.add('visible');
    if (otherPickupInput) otherPickupInput.focus();
    return;
  }
  if (otherPickup) otherPickup.classList.remove('visible');
  if (ridePickupInput) ridePickupInput.value = button.dataset.pickup;
}));

const setOtherPickupBtn = document.querySelector('#set-other-pickup');
if (setOtherPickupBtn) {
  setOtherPickupBtn.addEventListener('click', () => {
    const pickup = otherPickupInput.value.trim();
    if (!pickup) {
      otherPickupInput.focus();
      return;
    }
    if (ridePickupInput) ridePickupInput.value = pickup;
    if (otherPickup) otherPickup.classList.remove('visible');
  });
}

if (rideRequestForm) {
  rideRequestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = rideRequestForm.elements.name.value.trim();
    const pickup = ridePickupInput ? ridePickupInput.value : '';
    const dropoff = rideRequestForm.elements.dropoff.value.trim();
    if (!name || !pickup || !dropoff) {
      if (rideRequestMessage) {
        rideRequestMessage.textContent = 'Choose a pickup stop and enter your name and destination.';
        rideRequestMessage.classList.add('error');
      }
      return;
    }
    fetch('/api/request-ride', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pickup, dropoff })
    }).then((response) => {
      if (!response.ok) throw new Error('Request failed');
      return response.json();
    }).then((data) => {
      rideRequestForm.reset();
      document.querySelectorAll('.student-stop-btn').forEach((stop) => stop.classList.remove('selected'));
      if (ridePickupInput) ridePickupInput.value = '';
      if (rideRequestMessage) {
        rideRequestMessage.classList.remove('error');
        rideRequestMessage.textContent = data.status === 'WAITLIST' ? 'Ride requested. You are on the waitlist.' : 'Ride requested. The driver has been notified.';
      }
    }).catch(() => {
      if (rideRequestMessage) {
        rideRequestMessage.textContent = 'Request failed. Please try again.';
        rideRequestMessage.classList.add('error');
      }
    });
  });
}

function setHeadingMessage(message, isError = false) {
  if (!headingMessage) return;
  headingMessage.textContent = message;
  headingMessage.classList.toggle('error', isError);
}

function updateWalkingCount() {
  fetch('/api/status', { cache: 'no-store' })
    .then((response) => response.json())
    .then((data) => {
      if (data.walking_count !== undefined && walkingCount) {
        walkingCount.innerHTML = `${data.walking_count} <small>students</small>`;
      }
    })
    .catch(() => {});
}

function renderDriverRequests(requests) {
  if (!driverRequestList) return;
  driverRequestList.innerHTML = requests.length ? requests.map((request) => `
    <div class="driver-request-entry">
      <div class="request-avatar">${escapeHtml((request[1] || '?').slice(0, 2).toUpperCase())}</div>
      <div class="driver-request-info"><strong>${escapeHtml(request[2])}</strong><span>To ${escapeHtml(request[3])}</span></div>
      <span class="driver-request-status">${escapeHtml(request[4])}</span>
    </div>`).join('') : '<p class="access-empty">No student pickup requests yet.</p>';
}

function pollDriverRequests() {
  if (!isDriverAuthenticated()) return;
  fetch('/api/driver/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: driverPin }),
    cache: 'no-store'
  }).then((response) => response.json()).then((data) => renderDriverRequests(data.requests || [])).catch(() => {});
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

async function sendDriverAlert(title, detail, toastMessage, location = null) {
  const response = await fetch('/api/driver/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      pin: driverPin, 
      current_stop: location || 'North Gate', 
      next_stop: location || 'North Gate', 
      eta_mins: 0, 
      title: title, 
      detail: detail, 
      location: location 
    })
  });
  if (!response.ok) throw new Error('Alert failed');
  showToast(toastMessage);
}

async function pollStudentAlert() {
  try {
    const response = await fetch('/api/alerts/latest', { cache: 'no-store' });
    if (!response.ok) return;
    const alert = await response.json();
    if (!alert.id || alert.id === latestStudentAlertId) return;
    latestStudentAlertId = alert.id;
    if (studentAlertTitle) studentAlertTitle.textContent = displayVanName(alert.title);
    if (studentAlertDetail) studentAlertDetail.textContent = displayVanName(alert.detail);
    if (studentAlertTime) studentAlertTime.textContent = 'Just now';
    const departureMatch = alert.title && alert.title.match(/departs at (.+)$/i);
    if (departureMatch && studentDepartureTime) studentDepartureTime.textContent = departureMatch[1];
    if (alert.location && studentVanLocation) {
      studentVanLocation.textContent = alert.location;
      if (studentVanLocationTime) {
        studentVanLocationTime.textContent = alert.created_at ? `Updated ${formatAlertTime(alert.created_at)}` : 'Updated just now';
      }
    }
  } catch {}
}

pollStudentAlert();
window.setInterval(pollStudentAlert, 5000);

function formatAlertTime(timestamp) {
  const adjustedTimestamp = new Date(new Date(timestamp).getTime() - 4 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(adjustedTimestamp);
}

function loadAccessGrants() {
  try {
    const storedGrants = JSON.parse(localStorage.getItem(accessStorageKey) || '[]');
    return Array.isArray(storedGrants) ? storedGrants.filter((grant) => grant && grant.name && grant.email && grant.grantedAt) : [];
  } catch {
    return [];
  }
}

function formatGrantTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function renderAccessHistory() {
  if (!accessHistory || !accessCount) return;
  const sortedGrants = [...accessGrants].sort((first, second) => new Date(second.grantedAt) - new Date(first.grantedAt));
  accessCount.textContent = `${sortedGrants.length} ${sortedGrants.length === 1 ? 'grant' : 'grants'}`;
  accessHistory.innerHTML = sortedGrants.length ? sortedGrants.map((grant) => `
    <div class="access-entry">
      <div class="request-avatar access-avatar">${escapeHtml(grant.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase())}</div>
      <div class="access-entry-info"><strong>${escapeHtml(grant.name)}</strong><span>${escapeHtml(grant.email)}</span><small>Granted by ${escapeHtml(grant.grantedBy || 'Jordan Miles')}</small></div>
      <div class="access-entry-meta"><span class="access-scope">FULL CONSOLE</span><time datetime="${grant.grantedAt}">${formatGrantTime(grant.grantedAt)}</time></div>
    </div>`).join('') : '<p class="access-empty">No drivers have been granted access yet.</p>';
}

function setAccessMessage(message, isError = false) {
  if (!accessFormMessage) return;
  accessFormMessage.textContent = message;
  accessFormMessage.classList.toggle('error', isError);
}

if (accessForm) {
  accessForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = accessForm.elements.name.value.trim();
    const email = accessForm.elements.email.value.trim().toLowerCase();
    if (!name || !email || !accessForm.elements.email.validity.valid) {
      setAccessMessage('Enter a driver name and a valid email address.', true);
      return;
    }
    if (accessGrants.some((grant) => grant.email.toLowerCase() === email)) {
      setAccessMessage('That driver already has access.', true);
      return;
    }
    const grant = { 
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, 
      name, 
      email, 
      grantedBy: 'Jordan Miles', 
      grantedAt: new Date().toISOString(), 
      permission: 'full-console' 
    };
    accessGrants.push(grant);
    localStorage.setItem(accessStorageKey, JSON.stringify(accessGrants));
    accessForm.reset();
    renderAccessHistory();
    setAccessMessage(`Access granted to ${name}.`);
    showToast(`Driver access granted to ${name}`);
  });
}

function renderRequests() {
  if (!requestList || !requestBadge || !waitingCount) return;
  requestList.innerHTML = requests.map((request) => `
    <div class="request-item">
      <div class="request-avatar ${request.tone}">${request.initials}</div>
      <div class="request-info"><strong>${request.name}</strong><span>${request.route}</span></div>
      <span class="request-time">${request.time}</span>
      <button class="request-alert-btn" data-student="${request.name}" data-pickup="${request.pickup}" title="Alert ${request.name}">Alert student</button>
    </div>`).join('');
  requestBadge.textContent = requests.length;
  waitingCount.innerHTML = `${requests.length} <small>students</small>`;
}

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
  const pageTitle = document.querySelector('#page-title');
  if (pageTitle) {
    pageTitle.innerHTML = view === 'driver' ? 'Monitor the App and be Accurate <span>✦</span>' : 'Your ride, on your time <span>✦</span>';
  }
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));

function showDestinationStep(location) {
  currentVanLocation = location;
  const prompt = document.querySelector('#location-prompt');
  if (prompt) prompt.textContent = `Step 2: The Van is going to... (currently at ${location})`;
  const destControls = document.querySelector('#destination-controls');
  if (destControls) destControls.classList.add('visible');
  const otherLoc = document.querySelector('#other-location');
  if (otherLoc) otherLoc.classList.remove('visible');
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
  const currentLocation = currentVanLocation;
  sendDriverAlert(`045/048 Van is at ${currentLocation}`, `The Van is going to ${destination}.`, `Student alert sent: ${currentLocation} to ${destination}`, currentLocation)
    .then(resetLocationWorkflow)
    .catch(() => showToast('Unable to send student alert'));
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

const announceButton = document.querySelector('#announce-btn');
if (announceButton) {
  announceButton.addEventListener('click', () => sendDriverAlert('Boarding update', 'Students waiting for 045/048 Van may board now.', 'Boarding update sent to students').catch(() => showToast('Unable to send student alert')));
}

document.querySelectorAll('.departure-option').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.departure-option').forEach((option) => option.classList.remove('active'));
  button.classList.add('active');
  if (departureTime) departureTime.textContent = `${button.dataset.wait} min`;
}));

if (departureAlertButton) {
  departureAlertButton.addEventListener('click', () => {
    const activeOption = document.querySelector('.departure-option.active');
    const waitTime = activeOption ? activeOption.dataset.wait : '5';
    const departure = new Date(Date.now() + Number(waitTime) * 60000);
    const departureLabel = departure.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (studentAlertTitle) studentAlertTitle.textContent = `045/048 Van departs at ${departureLabel}`;
    if (studentAlertDetail) studentAlertDetail.textContent = `The driver expects to leave in about ${waitTime} minutes.`;
    if (studentDepartureTime) studentDepartureTime.textContent = departureLabel;
    if (studentAlertTime) studentAlertTime.textContent = 'Just now';
    sendDriverAlert(`045/048 Van departs at ${departureLabel}`, `The driver expects to leave in about ${waitTime} minutes.`, `Students alerted: departure expected at ${departureLabel}`).catch(() => showToast('Unable to send student alert'));
    departureAlertButton.textContent = 'Students alerted';
    departureAlertButton.disabled = true;
    window.setTimeout(() => {
      departureAlertButton.textContent = 'Alert students';
      departureAlertButton.disabled = false;
    }, 3000);
  });
}

function sendAvailabilityAlert(title, detail, toastMessage, button) {
  if (studentAlertTitle) studentAlertTitle.textContent = title;
  if (studentAlertDetail) studentAlertDetail.textContent = detail;
  if (studentAlertTime) studentAlertTime.textContent = 'Just now';
  sendDriverAlert(title, detail, toastMessage).catch(() => showToast('Unable to send student alert'));
  button.classList.add('sent');
  window.setTimeout(() => button.classList.remove('sent'), 3000);
}

if (vanFullReturnButton) {
  vanFullReturnButton.addEventListener('click', () => sendAvailabilityAlert(
    '045/048 Van is currently full',
    'The driver will return for more rides shortly.',
    'Students alerted: the van is full and will be back soon',
    vanFullReturnButton
  ));
}

if (noRidesButton) {
  noRidesButton.addEventListener('click', () => sendAvailabilityAlert(
    'No rides available right now',
    'Please check back later for the next available ride.',
    'Students alerted: no rides are available at this time',
    noRidesButton
  ));
}

if (requestList) {
  requestList.addEventListener('click', (event) => {
    const button = event.target.closest('.request-alert-btn');
    if (!button) return;
    showToast(`Alert sent to ${button.dataset.student}: 045/048 Van is at ${button.dataset.pickup}`);
    button.textContent = 'Alert sent';
    button.disabled = true;
  });
  renderRequests();
}

renderAccessHistory();
updateDriverControls();
pollDriverRequests();
window.setInterval(pollDriverRequests, 5000);
updateWalkingCount();
window.setInterval(updateWalkingCount, 5000);

if (window.location.hash === '#student-signup') {
  switchView('student');
  const signupElem = document.querySelector('#student-signup');
  if (signupElem) signupElem.scrollIntoView({ behavior: 'smooth' });
}