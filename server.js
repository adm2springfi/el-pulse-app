const express = require('express');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configure session
app.use(session({
  secret: 'el-pulse-secret-key-2026',
  resave: false,
  saveUninitialized: false
}));

// Configure file uploads for gallery & event images
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// ==========================================
// HEALTH CHECK ROUTE (For Ping Services)
// ==========================================
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

// Register route
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, payfastMerchantId } = req.body;
    
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Account already exists with this email.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        payfastMerchantId: payfastMerchantId || '10000100', // Default sandbox ID
        role: 'PLANNER'
      }
    });

    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ success: true, message: 'Account created successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ success: true, message: 'Logged in successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout route
app.get('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Get current session user
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, name: true, email: true, payfastMerchantId: true, role: true }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// EVENT MANAGEMENT ROUTES
// ==========================================

// Get all events
app.get('/api/events', async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      include: { organizer: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create event
app.post('/api/events', upload.single('image'), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { title, description, location, date, price, capacity } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '/images/default-event.jpg';

    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });

    const event = await prisma.event.create({
      data: {
        title,
        description,
        location,
        date,
        price: parseFloat(price),
        capacity: parseInt(capacity),
        available: parseInt(capacity),
        imageUrl,
        payfastMerchantId: user.payfastMerchantId,
        organizerId: user.id
      }
    });

    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PHOTO GALLERY ROUTES
// ==========================================

// Get gallery photos
app.get('/api/gallery', async (req, res) => {
  try {
    const photos = await prisma.photoGallery.findMany({
      include: { 
        organizer: { select: { name: true } },
        event: { select: { title: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(photos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload gallery photo
app.post('/api/gallery', upload.single('photo'), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { title, eventId } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const photo = await prisma.photoGallery.create({
      data: {
        title: title || 'EL Pulse Moment',
        imageUrl: `/uploads/${req.file.filename}`,
        eventId: eventId || null,
        organizerId: req.session.userId
      }
    });

    res.json({ success: true, photo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TEMPORARY UTILITY: RESET ACCOUNT ROUTE
// ==========================================
app.get('/reset-account', async (req, res) => {
  try {
    await prisma.user.deleteMany({
      where: { email: 'springfieldleroy@gmail.com' }
    });
    res.send('Account cleared successfully! You can now go back to your app, click Register here, and sign up fresh with springfieldleroy@gmail.com.');
  } catch (error) {
    res.status(500).send('Error clearing account: ' + error.message);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`EL Pulse server running on port ${PORT}`);

  // Self-ping every 10 minutes to prevent Render sleep mode
  const APP_URL = 'https://el-pulse-app-1.onrender.com/health';
  setInterval(() => {
    https.get(APP_URL, (res) => {
      console.log(`Self-ping sent to keep app awake: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('Self-ping failed:', err.message);
    });
  }, 10 * 60 * 1000); // 10 minutes
});