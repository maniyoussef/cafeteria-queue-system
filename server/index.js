const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const path = require('path');
const queueManager = require('./queueManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Get local network IP addresses for multi-VM connection setup
 */
function getNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  return addresses;
}

/**
 * Helper to broadcast updated state to all connected Socket.IO clients
 */
function broadcastStateUpdate(eventType = 'queue:updated', extraPayload = {}) {
  const state = queueManager.getState();
  io.emit('queue:updated', state);
  if (eventType !== 'queue:updated') {
    io.emit(eventType, { ...extraPayload, state });
  }
}

// Socket.IO Event Handlers
io.on('connection', (socket) => {
  // Send current queue state immediately to newly connected client
  socket.emit('queue:updated', queueManager.getState());

  socket.on('disconnect', () => {
    // Client disconnected
  });
});

// REST API Endpoints

// 1. Get system status & network IP addresses
app.get('/api/status', (req, res) => {
  const ips = getNetworkIPs();
  res.json({
    status: 'online',
    systemTime: new Date().toISOString(),
    networkIPs: ips,
    connectedClients: io.engine.clientsCount,
    port: PORT
  });
});

// 2. Get current queue state
app.get('/api/queues', (req, res) => {
  res.json(queueManager.getState());
});

// 3. Student Joins Queue
app.post('/api/queue/join', async (req, res) => {
  try {
    const { counterId, studentName, studentId, items, notes } = req.body;
    const ticket = await queueManager.joinQueue({ counterId, studentName, studentId, items, notes });
    
    // Broadcast real-time update
    broadcastStateUpdate('ticket:joined', { ticket });

    res.status(201).json({
      success: true,
      ticket,
      message: `Successfully joined line for ${ticket.counterName}. Ticket #${ticket.ticketNumber}`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. Student Leaves / Cancels Queue
app.post('/api/queue/leave', async (req, res) => {
  try {
    const { counterId, ticketId } = req.body;
    const result = await queueManager.leaveQueue(counterId, ticketId);
    
    if (result.success) {
      broadcastStateUpdate('ticket:cancelled', { ticketId, counterId });
      res.json({ success: true, message: 'Successfully removed from queue.' });
    } else {
      res.status(404).json(result);
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. Staff Serves Next Student (Pop FIFO Head)
app.post('/api/staff/serve-next', async (req, res) => {
  try {
    const { counterId } = req.body;
    const result = await queueManager.serveNext(counterId);

    if (result.success) {
      // Broadcast specific notification so called student client triggers sound/alert
      broadcastStateUpdate('ticket:called', { ticket: result.ticket, counterId });
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Staff Completes / Marks No-Show
app.post('/api/staff/complete', async (req, res) => {
  try {
    const { counterId, ticketId, action } = req.body;
    const result = await queueManager.completeTicket(counterId, ticketId, action);

    if (result.success) {
      broadcastStateUpdate('ticket:completed', { counterId, ticketId });
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Concurrent Join Stress Test Simulation
app.post('/api/test/concurrent-join', async (req, res) => {
  try {
    const { counterId = 'hot-meals', count = 5 } = req.body;
    const requests = Array.from({ length: count }, (_, i) => ({
      studentName: `Simulated Student ${i + 1} (VM Test)`,
      items: [`Combo ${i + 1}`, 'Drink'],
      notes: `Batch request index ${i + 1}`
    }));

    const startMs = Date.now();
    const tickets = await queueManager.batchConcurrentJoin(counterId, requests);
    const durationMs = Date.now() - startMs;

    broadcastStateUpdate('queue:batch_joined', { count: tickets.length });

    res.json({
      success: true,
      durationMs,
      processedCount: tickets.length,
      tickets: tickets.map(t => ({
        ticketNumber: t.ticketNumber,
        position: t.position,
        studentName: t.studentName,
        joinedAt: t.joinedAt
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Reset Queue for Testing Demo
app.post('/api/queue/reset', async (req, res) => {
  try {
    await queueManager.resetAll();
    broadcastStateUpdate('queue:reset');
    res.json({ success: true, message: 'All cafeteria queues reset successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catch-all SPA route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces for multi-VM client access

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use by another process.`);
    console.error(`   To resolve this:`);
    console.error(`   1. Stop any existing Node server running in the background.`);
    console.error(`   2. Or specify a different port: set PORT=3001 && npm start\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, HOST, () => {
  const ips = getNetworkIPs();
  console.log('\n======================================================');
  console.log(' 🍕 UNIVERSITY CAFETERIA QUEUE SERVER RUNNING 🍕');
  console.log('======================================================');
  console.log(` Local Access:      http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(' Network Access (VM2 / VM3 / VM4 Clients):');
    ips.forEach(ip => {
      console.log(`   -> http://${ip.address}:${PORT} (${ip.interface})`);
    });
  } else {
    console.log(' Network Access: No external network interface detected.');
  }
  console.log('======================================================\n');
});

