import express from 'express';
import { signup, preLogin, login, checkGoogleAuth } from '../controllers/authController.js';

const router = express.Router();

router.post('/signup', signup);
router.post('/login', preLogin);
router.post('/login/otp', login);
router.post('/check-google-auth', checkGoogleAuth);


export default router;