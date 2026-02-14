/**
 * Interpolacion Espacial y Fusion Radar-Estaciones
 *
 * Metodos: IDW, Thiessen, Fusion Radar-Pluviometro (Conditional Merging)
 * Ahora con estimacion POR SUBCUENCA para modelo semi-distribuido.
 */

class SpatialInterpolator {
  constructor() {
    this.idwPower = 2;
    this.searchRadius = 50;
    this.radarWeight = 0.4;
    this.gridResolution = 0.02;
  }

  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
      Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
      Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  idw(lat, lon, stations, field) {
    field = field || 'precipitation';
    let sumWV = 0, sumW = 0, exact = null;
    for (const st of stations) {
      const d = this.haversineDistance(lat, lon, st.lat, st.lon);
      if (d < 0.01) { exact = st[field] || 0; break; }
      if (d > this.searchRadius) continue;
      const w = 1 / Math.pow(d, this.idwPower);
      sumWV += w * (st[field] || 0);
      sumW += w;
    }
    if (exact !== null) return exact;
    return sumW > 0 ? sumWV / sumW : 0;
  }

  thiessen(lat, lon, stations, field) {
    field = field || 'precipitation';
    let minD = Infinity, nearest = null;
    for (const st of stations) {
      const d = this.haversineDistance(lat, lon, st.lat, st.lon);
      if (d < minD) { minD = d; nearest = st; }
    }
    return nearest ? (nearest[field] || 0) : 0;
  }

  generateGrid(bounds) {
    const grid = [];
    for (let lat = bounds.south; lat <= bounds.north; lat += this.gridResolution) {
      for (let lon = bounds.west; lon <= bounds.east; lon += this.gridResolution) {
        grid.push({
          lat: Math.round(lat * 1000) / 1000,
          lon: Math.round(lon * 1000) / 1000
        });
      }
    }
    return grid;
  }

  /**
   * Interpola precipitacion sobre una region (subcuenca o cuenca)
   */
  interpolateRegion(bounds, stations) {
    if (!stations || stations.length === 0) {
      return { meanPrecip: 0, maxPrecip: 0, meanIntensity: 0, maxIntensity: 0, grid: [], stationCount: 0, method: 'none' };
    }
    const grid = this.generateGrid(bounds);
    let totalP = 0, totalI = 0, maxP = 0, maxI = 0;
    const interpGrid = grid.map(pt => {
      const p = this.idw(pt.lat, pt.lon, stations, 'precipitation');
      const i = this.idw(pt.lat, pt.lon, stations, 'intensity');
      totalP += p; totalI += i;
      if (p > maxP) maxP = p;
      if (i > maxI) maxI = i;
      return { ...pt, precipitation: Math.round(p*10)/10, intensity: Math.round(i*10)/10 };
    });
    const cnt = grid.length || 1;
    return {
      meanPrecip: Math.round((totalP/cnt)*10)/10,
      maxPrecip: Math.round(maxP*10)/10,
      meanIntensity: Math.round((totalI/cnt)*10)/10,
      maxIntensity: Math.round(maxI*10)/10,
      grid: interpGrid,
      gridPoints: cnt,
      stationCount: stations.length,
      method: 'idw'
    };
  }

  // Alias de compatibilidad
  interpolateBasin(basin, stations) {
    return this.interpolateRegion(basin.bounds, stations);
  }

  /**
   * IDW desde grilla generica
   */
  idwFromGrid(lat, lon, grid, field) {
    let sumWV = 0, sumW = 0;
    for (const p of grid) {
      const d = this.haversineDistance(lat, lon, p.lat, p.lon);
      if (d < 0.01) return p[field] || 0;
      if (d > this.searchRadius) continue;
      const w = 1 / Math.pow(d, this.idwPower);
      sumWV += w * (p[field] || 0);
      sumW += w;
    }
    return sumW > 0 ? sumWV / sumW : 0;
  }

  /**
   * Fusion Radar-Estaciones (Conditional Merging, Sinclair & Pegram 2005)
   */
  fuseRadarStations(bounds, stations, radarService, radarGrid) {
    if (!radarGrid || radarGrid.length === 0) {
      return this.interpolateRegion(bounds, stations);
    }
    if (!stations || stations.length === 0) {
      return this.radarOnlyEstimate(bounds, radarGrid, radarService);
    }

    const radarPrecip = radarGrid.map(p => ({
      ...p, radarMM: radarService.dBZtoRainRate(p.dBZ || 0, 'marshall_palmer')
    }));

    // Calcular ratios de sesgo estacion/radar
    const biasPoints = [];
    for (const st of stations) {
      let minD = Infinity, nearR = null;
      for (const rp of radarPrecip) {
        const d = this.haversineDistance(st.lat, st.lon, rp.lat, rp.lon);
        if (d < minD) { minD = d; nearR = rp; }
      }
      if (nearR && nearR.radarMM > 0.1) {
        biasPoints.push({
          lat: st.lat, lon: st.lon,
          ratio: Math.min((st.precipitation || 0) / nearR.radarMM, 5)
        });
      } else if ((st.precipitation || 0) > 0) {
        biasPoints.push({ lat: st.lat, lon: st.lon, ratio: 3.0 });
      }
    }

    const grid = this.generateGrid(bounds);
    let totalP = 0, maxP = 0;
    const fusedGrid = grid.map(pt => {
      const radarVal = this.idwFromGrid(pt.lat, pt.lon, radarPrecip, 'radarMM');
      let cf = 1.0;
      if (biasPoints.length > 0) {
        cf = this.idwFromGrid(pt.lat, pt.lon, biasPoints, 'ratio');
        cf = Math.max(0.1, Math.min(cf, 5.0));
      }
      const stVal = this.idw(pt.lat, pt.lon, stations, 'precipitation');
      const fused = this.radarWeight * (radarVal * cf) + (1 - this.radarWeight) * stVal;
      totalP += fused;
      if (fused > maxP) maxP = fused;
      return { ...pt, precipitation: Math.round(fused*10)/10 };
    });

    const cnt = grid.length || 1;
    return {
      meanPrecip: Math.round((totalP/cnt)*10)/10,
      maxPrecip: Math.round(maxP*10)/10,
      grid: fusedGrid, gridPoints: cnt,
      stationCount: stations.length,
      method: 'radar_station_fusion',
      radarWeight: this.radarWeight
    };
  }

  radarOnlyEstimate(bounds, radarGrid, radarService) {
    const grid = this.generateGrid(bounds);
    const rp = radarGrid.map(p => ({
      ...p, radarMM: radarService.dBZtoRainRate(p.dBZ || 0, 'marshall_palmer')
    }));
    let total = 0, maxP = 0;
    const result = grid.map(pt => {
      const v = this.idwFromGrid(pt.lat, pt.lon, rp, 'radarMM');
      total += v; if (v > maxP) maxP = v;
      return { ...pt, precipitation: Math.round(v*10)/10 };
    });
    const cnt = grid.length || 1;
    return {
      meanPrecip: Math.round((total/cnt)*10)/10,
      maxPrecip: Math.round(maxP*10)/10,
      grid: result, gridPoints: cnt, stationCount: 0,
      method: 'radar_only'
    };
  }

  // ============================================================
  //  ESTIMACION POR SUBCUENCA (MODELO SEMI-DISTRIBUIDO)
  // ============================================================

  /**
   * Estima precipitacion PARA CADA SUBCUENCA de una cuenca.
   * Devuelve un objeto {subId: {precip, intensity}} que el HydroEngine
   * usa para calcular el hidrograma de cada subcuenca por separado.
   *
   * Flujo:
   *   1. Filtra estaciones y radar dentro del area de la cuenca global
   *   2. Para cada subcuenca, interpola sobre su propia grilla
   *   3. Si hay radar, aplica fusion radar-estaciones por subcuenca
   *   4. Devuelve precipitacion media y maxima intensidad por subcuenca
   *
   * @param {Object} basin - cuenca con subcatchments[]
   * @param {Array} allStations - todas las estaciones SUREMET
   * @param {Object} radarService - servicio radar AEMET
   * @param {Array|null} radarGrid - grilla de reflectividad
   * @returns {Object} {subId: {precip, intensity}, mean, maxIntensity, ...}
   */
  estimateSubcatchmentPrecip(basin, allStations, radarService, radarGrid) {
    const margin = 0.15;
    const subs = basin.subcatchments || [];

    // Filtrar estaciones en area general de la cuenca
    const basinStations = allStations.filter(st =>
      st.lat >= (basin.bounds.south - margin) &&
      st.lat <= (basin.bounds.north + margin) &&
      st.lon >= (basin.bounds.west - margin) &&
      st.lon <= (basin.bounds.east + margin) &&
      st.online !== false
    );

    // Filtrar radar para la cuenca
    let basinRadar = null;
    if (radarGrid && radarGrid.length > 0) {
      basinRadar = radarGrid.filter(r =>
        r.lat >= basin.bounds.south && r.lat <= basin.bounds.north &&
        r.lon >= basin.bounds.west && r.lon <= basin.bounds.east
      );
    }
    const hasRadar = basinRadar && basinRadar.length > 0;

    // Si no hay subcuencas, devolver formato compatible
    if (subs.length === 0) {
      const result = hasRadar && basinStations.length > 0
        ? this.fuseRadarStations(basin.bounds, basinStations, radarService, basinRadar)
        : this.interpolateRegion(basin.bounds, basinStations);
      return {
        mean: result.meanPrecip,
        maxIntensity: result.maxPrecip,
        method: result.method,
        basinId: basin.id,
        stationsUsed: basinStations.length,
        subcatchmentCount: 0
      };
    }

    // Para cada subcuenca: estimar precipitacion local
    const subPrecip = {};
    let totalWeightedP = 0, totalArea = 0;
    let globalMaxIntensity = 0;

    for (const sub of subs) {
      // Filtrar estaciones cercanas a esta subcuenca
      const subMargin = 0.08;
      const subStations = basinStations.filter(st =>
        st.lat >= (sub.bounds.south - subMargin) &&
        st.lat <= (sub.bounds.north + subMargin) &&
        st.lon >= (sub.bounds.west - subMargin) &&
        st.lon <= (sub.bounds.east + subMargin)
      );

      // Filtrar radar para esta subcuenca
      let subRadar = null;
      if (hasRadar) {
        subRadar = basinRadar.filter(r =>
          r.lat >= sub.bounds.south && r.lat <= sub.bounds.north &&
          r.lon >= sub.bounds.west && r.lon <= sub.bounds.east
        );
      }
      const subHasRadar = subRadar && subRadar.length > 0;

      let estimate;
      if (subHasRadar && subStations.length > 0) {
        estimate = this.fuseRadarStations(sub.bounds, subStations, radarService, subRadar);
      } else if (subStations.length > 0) {
        estimate = this.interpolateRegion(sub.bounds, subStations);
      } else if (subHasRadar) {
        estimate = this.radarOnlyEstimate(sub.bounds, subRadar, radarService);
      } else {
        estimate = { meanPrecip: 0, maxPrecip: 0, meanIntensity: 0, maxIntensity: 0, method: 'no_data' };
      }

      const precip = estimate.meanPrecip || 0;
      const intensity = estimate.maxIntensity || estimate.maxPrecip || 0;

      subPrecip[sub.id] = {
        precip: precip,
        intensity: intensity,
        method: estimate.method,
        stationsUsed: subStations.length,
        radarPixels: subHasRadar ? subRadar.length : 0
      };

      totalWeightedP += precip * sub.area;
      totalArea += sub.area;
      if (intensity > globalMaxIntensity) globalMaxIntensity = intensity;
    }

    const meanBasinPrecip = totalArea > 0
      ? Math.round((totalWeightedP / totalArea) * 10) / 10
      : 0;

    return {
      ...subPrecip,
      mean: meanBasinPrecip,
      maxIntensity: Math.round(globalMaxIntensity * 10) / 10,
      method: hasRadar ? 'distributed_fusion' : 'distributed_idw',
      basinId: basin.id,
      stationsUsed: basinStations.length,
      subcatchmentCount: subs.length
    };
  }

  // ============================================================
  //  COMPATIBILIDAD: metodo anterior
  // ============================================================

  /**
   * estimateBasinPrecipitation - mantiene compatibilidad.
   * Ahora delega en estimateSubcatchmentPrecip.
   */
  estimateBasinPrecipitation(basin, allStations, radarService, radarGrid) {
    const result = this.estimateSubcatchmentPrecip(basin, allStations, radarService, radarGrid);
    return {
      basinId: basin.id,
      basinName: basin.name,
      meanPrecip: result.mean,
      maxPrecip: result.maxIntensity,
      method: result.method,
      stationCount: result.stationsUsed,
      subcatchmentCount: result.subcatchmentCount,
      sources: {
        stationsUsed: result.stationsUsed,
        hasRadar: result.method.includes('fusion'),
        hasStations: result.stationsUsed > 0
      }
    };
  }
}

module.exports = SpatialInterpolator;
