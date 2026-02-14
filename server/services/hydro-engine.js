/**
 * Motor Hidrologico Semi-Distribuido - HidroAlerta SE
 * 
 * Modelo por subcuencas con transito de avenida:
 * 1. Calcula hidrograma de cada subcuenca con su precipitacion local
 * 2. Propaga cada hidrograma al punto de control (Muskingum-Cunge)
 * 3. Superpone todos los hidrogramas propagados
 * 
 * Metodos: SCS-CN, Clark UH, Racional Modificado, Muskingum, Temez
 */

class HydroEngine {

  /**
   * Formula de Temez: tc = 0.3 * (L / S^0.25)^0.76 (horas)
   */
  calculateTc(sub) {
    if (sub.tc) return sub.tc;
    const L = sub.cauceLength || Math.sqrt(sub.area) * 1.5;
    const S = sub.slope || 5;
    return 0.3 * Math.pow(L / Math.pow(S, 0.25), 0.76);
  }

  /**
   * SCS-CN: Pe = (P - 0.2*S)^2 / (P + 0.8*S), S = (25400/CN) - 254
   */
  scsCurveNumber(P, cn) {
    const S = (25400 / cn) - 254;
    const Ia = 0.2 * S;
    if (P <= Ia) return 0;
    return Math.pow(P - Ia, 2) / (P + 0.8 * S);
  }

  /**
   * Racional Modificado: Q = C * I * A / 3.6 (m3/s)
   */
  rationalMethod(sub, intensity) {
    const C = this.cnToRunoffCoeff(sub.cn);
    return (C * intensity * sub.area) / 3.6;
  }

  cnToRunoffCoeff(cn) {
    if (cn >= 90) return 0.85;
    if (cn >= 85) return 0.72;
    if (cn >= 80) return 0.60;
    if (cn >= 75) return 0.50;
    if (cn >= 70) return 0.40;
    if (cn >= 65) return 0.30;
    if (cn >= 60) return 0.22;
    return 0.15;
  }

  /**
   * Hidrograma Unitario de Clark
   * Curva tiempo-area parabolica + embalse lineal
   * dt: paso temporal en horas (default 0.25 = 15 min)
   */
  clarkUnitHydrograph(sub, Pe, dt) {
    dt = dt || 0.25;
    const tc = this.calculateTc(sub);
    const R = sub.storageCoeff || tc * 0.7;
    const totalTime = tc + R * 4;
    const nSteps = Math.ceil(totalTime / dt);
    const C1 = dt / (R + 0.5 * dt);
    const C2 = 1 - C1;

    // Curva tiempo-area parabolica (S-curve)
    const taf = (f) => {
      if (f <= 0) return 0;
      if (f >= 1) return 1;
      return f <= 0.5 ? 2*f*f : 1 - 2*(1-f)*(1-f);
    };

    // Fase 1: inflow desde curva tiempo-area
    const inflow = [];
    const vol = (Pe / 1000) * sub.area * 1e6; // m3 totales
    for (let i = 0; i < nSteps; i++) {
      const t = i * dt;
      if (t <= tc && tc > 0) {
        const A1 = taf(t / tc);
        const A0 = i > 0 ? taf((t - dt) / tc) : 0;
        inflow.push(Math.max(0, A1 - A0) * vol / (dt * 3600));
      } else {
        inflow.push(0);
      }
    }

    // Fase 2: embalse lineal (atenuacion)
    const hydrograph = [];
    let Qp = 0;
    for (let i = 0; i < nSteps; i++) {
      const Q = C1 * inflow[i] + C2 * Qp;
      hydrograph.push({ time: Math.round(i * dt * 100) / 100, flow: Math.max(0, Q) });
      Qp = Q;
    }
    return hydrograph;
  }

  // ============================================================
  //  TRANSITO MUSKINGUM
  // ============================================================

  /**
   * Propaga un hidrograma por un tramo de cauce usando Muskingum.
   * K: tiempo de transito del tramo (horas)
   * X: factor de ponderacion (0=embalse puro, 0.5=onda cinematica)
   * reaches: numero de tramos en serie
   *
   * Ecuacion: O2 = C0*I2 + C1*I1 + C2*O1
   *   C0 = (-K*X + 0.5*dt) / (K - K*X + 0.5*dt)
   *   C1 = (K*X + 0.5*dt) / (K - K*X + 0.5*dt)
   *   C2 = (K - K*X - 0.5*dt) / (K - K*X + 0.5*dt)
   */
  muskingumRouting(hydrograph, routing, dt) {
    if (!routing || !routing.K) return hydrograph;
    dt = dt || 0.25;
    const K = routing.K;
    const X = routing.X || 0.2;
    const reaches = routing.reaches || 1;

    let current = hydrograph.map(h => h.flow);

    for (let r = 0; r < reaches; r++) {
      const denom = K - K * X + 0.5 * dt;
      if (denom <= 0) continue;
      const C0 = (-K * X + 0.5 * dt) / denom;
      const C1 = (K * X + 0.5 * dt) / denom;
      const C2 = (K - K * X - 0.5 * dt) / denom;

      const routed = [current[0]];
      for (let i = 1; i < current.length; i++) {
        const O = C0 * current[i] + C1 * current[i-1] + C2 * routed[i-1];
        routed.push(Math.max(0, O));
      }
      current = routed;
    }

    return current.map((flow, i) => ({
      time: hydrograph[i] ? hydrograph[i].time : i * dt,
      flow: flow
    }));
  }

  // ============================================================
  //  CALCULO POR SUBCUENCA INDIVIDUAL
  // ============================================================

  /**
   * Calcula hidrograma de UNA subcuenca con su precipitacion local.
   * @param {Object} sub - subcuenca con cn, area, tc, slope, etc.
   * @param {number} precip - precipitacion local (mm) de interpolacion espacial
   * @param {number} intensity - intensidad maxima local (mm/h)
   * @returns {Object} resultado con hidrograma y caudal punta
   */
  calculateSubcatchment(sub, precip, intensity) {
    const dt = 0.25; // 15 min
    const tc = this.calculateTc(sub);
    const Pe = this.scsCurveNumber(precip, sub.cn);
    const Qrational = this.rationalMethod(sub, intensity);

    let hydrograph = [];
    let Qpeak = 0;

    if (Pe > 0) {
      hydrograph = this.clarkUnitHydrograph(sub, Pe, dt);
      Qpeak = Math.max(...hydrograph.map(h => h.flow));
    }

    // Usar el mayor entre Clark y Racional como referencia
    const peakFlow = Math.max(Qrational, Qpeak);

    return {
      subId: sub.id,
      subName: sub.name,
      area: sub.area,
      tc,
      cn: sub.cn,
      precipitation: precip,
      intensity,
      effectiveRainfall: Pe,
      rationalFlow: Math.round(Qrational * 10) / 10,
      clarkPeakFlow: Math.round(Qpeak * 10) / 10,
      peakFlow: Math.round(peakFlow * 10) / 10,
      hydrograph,
      dt
    };
  }

  // ============================================================
  //  MODELO SEMI-DISTRIBUIDO: CUENCA COMPLETA
  // ============================================================

  /**
   * CALCULO PRINCIPAL: modelo semi-distribuido para una cuenca.
   *
   * Para cada subcuenca:
   *   1. Recibe precipitacion local (del interpolador espacial)
   *   2. Calcula escorrentia (SCS-CN) e hidrograma (Clark)
   *   3. Propaga el hidrograma al punto de control (Muskingum)
   *
   * Finalmente superpone todos los hidrogramas propagados.
   *
   * @param {Object} basin - cuenca con subcatchments[]
   * @param {Object} subcatchmentPrecip - {subId: {precip, intensity}}
   * @returns {Object} resultado completo con hidrograma agregado
   */
  calculateBasinDistributed(basin, subcatchmentPrecip) {
    const dt = 0.25;
    const subs = basin.subcatchments || [];

    if (subs.length === 0) {
      // Sin subcuencas: modelo agregado clasico
      const p = subcatchmentPrecip.mean || 0;
      const i = subcatchmentPrecip.maxIntensity || 0;
      return this.calculateLumped(basin, p, i);
    }

    // 1. Calcular hidrograma de cada subcuenca
    const subResults = [];
    let maxTime = 0;

    for (const sub of subs) {
      const pData = subcatchmentPrecip[sub.id] || { precip: 0, intensity: 0 };
      const result = this.calculateSubcatchment(sub, pData.precip, pData.intensity);

      // 2. Propagar al punto de control
      if (result.hydrograph.length > 0 && sub.routingToOutlet) {
        result.routedHydrograph = this.muskingumRouting(
          result.hydrograph, sub.routingToOutlet, dt
        );
      } else {
        result.routedHydrograph = result.hydrograph;
      }

      if (result.routedHydrograph.length > 0) {
        const lastTime = result.routedHydrograph[result.routedHydrograph.length - 1].time;
        if (lastTime > maxTime) maxTime = lastTime;
      }

      subResults.push(result);
    }

    // 3. Superponer hidrogramas en el punto de control
    const nSteps = Math.ceil(maxTime / dt) + 1;
    const compositeHydrograph = [];

    for (let i = 0; i < nSteps; i++) {
      const t = Math.round(i * dt * 100) / 100;
      let totalFlow = 0;

      for (const sr of subResults) {
        const rh = sr.routedHydrograph;
        if (rh && rh[i]) {
          totalFlow += rh[i].flow;
        }
      }

      compositeHydrograph.push({ time: t, flow: totalFlow });
    }

    const peakFlow = compositeHydrograph.length > 0
      ? Math.max(...compositeHydrograph.map(h => h.flow))
      : 0;
    const peakTime = compositeHydrograph.length > 0
      ? compositeHydrograph.find(h => h.flow === peakFlow)?.time || 0
      : 0;

    return {
      basinId: basin.id,
      basinName: basin.name,
      type: basin.type,
      method: 'semi_distributed',
      dt,
      peakFlow: Math.round(peakFlow * 10) / 10,
      peakTime: Math.round(peakTime * 100) / 100,
      compositeHydrograph,
      subcatchmentResults: subResults.map(sr => ({
        subId: sr.subId,
        subName: sr.subName,
        area: sr.area,
        precipitation: sr.precipitation,
        intensity: sr.intensity,
        effectiveRainfall: sr.effectiveRainfall,
        peakFlow: sr.peakFlow,
        routedPeak: sr.routedHydrograph.length > 0
          ? Math.round(Math.max(...sr.routedHydrograph.map(h => h.flow)) * 10) / 10
          : 0,
        tc: sr.tc,
        cn: sr.cn
      })),
      timestamp: new Date().toISOString()
    };
  }

  // ============================================================
  //  MODELO AGREGADO (fallback sin subcuencas)
  // ============================================================

  /**
   * Modelo clasico agregado: toda la cuenca con un solo valor.
   * Se usa como fallback cuando no hay subcuencas definidas.
   */
  calculateLumped(basin, precipitation, intensity) {
    const dt = 0.25;
    const tc = this.calculateTc(basin);
    const cn = basin.cn || 75;
    const Pe = this.scsCurveNumber(precipitation, cn);
    const Qr = this.rationalMethod({ cn, area: basin.area }, intensity);
    const hydrograph = Pe > 0
      ? this.clarkUnitHydrograph({ ...basin, cn }, Pe, dt)
      : [];
    const Qc = hydrograph.length > 0
      ? Math.max(...hydrograph.map(h => h.flow)) : 0;

    return {
      basinId: basin.id,
      basinName: basin.name,
      type: basin.type,
      method: 'lumped',
      dt,
      peakFlow: Math.round(Math.max(Qr, Qc) * 10) / 10,
      compositeHydrograph: hydrograph,
      subcatchmentResults: [],
      tc,
      effectiveRainfall: Pe,
      timestamp: new Date().toISOString()
    };
  }

  // ============================================================
  //  COMPATIBILIDAD: metodo antiguo
  // ============================================================

  /**
   * calculateFlow - mantiene compatibilidad con codigo anterior.
   * Redirige al modelo agregado.
   */
  calculateFlow(basin, precipitation, intensity) {
    const tc = this.calculateTc(basin);
    const cn = basin.cn || 75;
    const Pe = this.scsCurveNumber(precipitation, cn);
    const Qr = this.rationalMethod({ cn, area: basin.area }, intensity);
    const hydrograph = Pe > 0
      ? this.clarkUnitHydrograph({ ...basin, cn }, Pe, 0.25) : [];
    const Qc = hydrograph.length > 0
      ? Math.max(...hydrograph.map(h => h.flow)) : 0;
    const peakFlow = Math.max(Qr, Qc);

    return {
      tc,
      effectiveRainfall: Pe,
      rationalFlow: Qr,
      clarkPeakFlow: Qc,
      peakFlow,
      hydrograph,
      method: Qr > Qc ? 'rational' : 'clark',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = HydroEngine;
