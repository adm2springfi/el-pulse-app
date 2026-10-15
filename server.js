const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data.json');

let db = {
    events: [
        { id: 1, title: "DJ Vino Birthday bash", category: "Music", date: "2026-11-15", venue: "The Hub Beacon Bay", price: 200, image: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop" },
        { id: 2, title: "Nahoon Beach Night Market", category: "Food & Drink", date: "2026-11-22", venue: "Nahoon Estuary", price: 50, image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=500&auto=format&fit=crop" }
    ],
    tickets: []
};

if (fs.existsSync(DATA_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) { console.error("Error reading data.json", e); }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}

app.get('/api/events', (req, res) => res.json(db.events));

app.post('/api/events', (req, res) => {
    const newEvent = {
        id: Date.now(),
        title: req.body.title,
        category: req.body.category || 'General',
        date: req.body.date || 'TBD',
        venue: req.body.venue,
        price: Number(req.body.price) || 0,
        image: req.body.image || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop'
    };
    db.events.push(newEvent);
    saveData();
    res.json({ success: true, event: newEvent });
});

app.post('/api/tickets/buy', (req, res) => {
    const { buyerName, eventId, tierName } = req.body;
    const event = db.events.find(e => e.id == eventId);
    if (!event) return res.status(404).json({ success: false, error: "Event not found" });

    const ticketPrice = event.price;
    const platformFee = ticketPrice * 0.05; // Your 5% cut
    const organizerPayout = ticketPrice * 0.95; // 95% to the organizer

    const ticketId = 'EL-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const ticket = {
        ticketId,
        buyerName,
        eventId: Number(eventId),
        eventTitle: event.title,
        tierName: tierName || 'General Admission',
        price: ticketPrice,
        platformFee,
        organizerPayout,
        scanned: false,
        purchaseDate: new Date().toISOString()
    };
    db.tickets.push(ticket);
    saveData();
    res.json({ success: true, ticket });
});

app.post('/api/tickets/scan', (req, res) => {
    const { ticketId } = req.body;
    const ticket = db.tickets.find(t => t.ticketId === ticketId);
    if (!ticket) return res.json({ success: false, message: "Invalid Ticket ID" });
    if (ticket.scanned) return res.json({ success: false, message: "Ticket already scanned!" });

    ticket.scanned = true;
    saveData();
    res.json({ success: true, message: "Access Granted!", ticket });
});

app.get('/api/organizer/stats', (req, res) => {
    const totalEvents = db.events.length;
    const totalTicketsSold = db.tickets.length;
    const grossRevenue = db.tickets.reduce((sum, t) => sum + (t.price || 0), 0);
    const totalPlatformEarnings = db.tickets.reduce((sum, t) => sum + (t.platformFee || (t.price * 0.05)), 0);
    const totalOrganizerPayouts = db.tickets.reduce((sum, t) => sum + (t.organizerPayout || (t.price * 0.95)), 0);
    const scannedCount = db.tickets.filter(t => t.scanned).length;

    res.json({
        totalEvents,
        totalTicketsSold,
        grossRevenue,
        totalPlatformEarnings,
        totalOrganizerPayouts,
        scannedCount,
        events: db.events.map(ev => {
            const evTickets = db.tickets.filter(t => t.eventId === ev.id);
            const evGross = evTickets.reduce((sum, t) => sum + (t.price || 0), 0);
            const evPlatform = evTickets.reduce((sum, t) => sum + (t.platformFee || (t.price * 0.05)), 0);
            const evPayout = evTickets.reduce((sum, t) => sum + (t.organizerPayout || (t.price * 0.95)), 0);
            return {
                title: ev.title,
                venue: ev.venue,
                date: ev.date,
                ticketsSold: evTickets.length,
                grossRevenue: evGross,
                platformFee: evPlatform,
                organizerPayout: evPayout
            };
        })
    });
});

app.listen(PORT, () => {
    console.log("EL Pulse Server running on port 3000");
});