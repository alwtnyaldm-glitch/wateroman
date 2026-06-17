const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Get all products (including inactive)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products ORDER BY created_at DESC'
    );
    res.json({ success: true, products: result.rows });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM products WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create product
router.post('/', async (req, res) => {
  try {
    const { name_ar, name_en, description, price, image_url, category, stock } = req.body;
    
    if (!name_ar || !price) {
      return res.status(400).json({ success: false, message: 'اسم المنتج والسعر مطلوبان' });
    }
    
    const result = await pool.query(
      `INSERT INTO products (name_ar, name_en, description, price, image_url, category, stock, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
      [name_ar, name_en || '', description || '', price, image_url || '', category || '', stock || 0]
    );
    
    res.status(201).json({ success: true, product: result.rows[0] });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Update product
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name_ar, name_en, description, price, image_url, category, stock, is_active } = req.body;
    
    const result = await pool.query(
      `UPDATE products SET 
        name_ar = COALESCE($1, name_ar),
        name_en = COALESCE($2, name_en),
        description = COALESCE($3, description),
        price = COALESCE($4, price),
        image_url = COALESCE($5, image_url),
        category = COALESCE($6, category),
        stock = COALESCE($7, stock),
        is_active = COALESCE($8, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $9 RETURNING *`,
      [name_ar, name_en, description, price, image_url, category, stock, is_active, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    res.json({ success: true, product: result.rows[0] });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ success: false, message: 'Server error: ' + error.message });
  }
});

// Delete product (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'UPDATE products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
