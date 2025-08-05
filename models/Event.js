const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    name: String,
    type: String, 
    targetProduct: String, 
    effect: String, 
    magnitude: Number, 
    durationMs: Number, 
    startedAt: Date,
    endedAt: Date
});

module.exports = mongoose.model('Event', eventSchema);
