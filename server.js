const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { PrismaClient } = require('@prisma/client');

// Initialize Prisma Client
const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure 'uploads' directory exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Multer storage configuration for banners
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'banner-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const JWT_SECRET = process.env.JWT_SECRET || 'el_pulse_super_secret_key_2026';

// -------------------------------------------------------------
// NOTIFICATION HELPERS (Email & WhatsApp Tickets)
// -------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER || 'test_user',
    pass: process.env.SMTP_PASS || 'test_pass'
  }
});

async function sendTicketEmail(purchaserEmail, purchaserName, eventTitle, quantity, totalAmount, ticketId) {
  const mailOptions = {
    from: '"EL Pulse Tickets" <tickets@elpulse.co.za>',
    to: purchaserEmail,
    subject: `🎟️ Your Ticket Confirmation for ${eventTitle}`,
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #111827; color: #ffffff; padding: 20px; border-radius: 12px; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1; text-align: center;">EL Pulse Tickets</h1>
        <hr style="border-color: #374151;">
        <h2>Payment Successful!</h2>
        <p>Hi <strong>${purchaserName || 'Customer'}</strong>,</p>
        <p>Thank you for your ticket purchase. Here are your ticket details:</p>

        <div style="background-color: #1f2937; padding: 15px; border-radius: 8px; border-left: 4px solid #6366f1; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #818cf8;">${eventTitle}</h3>
          <p><strong>Ticket Reference:</strong> #${ticketId}</p>
          <p><strong>Quantity:</strong> ${quantity} Ticket(s)</p>
          <p><strong>Total Paid:</strong> R${parseFloat(totalAmount).toFixed(2)}</p>
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 12px;">Present this ticket reference at the entrance.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error(`Email dispatch error: ${err.message}`);
  }
}

async function sendWhatsAppTicket(purchaserPhone, eventTitle, quantity, ticketId) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return;
  
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`,
      to: `whatsapp:${purchaserPhone}`,
      body: `🎟️ *EL Pulse Ticket Confirmed!*\n\nEvent: *${eventTitle}*\nQuantity: ${quantity}\nTicket Ref: #${ticketId}\n\nPresent this message at entry!`
    });
  } catch (err) {
    console.error(`WhatsApp send error: ${err.message}`);
  }
}

// Authentication Middleware
async function authenticatePlanner(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. Please log in again.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify user actually exists in database to prevent foreign key errors
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Session expired or user not found. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid token.' });
  }
}

// -------------------------------------------------------------
// AUTH ROUTES (Register & Login)
// -------------------------------------------------------------
app.post('/api/auth/register-planner', async (req, res) => {
  try {
    const { name, email, password, payfastMerchantId } = req.body;
    if (!name || !email || !password || !payfastMerchantId) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ success: false, message: 'Email address is already registered.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, payfastMerchantId, role: 'PLANNER' }
    });

    res.status(201).json({ success: true, message: 'Registered successfully!' });
  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

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
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// EVENT MANAGEMENT ROUTES
// -------------------------------------------------------------
app.get('/api/events', async (req, res) => {
  try {
    const events = await prisma.event.findMany({ orderBy: { createdAt: 'desc' } });
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

app.post('/api/events/create', authenticatePlanner, upload.single('bannerImage'), async (req, res) => {
  try {
    const { title, description, location, price, capacity, imageUrl } = req.body;
    let finalImageUrl = req.file ? `/uploads/${req.file.filename}` : (imageUrl || 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=800&q=80');

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

    res.status(201).json({ success: true, message: 'Event created!', event });
  } catch (err) {
    console.error("Event Create Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// CHECKOUT & PAYFAST WEBHOOK
// -------------------------------------------------------------
app.post('/api/tickets/checkout-split', async (req, res) => {
  try {
    const { eventId, quantity } = req.body;
    const qty = parseInt(quantity) || 1;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    const totalAmount = event.price * qty;
    const platformFee = totalAmount * 0.05;
    const organizerAmount = totalAmount - platformFee;

    const payfastData = {
      merchant_id: process.env.PAYFAST_MERCHANT_ID || '10000100',
      merchant_key: process.env.PAYFAST_MERCHANT_KEY || '46f0cd694581a',
      return_url: 'https://el-pulse-app-1.onrender.com/index.html?payment=success',
      cancel_url: 'https://el-pulse-app-1.onrender.com/index.html?payment=cancelled',
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

app.post('/api/tickets/payfast-webhook', async (req, res) => {
  try {
    const { payment_status, item_name, amount_gross, email_address, custom_str1, custom_str2 } = req.body;

    if (payment_status === 'COMPLETE') {
      const ticketId = 'ELP-' + Math.floor(100000 + Math.random() * 900000);
      await sendTicketEmail(email_address, 'Valued Guest', item_name, custom_str2 || '1', amount_gross, ticketId);
      if (custom_str1) await sendWhatsAppTicket(custom_str1, item_name, custom_str2 || '1', ticketId);
    }
    res.status(200).send('OK');
  } catch (err) {
    res.status(500).send('Error');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`EL Pulse Server running on port ${PORT}`));