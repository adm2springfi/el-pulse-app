const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure 'uploads' directory exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Configure Multer storage for banner uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'banner-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files (JPG, PNG, WEBP) are allowed!'));
  }
});

const JWT_SECRET = process.env.JWT_SECRET || 'el_pulse_super_secret_key_2026';

// Middleware for Event Planners & Admin
function authenticatePlanner(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'PLANNER' && decoded.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Permission denied.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid or expired session token.' });
  }
}

// Middleware for Super Admin
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Admin token required.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'Access denied. Super Admin role required.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid or expired session token.' });
  }
}

// -------------------------------------------------------------
// AUTH ROUTES
// -------------------------------------------------------------

// Organizer Registration (With reCAPTCHA & Robust Error Logging)
app.post('/api/auth/register-planner', async (req, res) => {
  try {
    const { name, email, password, payfastMerchantId, recaptchaToken } = req.body;

    if (!name || !email || !password || !payfastMerchantId) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (!recaptchaToken) {
      return res.status(400).json({ success: false, message: 'Please complete the reCAPTCHA box.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'This email is already registered. Please log in.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        payfastMerchantId,
        role: 'PLANNER'
      }
    });

    console.log("Successfully registered user:", user.email);

    res.status(201).json({ 
      success: true, 
      message: 'Account created successfully! Redirecting to login...',
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    console.error("Registration Server Error:", err);
    res.status(500).json({ success: false, message: 'Server database error: ' + err.message });
  }
});

// User Login (Planners & Admins)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid email or password.' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ success: false, message: 'Invalid email or password.' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, payfastMerchantId: user.payfastMerchantId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({ success: true, token, user: { name: user.name, role: user.role } });
  }