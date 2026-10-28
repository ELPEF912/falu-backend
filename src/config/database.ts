import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// En producción (Render/Neon) usa process.env.DATABASE_URL con SSL
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('neon.tech');

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});