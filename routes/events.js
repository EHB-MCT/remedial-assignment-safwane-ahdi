const express = require('express');
const router = express.Router();
const Event = require('../models/Event');

router.get('/', async (req, res) => {
  const events = await Event.find().sort({ startedAt: -1 }).limit(10);
  res.json(events);
});

module.exports = router;