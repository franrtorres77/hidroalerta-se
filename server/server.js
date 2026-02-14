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
const SpatialInterpolator = require('./services/spatial-interpolator');
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
  radarData: null,
  radarGrid: null
};

basins.forEach(b => state.basins.set(b.id, {
  ...b, currentFlow: 0, alerts: [], hydroResult: null, spatialEstimate: null
}));

const scraper = new SuremetScraper();
const hydro = new HydroEngine();
const radar = new RadarAemet(process.env.AEMET_API_KEY);
const alertEngine = new AlertEngine();
const spatial = new SpatialInterpolator();

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

/**
 * CICLO DE ACTUALIZACION - Modelo semi-distribuido
 * 1. Datos SUREMET -> 2. Precipitacion por subcuenca -> 3. Hidrograma+routing -> 4. Alertas
 */
async function updateCycle() {
  try {
    console.log('[UPDATE] Iniciando ciclo...');
    const stationData = await scraper.fetchAllStations();
    stationData.forEach(s => state.stations.set(s.id, s));
    state.lastUpdate = new Date().toISOString();

    for (const [id, basin] of state.basins) {
      // Precipitacion por subcuenca (interpolacion espacial + fusion radar)
      const precipBySubcatchment = spatial.estimateSubcatchmentPrecip(
        basin, stationData, radar, state.radarGrid
      );

      // Modelo semi-distribuido: subcuencas -> routing -> superposicion
      const hydroResult = hydro.calculateBasinDistributed(basin, precipBySubcatchment);

      basin.currentFlow = hydroResult.peakFlow;
      basin.precipitation = precipBySubcatchment.mean;
      basin.intensity = precipBySubcatchment.maxIntensity;
      basin.hydroResult = hydroResult;
      basin.spatialEstimate = precipBySubcatchment;

      if (precipBySubcatchment.mean > 0) {
        console.log('[HYDRO] ' + basin.name +
          ': P=' + precipBySubcatchment.mean +
          'mm Q=' + hydroResult.peakFlow +
          'm3/s (' + hydroResult.method + ')');
      }
    }

    // 3. Evaluar alertas
    state.alerts = alertEngine.evaluate(state.basins);

    // 4. Broadcast
    broadcast('update', {
      stations: Array.from(state.stations.values()),
      basins: Array.from(state.basins.values()).map(b => ({
        id: b.id,
        name: b.name,
        type: b.type,
        area: b.area,
        currentFlow: b.currentFlow,
        precipitation: b.precipitation,
        intensity: b.intensity,
        thresholds: b.thresholds,
        controlPoint: b.controlPoint,
        bounds: b.bounds,
        subcatchmentCount: (b.subcatchments || []).length,
        hydroResult: b.hydroResult ? {
          method: b.hydroResult.method,
          peakFlow: b.hydroResult.peakFlow,
          peakTime: b.hydroResult.peakTime,
          subcatchmentResults: b.hydroResult.subcatchmentResults
        } : null,
        alerts: b.alerts
      })),
      alerts: state.alerts,
      lastUpdate: state.lastUpdate
    });

    console.log('[UPDATE] Ciclo completo. Estaciones: ' + state.stations.size +
      ', Cuencas: ' + state.basins.size);
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

// Rutas API
app.use('/api/stations', require('./routes/stations')(state));
app.use('/api/basins', require('./routes/basins')(state, hydro));
app.use('/api/hydro', require('./routes/hydro')(state, hydro));
app.use('/api/radar', require('./routes/radar')(state, radar));
app.use('/api/alerts', require('./routes/alerts')(state));
app.use('/api/spatial', require('./routes/spatial')(state, spatial, radar));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Programacion de actualizaciones
cron.schedule('*/5 * * * *', updateCycle);  // Cada 5 min
cron.schedule('*/10 * * * *', updateRadar); // Cada 10 min

// WebSocket
wss.on('connection', (ws) => {
  console.log('[WS] Cliente conectado');
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      stations: Array.from(state.stations.values()),
      basins: Array.from(state.basins.values()).map(b => ({
        id: b.id, name: b.name, type: b.type, area: b.area,
        currentFlow: b.currentFlow, precipitation: b.precipitation,
        thresholds: b.thresholds, controlPoint: b.controlPoint,
        bounds: b.bounds,
        subcatchmentCount: (b.subcatchments || []).length,
        alerts: b.alerts
      })),
      alerts: state.alerts,
      lastUpdate: state.lastUpdate
    }
  }));
  ws.on('close', () => console.log('[WS] Cliente desconectado'));
});

// Arranque
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('[SERVER] HidroAlerta-SE en puerto ' + PORT);
  console.log('[SERVER] Cuencas cargadas: ' + state.basins.size);
  const totalSubs = Array.from(state.basins.values())
    .reduce((sum, b) => sum + (b.subcatchments || []).length, 0);
  console.log('[SERVER] Subcuencas totales: ' + totalSubs);
  updateCycle();
  updateRadar();
});
