require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

// Routes and simulator
const productRoutes = require('./routes/products');
const eventRoutes = require('./routes/events');
const runSimulationStep = require('./simulator/engine'); // function accepts io

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/products', productRoutes);
app.use('/events', eventRoutes);

app.get('/', (req, res) => {
  res.send('PC Market Simulator API is running');
});

// Create HTTP server and bind socket.io
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Connect to MongoDB and start simulation
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('🧠 MongoDB connected. Starting simulation...');
  setInterval(() => runSimulationStep(io), 1000);
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
