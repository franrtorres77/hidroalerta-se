const axios = require('axios');

/**
 * Radar AEMET - Conversion reflectividad (dBZ) a precipitacion (mm/h)
 * Relacion Z-R: Z = a * R^b
 * Marshall-Palmer: a=200, b=1.6 (estratiforme)
 * Convectiva: a=300, b=1.4
 */
class RadarAemet {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://opendata.aemet.es/opendata/api';
    this.zrRelations = {
      marshall_palmer: { a: 200, b: 1.6, name: 'Marshall-Palmer (estratiforme)' },
      convective: { a: 300, b: 1.4, name: 'Convectiva' }
    };
  }

  /**
   * Convierte reflectividad (dBZ) a tasa de precipitacion (mm/h)
   * Z(mm6/m3) = 10^(dBZ/10)
   * R = (Z/a)^(1/b)
   */
  dBZtoRainRate(dBZ, type) {
    type = type || 'marshall_palmer';
    const { a, b } = this.zrRelations[type];
    const Z = Math.pow(10, dBZ / 10);
    return Math.pow(Z / a, 1 / b);
  }

  /**
   * Clasifica la intensidad de precipitacion
   */
  classifyIntensity(rainRate) {
    if (rainRate < 1) return { level: 'none', label: 'Sin precipitacion', color: '#2d3436' };
    if (rainRate < 5) return { level: 'light', label: 'Debil', color: '#74b9ff' };
    if (rainRate < 15) return { level: 'moderate', label: 'Moderada', color: '#0984e3' };
    if (rainRate < 30) return { level: 'heavy', label: 'Fuerte', color: '#fdcb6e' };
    if (rainRate < 60) return { level: 'very_heavy', label: 'Muy fuerte', color: '#e17055' };
    return { level: 'torrential', label: 'Torrencial', color: '#d63031' };
  }

  /**
   * Obtiene datos de radar de AEMET
   */
  async fetchRadarData() {
    if (!this.apiKey) return { error: 'No AEMET API key configured' };
    try {
      const resp = await axios.get(
        `${this.baseUrl}/red/radar/nacional`,
        { headers: { api_key: this.apiKey }, timeout: 10000 }
      );
      if (resp.data && resp.data.datos) {
        const dataResp = await axios.get(resp.data.datos, { timeout: 10000 });
        return {
          imageUrl: resp.data.datos,
          timestamp: new Date().toISOString(),
          metadata: resp.data.metadatos || null
        };
      }
      return { error: 'No radar data available' };
    } catch (err) {
      console.error('[RADAR] AEMET API error:', err.message);
      return { error: err.message };
    }
  }

  /**
   * Procesa array de valores dBZ a precipitacion
   */
  processReflectivityGrid(grid, type) {
    return grid.map(row =>
      row.map(dBZ => ({
        dBZ,
        rainRate: this.dBZtoRainRate(dBZ, type),
        classification: this.classifyIntensity(this.dBZtoRainRate(dBZ, type))
      }))
    );
  }
}

module.exports = RadarAemet;
