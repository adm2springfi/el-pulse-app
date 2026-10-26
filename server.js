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
function authenticatePlanner(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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
    if (!name || !email || !password ||