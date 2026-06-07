const express = require('express');
const router = express.Router();
const { getYtHealth } = require('../controllers/ytHealthController');

// No auth required — this is a diagnostic endpoint
router.get('/', getYtHealth);

module.exports = router;
