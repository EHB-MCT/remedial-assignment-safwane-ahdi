require('dotenv').config();
const mongoose = require('mongoose');
const runSimulationStep = require('./simulator/engine');

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('🧠 Connected to MongoDB. Starting simulation...');
    
    // Simulation tick interval
    setInterval(() => {
      runSimulationStep();
    }, 2000);

  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
  });
