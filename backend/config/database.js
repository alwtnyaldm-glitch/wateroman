const { Pool } = require('pg');

// Parse the connection string for Neon PostgreSQL
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL environment variable is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('connect', () => {
  console.log('✅ Connected to Neon PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('✅ Database connection test successful'))
  .catch(err => console.error('❌ Database connection test failed:', err.message));

module.exports = pool;
