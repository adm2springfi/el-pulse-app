const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = 'el_pulse_super_secret_key_2026';

// -------------------------------------------------------------
// IN-MEMORY DATABASES
// -------------------------------------------------------------
let users = [];   // Planners: { id, name, email, passwordHash, payfastMerchantId, role: 'PLANNER' }
let events = [];  // Events: { id, title, price, available, organizerId, payfastMerchantId }
let tickets = {}; // Tickets: { code, eventId, status, scannedAt }

// -------------------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// -------------------------------------------------------------
function authenticatePlanner(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'PLANNER') {
      return res.status(403).json({ success: false, message: 'Only registered Event Planners can perform this action.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid token.' });
  }
}

// -------------------------------------------------------------
// 1. EVENT PLANNER REGISTRATION & LOGIN
// -------------------------------------------------------------
app.post('/api/auth/register-planner', async (req, res) => {
  const { name, email, password, payfastMerchantId } = req.body;

  if (!name || !email || !password || !payfastMerchantId) {
    return res.status(400).json({ success: false, message: 'All fields including PayFast Merchant ID are required.' });
  }

  const existingUser = users.find(u => u.email === email);
  if (existingUser) return res.status(400).json({ success: false, message: 'Email already registered.' });

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const newPlanner = {
    id: `planner_${Date.now()}`,
    name,
    email,
    passwordHash,
    payfastMerchantId,
    role: 'PLANNER'
  };

  users.push(newPlanner);
  res.status(201).json({ success: true, message: 'Event Planner account created successfully!' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials.' });

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) return res.status(400).json({ success: false, message: 'Invalid credentials.' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, payfastMerchantId: user.payfastMerchantId }, JWT_SECRET, { expiresIn: '24h' });
  res.status(200).json({ success: true, token, user: { name: user.name, role: user.role } });
});

// -------------------------------------------------------------
// 2. PROTECTED EVENT CREATION (ONLY REGISTERED PLANNERS)
// -------------------------------------------------------------
app.post('/api/events/create', authenticatePlanner, (req, res) => {
  const { title, price, available } = req.body;

  const newEvent = {
    id: `evt_${Date.now()}`,
    title,
    price: parseFloat(price),
    available: parseInt(available),
    organizerId: req.user.id,
    payfastMerchantId: req.user.payfastMerchantId
  };

  events.push(newEvent);
  res.status(201).json({ success: true, message: 'Event created live on EL Pulse!', event: newEvent });
});

// -------------------------------------------------------------
// 3. TICKET PURCHASE WITH 5% SPLIT PAYMENT (PAYFAST INTEGRATION)
// -------------------------------------------------------------
app.post('/api/tickets/checkout-split', (req, res) => {
  const { eventId, quantity, buyerEmail } = req.body;
  const event = events.find(e => e.id === eventId);

  if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
  if (event.available < quantity) return res.status(400).json({ success: false, message: 'Tickets sold out' });

  const totalAmount = event.price * quantity;
  const platformFee = totalAmount * 0.05; // 5% platform fee
  const organizerAmount = totalAmount - platformFee; // 95% organizer payout

  const payfastData = {
    merchant_id: process.env.YOUR_PAYFAST_PLATFORM_ID || '10000100',
    merchant_key: process.env.YOUR_PAYFAST_PLATFORM_KEY || '46f0cd694581a',
    return_url: 'https://el-pulse-app-1.onrender.com/payment-success',
    cancel_url: 'https://el-pulse-app-1.onrender.com/payment-cancel',
    notify_url: 'https://el-pulse-app-1.onrender.com/api/tickets/payfast-webhook',
    
    setup_split: {
      split_merchant_id: event.payfastMerchantId,
      split_percentage: 95,
      amount: totalAmount.toFixed(2),
      item_name: `EL Pulse Ticket - ${event.title}`
    }
  };

  res.status(200).json({
    success: true,
    checkoutUrl: 'https://sandbox.payfast.co.za/eng/process',
    payfastData,
    breakdown: {
      total: totalAmount.toFixed(2),
      platformFee5Percent: platformFee.toFixed(2),
      organizerPayout95Percent: organizerAmount.toFixed(2)
    }
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`EL Pulse Server running on port ${PORT}`));