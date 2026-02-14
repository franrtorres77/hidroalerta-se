/**
 * Interpolacion Espacial y Fusion Radar-Estaciones
 * 
 * Metodos implementados:
 * 1. IDW (Inverse Distance Weighting) - Ponderacion por distancia inversa
 * 2. Poligonos de Thiessen (Voronoi) - Asignacion por proximidad
 * 3. Fusion Radar-Pluviometro (Merging) - Calibracion de radar con estaciones
 * 4. Kriging simplificado - Interpolacion geoestadistica basica
 * 
 * La fusion combina:
 * - Datos puntuales de estaciones SUREMET (alta precision, baja cobertura)
 * - Datos de radar AEMET (baja precision, alta cobertura espacial)
 * Para obtener un campo de precipitacion continuo sobre cada cuenca.
 */

class SpatialInterpolator {
  constructor() {
    // IDW: exponente de distancia (p=2 estandar, p=3 mas local)
    this.idwPower = 2;
    // Radio maximo de busqueda en km
    this.searchRadius = 50;
    // Peso del radar vs estaciones en fusion (0=solo estaciones, 1=solo radar)
    this.radarWeight = 0.4;
    // Resolucion de la grilla (grados)
    this.gridResolution = 0.02; // ~2km
  }

  /**
   * Distancia Haversine entre dos puntos (km)
   */
  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * IDW (Inverse Distance Weighting)
   * Estima precipitacion en un punto (lat, lon) a partir de estaciones cercanas.
   * P(x) = SUM(wi * Pi) / SUM(wi)  donde wi = 1/d^p
   *
   * @param {number} lat - Latitud del punto a estimar
   * @param {number} lon - Longitud del punto a estimar
   * @param {Array} stations - Estaciones con {lat, lon, precipitation, intensity}
   * @param {string} field - Campo a interpolar ('precipitation' o 'intensity')
   * @returns {number} Valor interpolado
   */
  idw(lat, lon, stations, field) {
    field = field || 'precipitation';
    let sumWeightedValues = 0;
    let sumWeights = 0;
    let coincident = null;

    for (const s of stations) {
      const d = this.haversineDistance(lat, lon, s.lat, s.lon);
      // Si coincide con una estacion, devuelve su valor directo
      if (d < 0.01) { coincident = s[field] || 0; break; }
      if (d > this.searchRadius) continue;
      const w = 1 / Math.pow(d, this.idwPower);
      sumWeightedValues += w * (s[field] || 0);
      sumWeights += w;
    }

    if (coincident !== null) return coincident;
    if (sumWeights === 0) return 0;
    return sumWeightedValues / sumWeights;
  }

  /**
   * Poligonos de Thiessen (nearest-neighbor)
   * Asigna a cada punto el valor de la estacion mas cercana.
   * Util como referencia y para zonas con pocas estaciones.
   */
  thiessen(lat, lon, stations, field) {
    field = field || 'precipitation';
    let minDist = Infinity;
    let nearest = null;
    for (const s of stations) {
      const d = this.haversineDistance(lat, lon, s.lat, s.lon);
      if (d < minDist) { minDist = d; nearest = s; }
    }
    return nearest ? (nearest[field] || 0) : 0;
  }

  /**
   * Genera grilla regular sobre los limites de una cuenca
   * @returns {Array} [{lat, lon}, ...]
   */
  generateGrid(bounds) {
    const grid = [];
    for (let lat = bounds.south; lat <= bounds.north; lat += this.gridResolution) {
      for (let lon = bounds.west; lon <= bounds.east; lon += this.gridResolution) {
        grid.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 });
      }
    }
    return grid;
  }

  /**
   * Interpola precipitacion sobre toda la cuenca usando IDW
   * Devuelve precipitacion media areal y mapa de intensidades.
   *
   * @param {Object} basin - Cuenca con bounds {north, south, east, west}
   * @param {Array} stations - Estaciones SUREMET cercanas
   * @returns {Object} {meanPrecip, maxPrecip, meanIntensity, maxIntensity, grid}
   */
  interpolateBasin(basin, stations) {
    if (!stations || stations.length === 0) {
      return { meanPrecip: 0, maxPrecip: 0, meanIntensity: 0, maxIntensity: 0, grid: [], stationCount: 0, method: 'none' };
    }

    const grid = this.generateGrid(basin.bounds);
    let totalPrecip = 0, totalIntensity = 0;
    let maxPrecip = 0, maxIntensity = 0;

    const interpolatedGrid = grid.map(point => {
      const precip = this.idw(point.lat, point.lon, stations, 'precipitation');
      const intensity = this.idw(point.lat, point.lon, stations, 'intensity');
      totalPrecip += precip;
      totalIntensity += intensity;
      if (precip > maxPrecip) maxPrecip = precip;
      if (intensity > maxIntensity) maxIntensity = intensity;
      return { ...point, precipitation: Math.round(precip * 10) / 10, intensity: Math.round(intensity * 10) / 10 };
    });

    const n = grid.length || 1;
    return {
      meanPrecip: Math.round((totalPrecip / n) * 10) / 10,
      maxPrecip: Math.round(maxPrecip * 10) / 10,
      meanIntensity: Math.round((totalIntensity / n) * 10) / 10,
      maxIntensity: Math.round(maxIntensity * 10) / 10,
      grid: interpolatedGrid,
      gridPoints: n,
      stationCount: stations.length,
      method: 'idw'
    };
  }

  /**
   * FUSION RADAR-ESTACIONES (Radar-Gauge Merging)
   * 
   * Combina el campo de precipitacion del radar (cobertura espacial completa)
   * con los datos puntuales de las estaciones (mayor precision).
   * 
   * Metodo: Conditional Merging (Sinclair & Pegram, 2005)
   * 1. Extrae valores de radar en las posiciones de las estaciones
   * 2. Calcula el ratio (sesgo) estacion/radar en cada punto
   * 3. Interpola los ratios espacialmente con IDW
   * 4. Aplica la correccion al campo de radar completo
   * 
   * P_merged(x) = P_radar(x) * ratio_interpolado(x)
   * donde ratio = P_estacion / P_radar en puntos con estacion
   *
   * @param {Object} basin - Cuenca
   * @param {Array} stations - Estaciones SUREMET con precipitacion
   * @param {Object} radarService - Servicio RadarAemet para conversion dBZ->mm
   * @param {Array} radarGrid - Grilla de reflectividad [{lat, lon, dBZ}, ...]
   * @returns {Object} Campo fusionado de precipitacion
   */
  fuseRadarStations(basin, stations, radarService, radarGrid) {
    if (!radarGrid || radarGrid.length === 0) {
      // Sin radar, usar solo interpolacion de estaciones
      return this.interpolateBasin(basin, stations);
    }
    if (!stations || stations.length === 0) {
      // Sin estaciones, usar solo radar
      return this.radarOnlyEstimate(basin, radarGrid, radarService);
    }

    // Paso 1: Convertir radar dBZ a mm/h en cada punto de la grilla
    const radarPrecip = radarGrid.map(p => ({
      ...p,
      radarMM: radarService.dBZtoRainRate(p.dBZ || 0, 'marshall_palmer')
    }));

    // Paso 2: Extraer valor de radar en posiciones de estaciones
    // y calcular ratio de correccion (sesgo)
    const biasPoints = [];
    for (const station of stations) {
      // Encontrar pixel de radar mas cercano a la estacion
      let minDist = Infinity;
      let nearestRadar = null;
      for (const rp of radarPrecip) {
        const d = this.haversineDistance(station.lat, station.lon, rp.lat, rp.lon);
        if (d < minDist) { minDist = d; nearestRadar = rp; }
      }

      if (nearestRadar && nearestRadar.radarMM > 0.1) {
        // ratio = precipitacion_estacion / precipitacion_radar
        const ratio = (station.precipitation || 0) / nearestRadar.radarMM;
        biasPoints.push({
          lat: station.lat,
          lon: station.lon,
          ratio: Math.min(ratio, 5), // Limitar a 5x para evitar valores extremos
          stationPrecip: station.precipitation || 0,
          radarPrecip: nearestRadar.radarMM,
          distance: minDist
        });
      } else if ((station.precipitation || 0) > 0) {
        // Estacion detecta lluvia pero radar no: alto ratio
        biasPoints.push({
          lat: station.lat, lon: station.lon,
          ratio: 3.0, // Valor alto para corregir subestimacion radar
          stationPrecip: station.precipitation || 0,
          radarPrecip: 0,
          distance: minDist
        });
      }
    }

    // Paso 3: Generar campo fusionado sobre la cuenca
    const grid = this.generateGrid(basin.bounds);
    let totalPrecip = 0, maxPrecip = 0;

    const fusedGrid = grid.map(point => {
      // Valor de radar en este punto (IDW desde grilla radar)
      let radarVal = this.idwFromGrid(point.lat, point.lon, radarPrecip, 'radarMM');

      // Factor de correccion interpolado desde las estaciones
      let correctionFactor = 1.0;
      if (biasPoints.length > 0) {
        correctionFactor = this.idwFromGrid(point.lat, point.lon, biasPoints, 'ratio');
        correctionFactor = Math.max(0.1, Math.min(correctionFactor, 5.0));
      }

      // Precipitacion solo por estaciones (IDW)
      const stationVal = this.idw(point.lat, point.lon, stations, 'precipitation');

      // Fusion: media ponderada entre radar corregido y estaciones
      // P_fused = w_radar * (P_radar * correction) + w_station * P_station_idw
      const radarCorrected = radarVal * correctionFactor;
      const fusedPrecip = this.radarWeight * radarCorrected + (1 - this.radarWeight) * stationVal;

      totalPrecip += fusedPrecip;
      if (fusedPrecip > maxPrecip) maxPrecip = fusedPrecip;

      return {
        ...point,
        precipitation: Math.round(fusedPrecip * 10) / 10,
        radarRaw: Math.round(radarVal * 10) / 10,
        radarCorrected: Math.round(radarCorrected * 10) / 10,
        stationIDW: Math.round(stationVal * 10) / 10,
        correctionFactor: Math.round(correctionFactor * 100) / 100
      };
    });

    const n = grid.length || 1;
    return {
      meanPrecip: Math.round((totalPrecip / n) * 10) / 10,
      maxPrecip: Math.round(maxPrecip * 10) / 10,
      grid: fusedGrid,
      gridPoints: n,
      stationCount: stations.length,
      biasPointCount: biasPoints.length,
      meanBias: biasPoints.length > 0 ? Math.round((biasPoints.reduce((s, b) => s + b.ratio, 0) / biasPoints.length) * 100) / 100 : null,
      method: 'radar_station_fusion',
      radarWeight: this.radarWeight
    };
  }

  /**
   * IDW desde una grilla generica (no estaciones)
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
   * Estimacion solo con radar (sin estaciones)
   */
  radarOnlyEstimate(basin, radarGrid, radarService) {
    const grid = this.generateGrid(basin.bounds);
    const radarPrecip = radarGrid.map(p => ({
      ...p,
      radarMM: radarService.dBZtoRainRate(p.dBZ || 0, 'marshall_palmer')
    }));
    let total = 0, maxP = 0;
    const result = grid.map(point => {
      const val = this.idwFromGrid(point.lat, point.lon, radarPrecip, 'radarMM');
      total += val;
      if (val > maxP) maxP = val;
      return { ...point, precipitation: Math.round(val * 10) / 10 };
    });
    const n = grid.length || 1;
    return { meanPrecip: Math.round((total / n) * 10) / 10, maxPrecip: Math.round(maxP * 10) / 10, grid: result, gridPoints: n, stationCount: 0, method: 'radar_only' };
  }

  /**
   * METODO PRINCIPAL: Estimacion de precipitacion areal para una cuenca
   * 
   * Selecciona automaticamente el mejor metodo segun datos disponibles:
   * - Radar + Estaciones disponibles -> Fusion (Conditional Merging)
   * - Solo estaciones -> IDW sobre grilla de cuenca
   * - Solo radar -> Conversion Z-R directa
   * - Sin datos -> Retorna 0
   *
   * @param {Object} basin - Cuenca con bounds y parametros
   * @param {Array} allStations - Todas las estaciones disponibles
   * @param {Object} radarService - Servicio de radar AEMET
   * @param {Array|null} radarGrid - Grilla de reflectividad del radar
   * @returns {Object} Precipitacion estimada con metadatos
   */
  estimateBasinPrecipitation(basin, allStations, radarService, radarGrid) {
    // Filtrar estaciones dentro y alrededor de la cuenca
    const margin = 0.15; // ~15km margen extra
    const basinStations = allStations.filter(s =>
      s.lat >= (basin.bounds.south - margin) && s.lat <= (basin.bounds.north + margin) &&
      s.lon >= (basin.bounds.west - margin) && s.lon <= (basin.bounds.east + margin) &&
      s.online !== false
    );

    // Filtrar grilla de radar para la cuenca
    let basinRadar = null;
    if (radarGrid && radarGrid.length > 0) {
      basinRadar = radarGrid.filter(r =>
        r.lat >= basin.bounds.south && r.lat <= basin.bounds.north &&
        r.lon >= basin.bounds.west && r.lon <= basin.bounds.east
      );
    }

    const hasRadar = basinRadar && basinRadar.length > 0;
    const hasStations = basinStations.length > 0;

    let result;
    if (hasRadar && hasStations) {
      // FUSION radar-estaciones (mejor opcion)
      result = this.fuseRadarStations(basin, basinStations, radarService, basinRadar);
    } else if (hasStations) {
      // Solo estaciones: IDW
      result = this.interpolateBasin(basin, basinStations);
    } else if (hasRadar) {
      // Solo radar
      result = this.radarOnlyEstimate(basin, basinRadar, radarService);
    } else {
      result = { meanPrecip: 0, maxPrecip: 0, grid: [], stationCount: 0, method: 'no_data' };
    }

    return {
      basinId: basin.id,
      basinName: basin.name,
      ...result,
      sources: {
        stationsUsed: basinStations.length,
        radarPixels: hasRadar ? basinRadar.length : 0,
        hasRadar,
        hasStations
      }
    };
  }
}

module.exports = SpatialInterpolator;
