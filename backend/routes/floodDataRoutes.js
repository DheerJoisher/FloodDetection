const express = require('express');
const {
  getFloodData,
  getLatestFloodData,
  getFloodDataById,
} = require('../controllers/floodDataController');

const router = express.Router();

router.get('/', getFloodData);
router.get('/latest', getLatestFloodData);
router.get('/:id', getFloodDataById);

module.exports = router;
