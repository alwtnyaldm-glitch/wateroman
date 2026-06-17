const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Get all visitors
router.get('/', async (req, res) => {
  try {
    const { online, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM visitors';
    const params = [];
    
    if (online === 'true') {
      query += ' WHERE is_online = true';
    }
    
    query += ' ORDER BY last_activity DESC LIMIT $1 OFFSET $2';
    params.push(limit, (page - 1) * limit);
    
    const result = await pool.query(query, params);
    res.json({ success: true, visitors: result.rows });
  } catch (error) {
    console.error('Error fetching visitors:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get single visitor
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await pool.query(
      'SELECT * FROM visitors WHERE session_id = $1',
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor not found' });
    }
    
    res.json({ success: true, visitor: result.rows[0] });
  } catch (error) {
    console.error('Error fetching visitor:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Check if visitor is banned
router.get('/check-ban/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const ip = req.ip || req.headers['x-forwarded-for'];
    
    const result = await pool.query(
      'SELECT * FROM banned_users WHERE (session_id = $1 OR ip_address = $2) AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1',
      [sessionId, ip]
    );
    
    if (result.rows.length > 0) {
      res.json({ 
        success: true, 
        banned: true, 
        message: result.rows[0].custom_message || 'تم حظرك من الموقع' 
      });
    } else {
      res.json({ success: true, banned: false });
    }
  } catch (error) {
    console.error('Error checking ban:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
