const express = require('express');
const {
  getAlerts,
  createAlert,
  deleteAlert,
} = require('../controllers/alertController');
const authenticateToken = require('../middleware/authenticateToken');

const router = express.Router();

router.get('/', getAlerts);
router.post('/', authenticateToken, createAlert);
router.delete('/:id', authenticateToken, deleteAlert);

module.exports = router;
