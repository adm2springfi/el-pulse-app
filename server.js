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

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'el-pulse-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

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

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Register route
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, payfastMerchantId } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

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
        payfastMerchantId: payfastMerchantId || '10000100',
        role: 'PLANNER'
      }
    });

    req.session.userId = user.id;
    req.session.userEmail = user.email;
    
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save session.' });
      }
      res.json({ success: true, message: 'Account created successfully!' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Server error occurred during registration.' });
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

    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to save session.' });
      }
      res.json({ success: true, message: 'Logged in successfully!' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Server error during login.' });
  }
});

// Password reset route
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and new password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { email },
      data: { passwordHash: newPasswordHash }
    });

    res.json({ success: true, message: 'Password reset successfully! You can now log in.' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error resetting password.' });
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
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// Create event route
app.post('/api/events', upload.single('image'), async (req, res) => {
  try {
    let userId = req.body.userId || req.session.userId;
    
    if (!userId) {
      const defaultPlanner = await prisma.user.findFirst({ where: { role: 'PLANNER' } });
      if (defaultPlanner) userId = defaultPlanner.id;
    }

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: Please log in again.' });
    }

    const { title, description, location, date, price, capacity } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '/images/default-event.jpg';

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(401).json({ error: 'User record not found.' });
    }

    const event = await prisma.event.create({
      data: {
        title,
        description,
        location,
        date: date || '2026-11-01 17:00', // Safely passed as a clean string matching schema
        price: parseFloat(price) || 0,
        capacity: parseInt(capacity) || 100,
        available: parseInt(capacity) || 100,
        imageUrl,
        payfastMerchantId: user.payfastMerchantId || '10000100',
        organizerId: user.id
      }
    });

    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
  try {
    let userId = req.body.userId || req.session.userId;
    if (!userId) {
      const defaultPlanner = await prisma.user.findFirst({ where: { role: 'PLANNER' } });
      if (defaultPlanner) userId = defaultPlanner.id;
    }

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { title, eventId } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const photo = await prisma.photoGallery.create({
      data: {
        title: title || 'EL Pulse Moment',
        imageUrl: `/uploads/${req.file.filename}`,
        eventId: eventId || null,
        organizerId: userId
      }
    });

    res.json({ success: true, photo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/reset-account', async (req, res) => {
  try {
    await prisma.user.deleteMany({
      where: { email: 'springfieldleroy@gmail.com' }
    });
    res.send('Account cleared successfully! Go back to Register and sign up fresh.');
  } catch (error) {
    res.status(500).send('Error clearing account: ' + error.message);
  }
});

app.listen(PORT, () => {
  console.log(`EL Pulse server running on port ${PORT}`);

  const APP_URL = 'https://el-pulse-app-1.onrender.com/health';
  setInterval(() => {
    https.get(APP_URL, (res) => {
      console.log(`Self-ping sent: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('Self-ping failed:', err.message);
    });
  }, 10 * 60 * 1000);
});