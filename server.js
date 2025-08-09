require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const productRoutes = require('./routes/products');
const eventRoutes = require('./routes/events');
const runSimulationStep = require('./simulator/engine');
const { refreshFromPcpp } = require('./jobs/refreshFromPcpp');
const Product = require('./models/Product'); // ← add this

const app = express();
app.use(cors());
app.use(express.json());

app.use('/products', productRoutes);
app.use('/events', eventRoutes);

app.get('/', (req, res) => res.send('PC Market Simulator API is running'));

const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: '*', methods: ['GET','POST'] } });

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('MongoDB connected. Starting simulation...');

  try {
    // Wipe products on boot (toggle via env if you want)
    if (process.env.FULL_REFRESH_ON_BOOT !== 'false') {
      console.log('[BOOT] Wiping products collection…');
      const res = await Product.deleteMany({});
      console.log(`[BOOT] Removed ${res.deletedCount} products.`);
    }

    // Refill from proxy (your importer already filters & skips €1)
    const n = await refreshFromPcpp();
    console.log(`PCPP refresh complete. Upserted/updated: ${n}`);
  } catch (e) {
    console.error('Initial PCPP refresh failed:', e.message);
  }

  const minutes = Number(process.env.PCPP_REFRESH_MINUTES || 30);
  setInterval(async () => {
    try {
      const n = await refreshFromPcpp();
      console.log(`PCPP refresh complete. Upserted/updated: ${n}`);
    } catch (e) {
      console.error('Scheduled PCPP refresh failed:', e.message);
    }
  }, minutes * 60 * 1000);

  setInterval(() => runSimulationStep(io), 1000);
}).catch(err => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
