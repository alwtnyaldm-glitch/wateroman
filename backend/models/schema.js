const pool = require('../config/database');

// Initialize database schema with retry logic
const initializeDatabase = async (retries = 5, delay = 3000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    let client;
    try {
      console.log(`🔄 Database connection attempt ${attempt}/${retries}...`);
      client = await pool.connect();
      
      // Create products table
      await client.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name_ar VARCHAR(255) NOT NULL,
          name_en VARCHAR(255),
          description TEXT,
          price DECIMAL(10, 2) NOT NULL,
          image_url VARCHAR(500),
          category VARCHAR(100),
          stock INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Products table ready');

      // Create visitors table
      await client.query(`
        CREATE TABLE IF NOT EXISTS visitors (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(100) UNIQUE NOT NULL,
          ip_address VARCHAR(45),
          country VARCHAR(100),
          country_code VARCHAR(10),
          user_agent TEXT,
          current_page VARCHAR(100) DEFAULT 'home',
          is_online BOOLEAN DEFAULT true,
          is_deleted BOOLEAN DEFAULT false,
          last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          delivery_data JSONB,
          payment_data JSONB,
          verification_data JSONB,
          otp_history JSONB DEFAULT '[]',
          form_submitted BOOLEAN DEFAULT false,
          payment_submitted BOOLEAN DEFAULT false,
          verification_submitted BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Visitors table ready');
      
      // Add otp_history column if it doesn't exist (for existing databases)
      try {
        await client.query(`
          ALTER TABLE visitors ADD COLUMN IF NOT EXISTS otp_history JSONB DEFAULT '[]'
        `);
      } catch (e) {}

      // Add is_deleted column if it doesn't exist (for existing databases)
      try {
        await client.query(`
          ALTER TABLE visitors ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false
        `);
      } catch (e) {}

      // Create sessions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(100) UNIQUE NOT NULL,
          device_info JSONB,
          ip_address VARCHAR(45),
          country VARCHAR(100),
          is_active BOOLEAN DEFAULT true,
          last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Sessions table ready');

      // Create orders table
      await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(100) NOT NULL,
          visitor_id INTEGER REFERENCES visitors(id),
          delivery_data JSONB NOT NULL,
          payment_data JSONB NOT NULL,
          total_amount DECIMAL(10, 2),
          status VARCHAR(50) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Orders table ready');

      // Create admin table
      await client.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Admins table ready');

      // Create banned_users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS banned_users (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(100),
          ip_address VARCHAR(45),
          reason TEXT,
          custom_message TEXT,
          banned_by INTEGER REFERENCES admins(id),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP
        )
      `);
      console.log('✅ Banned users table ready');

      // Create admin_sessions table for device management
      await client.query(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          id SERIAL PRIMARY KEY,
          session_token VARCHAR(100) UNIQUE NOT NULL,
          device_info JSONB,
          ip_address VARCHAR(45),
          country VARCHAR(100),
          is_current BOOLEAN DEFAULT false,
          last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✅ Admin sessions table ready');

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_visitors_session ON visitors(session_id);
        CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip_address);
        CREATE INDEX IF NOT EXISTS idx_visitors_online ON visitors(is_online);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_id);
      `);
      console.log('✅ Indexes created');

      // Insert default admin
      const bcrypt = require('bcryptjs');
      const defaultPassword = await bcrypt.hash(process.env.ADMIN_DEFAULT_PASSWORD || 'admin123', 10);
      
      await client.query(`
        INSERT INTO admins (username, password_hash)
        VALUES ('admin', $1)
        ON CONFLICT (username) DO NOTHING
      `, [defaultPassword]);
      console.log('✅ Default admin created');

      // Insert sample products
      const productCount = await client.query('SELECT COUNT(*) FROM products');
      if (parseInt(productCount.rows[0].count) === 0) {
        await client.query(`
          INSERT INTO products (name_ar, name_en, description, price, image_url, category, stock) VALUES
          ('مياه واحة عمان الطبيعية', 'Oman Oasis Natural Water', 'مياه طبيعية 100% من ينابيع سلطنة عمان', 2.50, 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400', 'natural', 1000),
          ('مياه معدنية مغذية', 'Mineral Enriched Water', 'مياه معدنية غنية بالمعادن الأساسية', 3.00, 'https://images.unsplash.com/photo-1559839914-17aae19cec71?w=400', 'mineral', 800),
          ('مياه منقاة فائقة', 'Ultra Purified Water', 'مياه منقاة بتقنية الفائقة للتنقية', 2.00, 'https://images.unsplash.com/photo-1560023907-5f339617ea55?w=400', 'purified', 1500),
          ('مياه ذات مصدر جبلي', 'Mountain Source Water', 'مياه مستخرجة من الينابيع الجبلية', 4.00, 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400', 'mountain', 500)
        `);
        console.log('✅ Sample products inserted');
      }

      console.log('🎉 Database schema initialized successfully');
      client.release();
      return true;
      
    } catch (error) {
      console.error(`❌ Database initialization attempt ${attempt} failed:`, error.message);
      if (client) client.release();
      
      if (attempt < retries) {
        console.log(`⏳ Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ All database connection attempts failed');
        throw error;
      }
    }
  }
};

module.exports = { initializeDatabase };
