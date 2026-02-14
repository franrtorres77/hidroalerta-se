/**
 * Motor Hidrologico - HidroAlerta SE
 * Metodos: SCS-CN (NRCS TR-55), Metodo Racional Modificado, Clark UH
 * Formula Tc: Temez (recomendada para Espana)
 */

class HydroEngine {
  /**
   * Calcula el tiempo de concentracion usando la formula de Temez
   * tc = 0.3 * (L / S^0.25)^0.76  (horas)
   * L: longitud del cauce principal (km), S: pendiente media (%)
   */
  calculateTc(basin) {
    if (basin.tc) return basin.tc;
    const L = basin.cauceLength || Math.sqrt(basin.area) * 1.5;
    const S = basin.slope || 5;
    return 0.3 * Math.pow(L / Math.pow(S, 0.25), 0.76);
  }

  /**
   * Metodo SCS-CN (Soil Conservation Service - Curve Number)
   * Calcula la escorrentia efectiva
   * Pe = (P - 0.2*S)^2 / (P + 0.8*S)  donde S = (25400/CN) - 254
   */
  scsCurveNumber(precipitation, cn) {
    const S = (25400 / cn) - 254;
    const Ia = 0.2 * S;
    if (precipitation <= Ia) return 0;
    const Pe = Math.pow(precipitation - Ia, 2) / (precipitation + 0.8 * S);
    return Pe;
  }

  /**
   * Metodo Racional Modificado
   * Q = C * I * A / 3.6  (m3/s)
   * C: coef. escorrentia, I: intensidad (mm/h), A: area (km2)
   */
  rationalMethod(basin, intensity) {
    const C = this.getRunoffCoefficient(basin.cn);
    const A = basin.area;
    return (C * intensity * A) / 3.6;
  }

  /**
   * Hidrograma Unitario de Clark
   * Usa tc y R (coef. almacenamiento) para generar hidrograma
   */
  clarkUnitHydrograph(basin, effectiveRainfall, duration) {
    const tc = this.calculateTc(basin);
    const R = basin.storageCoeff || tc * 0.7;
    const dt = duration || 1;
    const n = Math.ceil((tc + R * 3) / dt);
    const hydrograph = [];
    const C1 = dt / (R + 0.5 * dt);
    const C2 = 1 - C1;

    let inflow = [];
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      if (t <= tc) {
        inflow.push((effectiveRainfall * basin.area * 1000) / (tc * 3600));
      } else {
        inflow.push(0);
      }
    }

    let Q_prev = 0;
    for (let i = 0; i < n; i++) {
      const Q = C1 * inflow[i] + C2 * Q_prev;
      hydrograph.push({ time: i * dt, flow: Math.max(0, Q) });
      Q_prev = Q;
    }
    return hydrograph;
  }

  /**
   * Convierte CN a coeficiente de escorrentia
   */
  getRunoffCoefficient(cn) {
    if (cn >= 90) return 0.8;
    if (cn >= 80) return 0.6;
    if (cn >= 70) return 0.45;
    if (cn >= 60) return 0.3;
    return 0.2;
  }

  /**
   * Calculo principal: combina todos los metodos
   */
  calculateFlow(basin, precipitation, intensity) {
    const tc = this.calculateTc(basin);
    const Pe = this.scsCurveNumber(precipitation, basin.cn);
    const Q_rational = this.rationalMethod(basin, intensity);
    const hydrograph = this.clarkUnitHydrograph(basin, Pe, 1);
    const Q_clark = Math.max(...hydrograph.map(h => h.flow));
    const peakFlow = Math.max(Q_rational, Q_clark);

    return {
      tc,
      effectiveRainfall: Pe,
      rationalFlow: Q_rational,
      clarkPeakFlow: Q_clark,
      peakFlow,
      hydrograph,
      method: Q_rational > Q_clark ? 'rational' : 'clark',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = HydroEngine;
