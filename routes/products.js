const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

// GET /products - Get all products
router.get('/', async (req, res) => {
  const products = await Product.find({})
    .select('name type price stock salesCount lastSoldAt')
    .lean();
  res.json(products);
});

module.exports = router;