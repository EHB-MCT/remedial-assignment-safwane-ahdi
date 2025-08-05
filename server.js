const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
require('dotenv').config();
const mongoose = require('mongoose');
const productRoutes = require('./routes/products');
const eventRoutes = require('./routes/events');
const runSimulationStep = require('./simulator/engine'); // this now takes io

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/products', productRoutes);
app.use('/events', eventRoutes);

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// Mongo connection and simulation
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('🧠 MongoDB connected. Starting simulation...');
  setInterval(() => runSimulationStep(io), 2000);
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});
