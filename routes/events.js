const express = require('express');
const router = express.Router();
const Event = require('../models/Event');

router.get('/', async (req, res) => {
  const events = await Event.find().sort({ startedAt: -1 }).limit(10);
  res.json(events);
});

router.get('/active', async (req, res) => {
    const activeEvent = await Event.findOne({ isActive: true }).sort({ startedAt: -1 });
    res.json(activeEvent);
  });

module.exports = router;