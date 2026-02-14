require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const SuremetScraper = require('./services/suremet-scraper');
const HydroEngine = require('./services/hydro-engine');
const RadarAemet = require('./services/radar-aemet');
const AlertEngine = require('./services/alert-engine');
const basins = require('./config/basins.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const state = {
  stations: new Map(),
  basins: new Map(),
  alerts: [],
  lastUpdate: null,
  radarData: null
};

basins.forEach(b => state.basins.set(b.id, { ...b, currentFlow: 0, alerts: [] }));

const scraper = new SuremetScraper();
const hydro = new HydroEngine();
const radar = new RadarAemet(process.env.AEMET_API_KEY);
const alertEngine = new AlertEngine();

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

async function updateCycle() {
  try {
    console.log('[UPDATE] Starting data collection...');
    const stationData = await scraper.fetchAllStations();
    stationData.forEach(s => state.stations.set(s.id, s));
    state.lastUpdate = new Date().toISOString();

    for (const [id, basin] of state.basins) {
      const basinStations = stationData.filter(s =>
        s.lat >= basin.bounds.south && s.lat <= basin.bounds.north &&
        s.lon >= basin.bounds.west && s.lon <= basin.bounds.east
      );
      if (basinStations.length > 0) {
        const avgPrecip = basinStations.reduce((sum, s) => sum + (s.precipitation || 0), 0) / basinStations.length;
        const maxIntensity = Math.max(...basinStations.map(s => s.intensity || 0));
        const result = hydro.calculateFlow(basin, avgPrecip, maxIntensity);
        basin.currentFlow = result.peakFlow;
        basin.precipitation = avgPrecip;
        basin.intensity = maxIntensity;
        basin.hydroResult = result;
      }
    }

    state.alerts = alertEngine.evaluate(state.basins);
    broadcast('update', {
      stations: Array.from(state.stations.values()),
      basins: Array.from(state.basins.values()),
      alerts: state.alerts,
      lastUpdate: state.lastUpdate
    });
    console.log('[UPDATE] Cycle complete. Stations:', state.stations.size);
  } catch (err) {
    console.error('[UPDATE] Error:', err.message);
  }
}

async function updateRadar() {
  try {
    if (process.env.AEMET_API_KEY) {
      state.radarData = await radar.fetchRadarData();
      broadcast('radar', state.radarData);
    }
  } catch (err) {
    console.error('[RADAR] Error:', err.message);
  }
}

app.use('/api/stations', require('./routes/stations')(state));
app.use('/api/basins', require('./routes/basins')(state, hydro));
app.use('/api/hydro', require('./routes/hydro')(state, hydro));
app.use('/api/radar', require('./routes/radar')(state, radar));
app.use('/api/alerts', require('./routes/alerts')(state));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

cron.schedule('*/5 * * * *', updateCycle);
cron.schedule('*/10 * * * *', updateRadar);

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      stations: Array.from(state.stations.values()),
      basins: Array.from(state.basins.values()),
      alerts: state.alerts,
      lastUpdate: state.lastUpdate
    }
  }));
  ws.on('close', () => console.log('[WS] Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] HidroAlerta-SE running on port ${PORT}`);
  updateCycle();
  updateRadar();
});
