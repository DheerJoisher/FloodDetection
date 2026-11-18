require('dotenv').config();

const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/healthRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const floodDataRoutes = require('./routes/floodDataRoutes');
const stationRoutes = require('./routes/stationRoutes');
const alertRoutes = require('./routes/alertRoutes');
const authRoutes = require('./routes/authRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const port = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json());

app.use('/api/health', healthRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/flood-data', floodDataRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/auth', authRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Godavari Flood API listening at http://localhost:${port}`);
});
