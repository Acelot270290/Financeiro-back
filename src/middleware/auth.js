import { expressjwt } from 'express-jwt';
import dotenv from 'dotenv';

dotenv.config();

export const requireAuth = expressjwt({
  secret: process.env.SUPABASE_JWT_SECRET,
  algorithms: ['HS256']
});