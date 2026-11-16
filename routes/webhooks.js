const express = require('express');
const { webhook } = require('../controllers/webhookCtrl');

const router = express.Router();
router.post('/payments/:gateway', webhook);

module.exports = router;
