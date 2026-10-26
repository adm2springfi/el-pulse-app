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
app.use('/uploads', express.static('uploads')); // Serve uploaded event banners publicly

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

function authenticatePlanner(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'PLANNER') {
      return res.status(403).json({ success: false, message: 'Only registered Event Planners can perform this action.' });
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
app.post('/api/auth/register-planner', async (req, res) => {
  try {
    const { name, email, password, payfastMerchantId } = req.body;
    if (!name || !email || !password || !payfastMerchantId) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ success: false, message: 'Email already registered.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, payfastMerchantId, role: 'PLANNER' }
    });

    res.status(201).json({ success: true, message: 'Organizer account created successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials.' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ success: false, message: 'Invalid credentials.' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, payfastMerchantId: user.payfastMerchantId },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({ success: true, token, user: { name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// EVENT MANAGEMENT WITH BANNER UPLOAD
// -------------------------------------------------------------
app.get('/api/events', async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      orderBy: { createdAt: 'desc' },
      include: { organizer: { select: { name: true } } }
    });
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/events/my-events', authenticatePlanner, async (req, res) => {
  try {
    const myEvents = await prisma.event.findMany({
      where: { organizerId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, events: myEvents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Event Creation Route supporting File Upload or Image URL
app.post('/api/events/create', authenticatePlanner, upload.single('bannerImage'), async (req, res) => {
  try {
    const { title, description, location, price, capacity, imageUrl } = req.body;
    if (!title || price === undefined || !capacity) {
      return res.status(400).json({ success: false, message: 'Title, price, and capacity are required.' });
    }

    // Determine image URL from uploaded file or fall back to external URL / default
    let finalImageUrl = 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80';
    
    if (req.file) {
      finalImageUrl = `/uploads/${req.file.filename}`;
    } else if (imageUrl && imageUrl.trim() !== '') {
      finalImageUrl = imageUrl.trim();
    }

    const event = await prisma.event.create({
      data: {
        title,
        description: description || '',
        location: location || 'East London',
        price: parseFloat(price),
        capacity: parseInt(capacity),
        available: parseInt(capacity),
        imageUrl: finalImageUrl,
        payfastMerchantId: req.user.payfastMerchantId,
        organizerId: req.user.id
      }
    });

    res.status(201).json({ success: true, message: 'Event published live with banner!', event });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// PAYFAST 5% SPLIT CHECKOUT ROUTE
// -------------------------------------------------------------
app.post('/api/tickets/checkout-split', async (req, res) => {
  try {
    const { eventId, quantity } = req.body;
    const qty = parseInt(quantity) || 1;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });
    if (event.available < qty) return res.status(400).json({ success: false, message: 'Not enough tickets available.' });

    const totalAmount = event.price * qty;
    const platformFee = totalAmount * 0.05;
    const organizerAmount = totalAmount - platformFee;

    const payfastData = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID || '10000100',
      merchant_key: process.env.PAYFAST_MERCHANT_KEY || '46f0cd694581a',
      return_url: 'https://el-pulse-app-1.onrender.com/index.html?payment=success',
      cancel_url: 'https://el-pulse-app-1.onrender.com/index.html?payment=cancelled',
      notify_url: 'https://el-pulse-app-1.onrender.com/api/tickets/payfast-webhook',
      amount: totalAmount.toFixed(2),
      item_name: `EL Pulse Ticket (${qty}x) - ${event.title}`,
      setup_split: {
        split_merchant_id: event.payfastMerchantId,
        split_percentage: 95,
        amount: totalAmount.toFixed(2)
      }
    };

    res.json({
      success: true,
      checkoutUrl: 'https://sandbox.payfast.co.za/eng/process',
      payfastData,
      breakdown: {
        total: totalAmount.toFixed(2),
        platformFee5Percent: platformFee.toFixed(2),
        organizerPayout95Percent: organizerAmount.toFixed(2)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`EL Pulse Server running on port ${PORT}`));