// roof.js — Dachflächen-Berechnung + PV-Modul-Belegung
// Vereinfachtes Modell: Satteldach = 2 Flächen (Firstrichtung), Walm = 4, Pult = 1, Flach = 1 (horizontal).

const MOD_STD = { w: 1.13, h: 1.76 }; // m (Querformat/Hochformat egal für Packungsdichte)
const GAP_BORDER = 0.40;              // m Randabstand
const GAP_MOD = 0.02;                 // m zwischen Modulen
const USABLE_FACTOR = 0.90;           // 90 % der theoretischen Fläche (Dachfenster, Gauben, Schornstein)

/**
 * @param {Object} cfg
 * @param {number} cfg.grundflaeche   m² Gebäudegrundfläche (aus OSM)
 * @param {number} cfg.neigung        ° Dachneigung
 * @param {number} cfg.azimut         ° First (0=Nord). Traufen zeigen senkrecht dazu.
 * @param {'sattel'|'walm'|'pult'|'flach'} cfg.dachform
 * @param {number} cfg.bboxW          m Gebäudebreite quer zum First (für Sattel-Traufseite)
 * @param {number} cfg.bboxH          m Gebäudelänge längs zum First
 */
export function computeRoofFaces(cfg) {
  const { grundflaeche, neigung, azimut, dachform, bboxW = null, bboxH = null } = cfg;
  const slope = neigung * Math.PI / 180;
  const cosA = Math.cos(slope);

  // Gebäudebreite/-länge schätzen falls nicht gegeben (aus GF mit 1.5:1 Verhältnis)
  const w = bboxW || Math.sqrt(grundflaeche / 1.5);
  const l = bboxH || grundflaeche / w;

  // First-Länge (längs) ≈ l, Traufseite (quer) = w.
  // Dachflächenlänge (vom First zur Traufe) bei Sattel = (w/2) / cos(neigung)
  const roofPitchLen = (w / 2) / Math.max(cosA, 0.1);

  switch (dachform) {
    case 'flach':
      return [{
        id: 'f1',
        name: 'Flachdach',
        areaM2: grundflaeche * USABLE_FACTOR,
        azimut: 180,     // für Süd-Ausrichtung der Aufständerung
        neigung: 10,     // übliche Aufständerung
        widthM: l * 0.95,
        heightM: w * 0.95,
      }];
    case 'pult':
      return [{
        id: 'p1',
        name: 'Pultdach',
        areaM2: (grundflaeche / cosA) * USABLE_FACTOR,
        azimut,
        neigung,
        widthM: l * 0.95,
        heightM: (w / cosA) * 0.95,
      }];
    case 'walm': {
      // 2 Seitenflächen (Traufseiten) + 2 Walmflächen (an Giebeln). Vereinfachung: Fläche 50/50.
      const total = (grundflaeche / cosA) * USABLE_FACTOR;
      return [
        { id: 'w_a', name: `Dach ${azName(azimut + 90)}`, areaM2: total * 0.4,
          azimut: (azimut + 90) % 360, neigung, widthM: l * 0.9, heightM: roofPitchLen * 0.9 },
        { id: 'w_b', name: `Dach ${azName(azimut - 90)}`, areaM2: total * 0.4,
          azimut: (azimut + 270) % 360, neigung, widthM: l * 0.9, heightM: roofPitchLen * 0.9 },
        { id: 'w_c', name: `Walm ${azName(azimut)}`, areaM2: total * 0.1,
          azimut: azimut % 360, neigung, widthM: w * 0.6, heightM: roofPitchLen * 0.5 },
        { id: 'w_d', name: `Walm ${azName(azimut + 180)}`, areaM2: total * 0.1,
          azimut: (azimut + 180) % 360, neigung, widthM: w * 0.6, heightM: roofPitchLen * 0.5 },
      ];
    }
    case 'sattel':
    default: {
      const total = (grundflaeche / cosA) * USABLE_FACTOR;
      return [
        { id: 's_a', name: `Dach ${azName(azimut + 90)}`,
          areaM2: total * 0.5, azimut: (azimut + 90) % 360, neigung,
          widthM: l * 0.95, heightM: roofPitchLen * 0.95 },
        { id: 's_b', name: `Dach ${azName(azimut - 90)}`,
          areaM2: total * 0.5, azimut: (azimut + 270) % 360, neigung,
          widthM: l * 0.95, heightM: roofPitchLen * 0.95 },
      ];
    }
  }
}

/** Grobe Richtungsbezeichnung. */
export function azName(deg) {
  deg = ((deg % 360) + 360) % 360;
  const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Max. Modul-Anzahl auf einer Dachfläche (rechteckige Packung, Hochformat bevorzugt).
 */
export function maxModulesOnFace(face, mod = MOD_STD) {
  const avW = Math.max(face.widthM - 2 * GAP_BORDER, 0);
  const avH = Math.max(face.heightM - 2 * GAP_BORDER, 0);
  if (avW <= 0 || avH <= 0) return 0;

  // Versuche Hochformat (Modulhöhe 1.76, Breite 1.13)
  const nH_w = Math.floor((avW + GAP_MOD) / (mod.w + GAP_MOD));
  const nH_h = Math.floor((avH + GAP_MOD) / (mod.h + GAP_MOD));
  const nH = Math.max(0, nH_w * nH_h);
  // Versuche Querformat
  const nQ_w = Math.floor((avW + GAP_MOD) / (mod.h + GAP_MOD));
  const nQ_h = Math.floor((avH + GAP_MOD) / (mod.w + GAP_MOD));
  const nQ = Math.max(0, nQ_w * nQ_h);

  return Math.max(nH, nQ);
}

/**
 * Spezifischer PV-Ertrag in Deutschland (kWh/kWp·a) abhängig von Azimut & Neigung.
 * Vereinfachte Kennfeld-Approximation; Deutschland-Mittel = 1000 kWh/kWp·a.
 */
export function pvSpecificYield(azimut, neigung) {
  const BASE = 1000;
  // Azimut-Faktor: 180° (Süd) = 1.0; Ost/West (90°/270°) = 0.88; Nord = 0.60
  const azRad = (azimut - 180) * Math.PI / 180;
  const azFactor = 0.80 + 0.20 * Math.cos(azRad); // 0.6 .. 1.0
  // Neigung-Faktor: Optimum ~35° = 1.0; flach (0°) = 0.88; steil (60°) = 0.92
  const optN = 35;
  const dev = Math.abs(neigung - optN);
  const nFactor = Math.max(0.80, 1.0 - dev * 0.006);
  return Math.round(BASE * azFactor * nFactor);
}
