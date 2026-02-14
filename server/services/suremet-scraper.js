const axios = require('axios');
const { parseStringPromise } = require('xml2js');

const PROVINCES = ['MU', 'AL', 'GR', 'AB', 'A', 'J'];
const BASE_URL = 'https://suremet.es/xml_completo.php';

class SuremetScraper {
  constructor() {
    this.cache = new Map();
    this.lastFetch = null;
  }

  async fetchProvince(code) {
    try {
      const url = `${BASE_URL}?pr=${code}`;
      const resp = await axios.get(url, { timeout: 15000 });
      const parsed = await parseStringPromise(resp.data, { explicitArray: false });
      const stations = parsed?.estaciones?.estacion;
      if (!stations) return [];
      const arr = Array.isArray(stations) ? stations : [stations];
      return arr.map(s => ({
        id: s.nombre || s.id,
        name: s.nombre || 'Unknown',
        province: code,
        lat: parseFloat(s.latitud) || 0,
        lon: parseFloat(s.longitud) || 0,
        altitude: parseFloat(s.altitud) || 0,
        temperature: parseFloat(s.temperatura) || null,
        tempMax: parseFloat(s.temp_max) || null,
        tempMin: parseFloat(s.temp_min) || null,
        humidity: parseFloat(s.humedad) || null,
        pressure: parseFloat(s.presion) || null,
        precipitation: parseFloat(s.precipitacion) || 0,
        intensity: parseFloat(s.intensidad) || 0,
        windSpeed: parseFloat(s.viento_velocidad) || 0,
        windDir: parseFloat(s.viento_direccion) || 0,
        timestamp: s.fecha || new Date().toISOString(),
        online: s.estado !== 'offline'
      })).filter(s => s.lat !== 0 && s.lon !== 0);
    } catch (err) {
      console.error(`[SUREMET] Error fetching ${code}: ${err.message}`);
      return [];
    }
  }

  async fetchAllStations() {
    const results = await Promise.allSettled(
      PROVINCES.map(code => this.fetchProvince(code))
    );
    const stations = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
    this.lastFetch = new Date();
    stations.forEach(s => this.cache.set(s.id, s));
    return stations;
  }

  getCached() {
    return Array.from(this.cache.values());
  }
}

module.exports = SuremetScraper;
