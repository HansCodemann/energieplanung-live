// core.js — Kern-Berechnungen: Wärmebedarf, COP/JAZ, Wirtschaftlichkeit
// (Aus dem Original "Energieplanung"-Tool portiert und für Eigentümer vereinfacht.)

// --- Spezifischer Wärmebedarf nach Baujahr (kWh/m²a, Referenz MFH) ---
// Quelle: Tabelle aus dem Original-Tool, basiert auf WSVO/EnEV/GEG-Stufen.
const SPEZ_NACH_BAUJAHR = [
  [1918, 210], [1948, 190], [1968, 170], [1977, 160],
  [1983, 140], [1994, 120], [2001,  95], [2009,  75],
  [2013,  60], [2015,  50], [9999,  40],
];

// Nutzungs-Faktor
export const NUTZUNG_FAKTOR = {
  EFH: 1.30,
  MFH: 1.00,
};

export function spezByBaujahr(baujahr) {
  for (const [grenze, wert] of SPEZ_NACH_BAUJAHR) {
    if (baujahr <= grenze) return wert;
  }
  return 40;
}

export function autoSpez(baujahr, nutzung = 'EFH') {
  return Math.round(spezByBaujahr(baujahr) * (NUTZUNG_FAKTOR[nutzung] || 1));
}

/** Jahres-Wärmebedarf (kWh/a) inkl. Warmwasser-Anteil (grob eingerechnet). */
export function waermeBedarf(wohnflaeche, spez) {
  return Math.round(wohnflaeche * spez);
}

/** Heizlast-Abschätzung (kW) — Jahresbedarf / Vollbenutzungsstunden. */
export function heizlastKW(waermeKwh) {
  return Math.max(1, +(waermeKwh / 1800).toFixed(1));
}

// --- Haushaltsstrom-Schätzung (EFH) ---
// BDEW-Richtwerte: 1 P = 1800, 2 P = 2800, 3 P = 3400, 4 P = 4000 (+300 pro Person, ohne WW-Strom)
export function haushaltsstromKwh(personen, einheiten = 1, warmwasserMitStrom = false) {
  const base = personen === 1 ? 1800 : personen === 2 ? 2800 :
               personen === 3 ? 3400 : 4000 + Math.max(0, personen - 4) * 400;
  const extra = warmwasserMitStrom ? personen * 500 : 0;
  return Math.round((base + extra) * Math.max(1, einheiten));
}

// --- Wärmepumpe: COP-Kurve Luft-WP (T_außen → COP) ---
// Einfache quadratische Approximation; Referenz: A7/W35 ≈ 4.0, A-7/W35 ≈ 2.6
export function copLuftWP(tOutside, vorlauf = 35) {
  // Temperatur-Spreizung (Senke − Quelle)
  const dT = vorlauf - tOutside;
  // Carnot-Wirkungsgrad-Ansatz mit empirischem Gütegrad 0.45
  const carnot = (vorlauf + 273.15) / Math.max(dT, 1);
  const cop = 0.45 * carnot;
  return Math.max(1.5, Math.min(5.5, cop));
}

export function copSoleWP(tSource = 5, vorlauf = 35) {
  const dT = vorlauf - tSource;
  const carnot = (vorlauf + 273.15) / Math.max(dT, 1);
  return Math.max(2.5, Math.min(5.8, 0.5 * carnot));
}

// --- Wirtschaftlichkeit ---
/** Annuität (€/a) eines Investments bei Zins z und Laufzeit n Jahre. */
export function annuitaet(invest, n, z = 0.04) {
  if (z === 0) return invest / n;
  const q = 1 + z;
  return invest * (z * Math.pow(q, n)) / (Math.pow(q, n) - 1);
}

/** Netto-Amortisation (Jahre) aus Invest und Jahresersparnis (€/a). */
export function amortJahre(invest, ersparnisProJahr) {
  if (ersparnisProJahr <= 0) return Infinity;
  return +(invest / ersparnisProJahr).toFixed(1);
}

// --- CO2-Faktoren (kg CO2e/kWh) — Stand ~2025 Deutschland ---
export const CO2 = {
  strom_netz: 0.38,   // kg/kWh Strommix DE, fallend
  gas:        0.202,
  oel:        0.31,
  fw:         0.18,
  pellet:     0.036,
  pv:         0.0,
  wp_lw: null,        // aus Strom_netz / JAZ
  wp_sw: null,
};

// --- PV-Ertrag ---
/** PVGIS-freundliches Modell: kWh/kWp·a * kWp * (Verschattung). */
export function pvJahresertrag(kwp, spezYield, verschattung = 0.05) {
  return Math.round(kwp * spezYield * (1 - verschattung));
}

/** kWp aus Modul-Anzahl × Modul-Wp. */
export function modulesToKwp(nModules, moduleWp) {
  return +(nModules * moduleWp / 1000).toFixed(2);
}

// --- Förder-Schätzung (BEG 2025/26 stark vereinfacht) ---
// Heizungsförderung: 30 % Grundförderung + 20 % Geschwindigkeits-Bonus (vor 2028)
// + 30 % Einkommens-Bonus (bis 40k€ Einkommen) + 5 % Effizienz-Bonus
// Cap: max 70 %, max 30.000 € Bemessungsgrundlage für EFH
export function foerderungHeizung({ invest, geschwBonus = true, einkBonus = false, effBonus = true }) {
  let p = 0.30;
  if (geschwBonus) p += 0.20;
  if (einkBonus)   p += 0.30;
  if (effBonus)    p += 0.05;
  p = Math.min(p, 0.70);
  const bemess = Math.min(invest, 30000);
  return Math.round(bemess * p);
}

// PV: KfW 270 (zinsgünstig), keine direkte Investkostenförderung bundesweit.
// Hier: 0 % Default, kann vom Nutzer angepasst werden.
export function foerderungPV(invest) {
  return 0;
}
