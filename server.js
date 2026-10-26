const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const path = require('path');

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/events.html');
});

// Fetch All Events
app.get(['/api/events', '/events'], async (req, res) => {
  try {
    const rawEvents = await prisma.event.findMany({
      orderBy: { date: 'asc' },
    });

    const events = rawEvents.map((event) => ({
      ...event,
      venue: event.location,
      category: event.description || 'General',
      imageUrl: event.imageUrl || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&auto=format&fit=crop&q=80',
    }));

    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events from database.' });
  }
});

// Create a New Event
app.post(['/api/events', '/events'], async (req, res) => {
  try {
    const title = req.body.title;
    const location = req.body.location || req.body.venue;
    const dateInput = req.body.date;
    const description = req.body.description || req.body.category || 'East London Event';
    const price = parseFloat(req.body.price) || 0;
    const capacity = parseInt(req.body.capacity) || 100;
    const imageUrl = req.body.imageUrl || null;

    if (!title || !location || !dateInput) {
      return res.status(400).json({ error: 'Title, Venue, and Date are required.' });
    }

    const date = new Date(dateInput);
    const newEvent = await prisma.event.create({
      data: { title, description, location, date, price, capacity, imageUrl },
    });

    res.status(201).json(newEvent);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event: ' + error.message });
  }
});

// Purchase / Book a Ticket (Robust & Logged)
app.post(['/api/tickets', '/tickets'], async (req, res) => {
  try {
    const { userId, eventId, qrCode } = req.body;
    
    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required.' });
    }

    const ticket = await prisma.ticket.create({
      data: {
        userId: userId || 'guest_user',
        eventId: eventId,
        qrCode: qrCode || `TICKET-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        status: 'VALID',
      },
      include: { event: true },
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('DETAILED TICKET BOOKING ERROR:', error);
    res.status(500).json({ error: 'Failed to complete ticket booking: ' + error.message });
  }
});

// Verify Ticket
app.get(['/api/tickets/verify/:qrCode', '/tickets/verify/:qrCode'], async (req, res) => {
  try {
    const { qrCode } = req.params;
    const ticket = await prisma.ticket.findUnique({
      where: { qrCode },
      include: { event: true },
    });

    if (!ticket) {
      return res.status(404).json({ valid: false, message: 'Ticket not found.' });
    }

    res.json({ valid: ticket.status === 'VALID', ticket });
  } catch (error) {
    console.error('Error verifying ticket:', error);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 EL Pulse Server running at http://localhost:${PORT}`);
});