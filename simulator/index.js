require('dotenv').config();
const mongoose = require('mongoose');
const runSimulationStep = require('./engine');

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('🧠 Connected to MongoDB. Starting simulation...');
    
    // Run simulation every 5 seconds
    setInterval(() => {
      runSimulationStep();
    }, 5000);

  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
  });
