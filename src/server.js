require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const productRoutes = require('../routes/products');
const eventRoutes = require('../routes/events');
const runSimulationStep = require('../simulator/engine');
const { refreshFromPcpp } = require('../jobs/refreshFromPcpp');
const Product = require('../models/Product');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/products', productRoutes);
app.use('/events', eventRoutes);
app.get('/', (req, res) => res.send('PC Market Simulator API is running'));

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: '*', methods: ['GET','POST'] } });

io.on('connection', async (socket) => {
  try {
    const products = await Product.find({})
      .select('name type price stock salesCount lastSoldAt')
      .lean();
    socket.emit('productsUpdated', products);
    console.log(`[WS] init snapshot sent to ${socket.id} (${products.length} items)`);
  } catch (e) {
    console.error('[WS] init snapshot failed:', e);
  }
});

process.on('unhandledRejection', (reason, p) => {
  console.error('[FATAL] Unhandled Rejection at:', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
});

let tickCount = 0;
let lastTickMs = 0;

async function safeTick() {
  const t0 = Date.now();
  try {
    await runSimulationStep(io);
  } catch (err) {
    console.error('[SIM] tick error:', err);
  } finally {
    lastTickMs = Date.now() - t0;
    tickCount += 1;
  }
}

function startLoops() {
  const simIntervalMs = Number(process.env.TICK_MS || 1000);
  console.log(`[SIM] Starting loop every ${simIntervalMs} ms`);
  // Kick once immediately so you see activity right away
  void safeTick();
  setInterval(() => { void safeTick(); }, simIntervalMs);

  // Heartbeat every 10s so you know it’s alive even without sales
  setInterval(() => {
    const rssMb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
    console.log(`[SIM] heartbeat ticks=${tickCount} lastTick=${lastTickMs}ms rss=${rssMb}MB`);
  }, 10_000);
}

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('MongoDB connected. Starting simulation...');

  try {
    if (process.env.FULL_REFRESH_ON_BOOT !== 'false') {
      console.log('[BOOT] Wiping products collection…');
      const res = await Product.deleteMany({});
      console.log(`[BOOT] Removed ${res.deletedCount} products.`);
    }

    // Ensure refresh resolves and we log after it truly finishes
    const n = await refreshFromPcpp();
    console.log(`[BOOT] PCPP refresh complete. Upserted/updated: ${n}`);
  } catch (e) {
    console.error('Initial PCPP refresh failed:', e);
  }

  // Now start the sim loop
  startLoops();

  // Schedule periodic refreshes
  const minutes = Number(process.env.PCPP_REFRESH_MINUTES || 30);
  setInterval(async () => {
    try {
      const n = await refreshFromPcpp();
      console.log(`[SCHEDULED] PCPP refresh complete. Upserted/updated: ${n}`);
    } catch (e) {
      console.error('Scheduled PCPP refresh failed:', e);
    }
  }, minutes * 60 * 1000);
}).catch(err => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
