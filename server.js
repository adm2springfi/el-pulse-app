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

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Handle PayFast form POSTs
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure 'uploads' directory exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

// Multer storage for banners
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
// NOTIFICATION HELPERS (Email & WhatsApp)
// -------------------------------------------------------------

// Transporter using environment variables or fallback test Ethereal account
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER || 'test_user',
    pass: process.env.SMTP_PASS || 'test_pass'
  }
});

// Helper function to send email ticket
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
        <p>Hi <strong>${purchaserName || 'Event Goer'}</strong>,</p>
        <p>Thank you for your purchase. Here is your official event ticket:</p>

        <div style="background-color: #1f2937; padding: 15px; border-radius: 8px; border-left: 4px solid #6366f1; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #818cf8;">${eventTitle}</h3>
          <p><strong>Ticket Reference:</strong> #${ticketId}</p>
          <p><strong>Quantity:</strong> ${quantity} Ticket(s)</p>
          <p><strong>Total Paid:</strong> R${parseFloat(totalAmount).toFixed(2)}</p>
        </div>

        <p style="text-align: center; color: #9ca3af; font-size: 12px;">Present this reference or QR code at the venue entry.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Ticket email dispatched successfully to ${purchaserEmail}`);
  } catch (err) {
    console.error(`Failed to dispatch email ticket: ${err.message}`);
  }
}

// Helper function to dispatch WhatsApp message via Twilio (Optional API)
async function sendWhatsAppTicket(purchaserPhone, eventTitle, quantity, ticketId) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log(`[Twilio Not Configured] Skipping WhatsApp message to ${purchaserPhone}`);
    return;
  }
  
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`,
      to: `whatsapp:${purchaserPhone}`,
      body: `🎟️ *EL Pulse Ticket Confirmed!*\n\nEvent: *${eventTitle}*\nTickets: ${quantity}\nRef #: ${ticketId}\n\nPresent this message at the door for entry!`
    });
    console.log(`WhatsApp ticket sent to ${purchaserPhone}`);
  } catch (err) {
    console.error(`Failed to send WhatsApp message: ${err.message}`);
  }
}

// -------------------------------------------------------------
// AUTH & EVENT ROUTES
// -------------------------------------------------------------
app.post('/api/auth/register-planner', async (req, res) => {
  try {
    const { name, email, password, payfastMerchantId, recaptchaToken } = req.body;
    if (!name || !email || !password || !payfastMerchantId) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ success: false, message: 'Email already registered.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, payfastMerchantId, role: 'PLANNER' }
    });
    res.status(201).json({ success: true, message: 'Account registered successfully!' });
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

app.get('/api/events', async (req, res) => {
  try {
    const events = await prisma.event.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------------------------------------------------
// PAYFAST WEBHOOK / PAYMENT SUCCESS CALLBACK
// -------------------------------------------------------------
app.post('/api/tickets/payfast-webhook', async (req, res) => {
  try {
    // PayFast posts ITN (Instant Transaction Notification) data here
    const { payment_status, item_name, amount_gross, email_address, custom_str1, custom_str2 } = req.body;

    if (payment_status === 'COMPLETE') {
      const purchaserEmail = email_address;
      const purchaserPhone = custom_str1; // Passed phone number
      const eventTitle = item_name;
      const quantity = custom_str2 || '1';
      const ticketId = 'ELP-' + Math.floor(100000 + Math.random() * 900000);

      // Trigger automated delivery
      await sendTicketEmail(purchaserEmail, 'Customer', eventTitle, quantity, amount_gross, ticketId);
      
      if (purchaserPhone) {
        await sendWhatsAppTicket(purchaserPhone, eventTitle, quantity, ticketId);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error("ITN Error:", err);
    res.status(500).send('Error');
  }
});

// Direct test purchase endpoint (for testing without live PayFast callback)
app.post('/api/tickets/confirm-test-purchase', async (req, res) => {
  try {
    const { purchaserEmail, purchaserName, purchaserPhone, eventTitle, quantity, totalAmount } = req.body;
    const ticketId = 'ELP-' + Math.floor(100000 + Math.random() * 900000);

    // Send Email
    await sendTicketEmail(purchaserEmail, purchaserName, eventTitle, quantity, totalAmount, ticketId);

    // Send WhatsApp if phone provided
    if (purchaserPhone) {
      await sendWhatsAppTicket(purchaserPhone, eventTitle, quantity, ticketId);
    }

    res.json({ success: true, message: 'Payment confirmed & ticket delivered via Email/WhatsApp!', ticketId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`EL Pulse Server running on port ${PORT}`));