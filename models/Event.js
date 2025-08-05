const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    name: String,
    type: String, 
    targetProduct: String, 
    effect: String, 
    magnitude: Number, 
    durationMs: Number, 
    startedAt: Date,
    endedAt: Date,
    description: String
});

module.exports = mongoose.model('Event', eventSchema);
