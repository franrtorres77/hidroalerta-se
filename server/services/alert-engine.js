/**
 * Motor de Alertas - HidroAlerta SE
 * Evalua umbrales de precipitacion, caudal e intensidad por cuenca
 */
class AlertEngine {
  constructor() {
    this.history = [];
  }

  evaluate(basins) {
    const alerts = [];
    const now = new Date().toISOString();

    for (const [id, basin] of basins) {
      if (!basin.hydroResult) continue;
      const thresholds = basin.thresholds || { yellow: 50, orange: 150, red: 300 };
      const flow = basin.currentFlow || 0;
      const precip = basin.precipitation || 0;
      const intensity = basin.intensity || 0;

      let level = 'green';
      let message = 'Normal';

      if (flow >= thresholds.red || intensity >= 60 || precip >= 100) {
        level = 'red';
        message = 'ALERTA ROJA: Riesgo extremo de riada';
      } else if (flow >= thresholds.orange || intensity >= 30 || precip >= 50) {
        level = 'orange';
        message = 'ALERTA NARANJA: Riesgo alto de crecida';
      } else if (flow >= thresholds.yellow || intensity >= 15 || precip >= 20) {
        level = 'yellow';
        message = 'AVISO AMARILLO: Precipitaciones significativas';
      }

      if (level !== 'green') {
        alerts.push({
          basinId: id,
          basinName: basin.name,
          level,
          message,
          flow: Math.round(flow * 100) / 100,
          precipitation: Math.round(precip * 10) / 10,
          intensity: Math.round(intensity * 10) / 10,
          timestamp: now
        });
      }
    }

    // Sort by severity
    const order = { red: 0, orange: 1, yellow: 2 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);
    this.history.push(...alerts);
    if (this.history.length > 1000) this.history = this.history.slice(-500);
    return alerts;
  }

  getHistory(limit) {
    return this.history.slice(-(limit || 100));
  }
}

module.exports = AlertEngine;
