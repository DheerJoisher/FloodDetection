function getHealth(req, res) {
  res.json({
    status: 'ok',
    message: 'Godavari Flood API is running.',
  });
}

module.exports = { getHealth };
