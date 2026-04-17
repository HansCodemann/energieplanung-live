// loadprofile.js — Synthese 8760-h Lastgang (Strom + Wärme + PV) + Dispatch
// Ansatz: BDEW-H0-ähnliches Tagesprofil (vereinfacht), TRY-ähnliche Temperaturkurve, PV-Clear-Sky mit Bewölkung.

// --- Typtag-Profile Haushaltsstrom (normiert, Summe über 24h = 1.0) ---
// Vereinfachte Form: Morgenspitze, Tag-Tal, Abendspitze. 3 Typtage (Werktag/Samstag/Sonntag).
const H0_WEEKDAY = [
  .018,.016,.015,.014,.014,.018,.028,.040,.048,.044, // 0-9
  .038,.036,.038,.038,.038,.038,.042,.050,.060,.064, // 10-19
  .062,.054,.042,.028                                 // 20-23
];
const H0_SATURDAY = [
  .020,.018,.016,.015,.015,.018,.026,.038,.046,.050,
  .050,.048,.046,.044,.042,.042,.044,.050,.058,.062,
  .060,.054,.044,.030
];
const H0_SUNDAY = [
  .022,.020,.017,.016,.015,.017,.023,.032,.042,.048,
  .052,.052,.050,.048,.046,.044,.044,.050,.058,.060,
  .058,.052,.044,.030
];

// --- Außentemperatur TRY Deutschland-Mitte (Monats-Mittel) ---
// Jan, Feb, ..., Dez (°C)
const T_MONTHLY = [1.0, 1.6, 4.8, 8.8, 13.2, 16.3, 18.2, 17.8, 14.0, 9.5, 5.0, 2.0];

// --- Globalstrahlung Monats-Faktor (relativ zum Jahresdurchschnitt) ---
const G_MONTHLY = [0.20, 0.38, 0.75, 1.12, 1.40, 1.52, 1.48, 1.32, 1.00, 0.64, 0.30, 0.17];

/** Liefert die Tages-Kurve (24 Werte, normiert) für einen Wochentag (0=Mo … 6=So). */
function h0DayProfile(dow) {
  if (dow === 5) return H0_SATURDAY;
  if (dow === 6) return H0_SUNDAY;
  return H0_WEEKDAY;
}

/** Stündliche Außentemperatur: monatlicher Mittelwert + tägl. Sinus + leichtes Rauschen (determin.). */
export function outdoorTempHour(hourOfYear) {
  const dayOfYear = Math.floor(hourOfYear / 24);
  const hour = hourOfYear % 24;
  const month = Math.min(11, Math.floor(dayOfYear / 30.4));
  const tMonth = T_MONTHLY[month];
  // Tages-Sinus: Minimum 05:00, Maximum 14:00. Amplitude 6 °C im Sommer, 3 °C im Winter.
  const amp = 3 + 3 * Math.cos((month - 6) * Math.PI / 6);
  const diurnal = -amp * Math.cos((hour - 2) * Math.PI / 12);
  return tMonth + diurnal;
}

/** Clear-Sky-Faktor für die Globalstrahlung zur Stunde. Vereinfachter Tagesgang. */
function clearSkyHour(dayOfYear, hour, lat = 52) {
  // Sonnenstand grob
  const decl = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180) * Math.PI / 180;
  const hourAngle = (hour - 12) * 15 * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  return Math.max(0, sinAlt);
}

/**
 * Synthetisiert 8760 h PV-Erzeugung (kWh) aus kWp, spez. Ertrag (kWh/kWp·a), lat.
 * Verteilt Jahreswert über Monats-Faktoren × Tagesgang × Bewölkung (deterministisch aus Datum).
 */
export function pvProfile(kwp, spezYield, lat = 52) {
  const out = new Float32Array(8760);
  if (!kwp) return out;
  const jahr = kwp * spezYield;
  // Zunächst rohes stündliches Profil bilden, dann auf Jahresenergie skalieren.
  const raw = new Float32Array(8760);
  let sumRaw = 0;
  for (let doy = 0; doy < 365; doy++) {
    const month = Math.min(11, Math.floor(doy / 30.4));
    const gMonth = G_MONTHLY[month];
    // deterministische Bewölkung: 0.7 ± 0.3 per Tag über Sin-Permutation
    const cloud = 0.75 + 0.25 * Math.sin((doy * 1.7) + (month * 0.8));
    for (let h = 0; h < 24; h++) {
      const base = clearSkyHour(doy, h, lat);
      const v = base * gMonth * cloud;
      raw[doy * 24 + h] = v;
      sumRaw += v;
    }
  }
  const scale = sumRaw > 0 ? jahr / sumRaw : 0;
  for (let i = 0; i < 8760; i++) out[i] = raw[i] * scale;
  return out;
}

/**
 * Haushaltsstrom-Profil: skaliert BDEW-H0 Typtage auf Jahres-kWh.
 * startDayOfWeek: 0=Mo (default für 2026-01-01 = Donnerstag; wir nehmen 0=Mo hier der Einfachheit).
 */
export function householdProfile(annualKwh, startDow = 3) {
  const out = new Float32Array(8760);
  if (!annualKwh) return out;
  // Skalierung: Typtage-Summe über Jahr ≈ sum(dayTotals) = 365 * 1.0 (normiert).
  // Aber wir verteilen mit mildem saisonalem Faktor (Winter +10 %, Sommer −10 %).
  let sum = 0;
  const tmp = new Float32Array(8760);
  for (let doy = 0; doy < 365; doy++) {
    const dow = (startDow + doy) % 7;
    const prof = h0DayProfile(dow);
    const month = Math.min(11, Math.floor(doy / 30.4));
    const seasonFactor = 1.0 + 0.12 * Math.cos((month - 0) * Math.PI / 6); // Jan Max, Juli Min
    for (let h = 0; h < 24; h++) {
      const v = prof[h] * seasonFactor;
      tmp[doy * 24 + h] = v;
      sum += v;
    }
  }
  const scale = annualKwh / sum;
  for (let i = 0; i < 8760; i++) out[i] = tmp[i] * scale;
  return out;
}

/**
 * Wärmebedarfs-Profil (kWh/h) auf Basis Gradtagzahl + Warmwasser-Grundlast.
 * heizgrenze: Temperatur (°C) unterhalb derer geheizt wird.
 * wwAnteil: Anteil Warmwasser am Gesamt-Wärmebedarf (0..1), gleichmäßig mit Tag-Profil.
 */
export function heatDemandProfile(annualKwh, heizgrenze = 15, wwAnteil = 0.15) {
  const out = new Float32Array(8760);
  if (!annualKwh) return out;
  const heizAnteil = 1 - wwAnteil;
  // Heizen: proportional zu max(0, heizgrenze - T_out)
  const gap = new Float32Array(8760);
  let sumGap = 0;
  for (let i = 0; i < 8760; i++) {
    const t = outdoorTempHour(i);
    const g = Math.max(0, heizgrenze - t);
    gap[i] = g;
    sumGap += g;
  }
  const heizKwh = annualKwh * heizAnteil;
  const wwKwh = annualKwh * wwAnteil;
  // Warmwasser-Tagesprofil (normiert Summe=1 pro Tag): morgens + abends
  const wwDay = [.010,.005,.005,.005,.010,.030,.080,.100,.080,.050,
                 .040,.035,.030,.025,.025,.030,.040,.055,.070,.080,
                 .070,.055,.030,.020];
  const wwPerYear = wwKwh;
  const wwPerDay = wwPerYear / 365;
  for (let i = 0; i < 8760; i++) {
    const heiz = sumGap > 0 ? (gap[i] / sumGap) * heizKwh : 0;
    const h = i % 24;
    const ww = wwDay[h] * wwPerDay;
    out[i] = heiz + ww;
  }
  return out;
}

/**
 * Wärmepumpen-Stromverbrauch aus Wärmebedarf mit COP(T_out) und Heizstab-Fallback.
 * Liefert { wpStrom[], heizstab[], genutzterCOPmittel, anteilHeizstab }.
 */
export function heatpumpElectricity(heatDemand, wpKwNenn, copFn, minCOP = 1.8, vorlauf = 40) {
  const wpStrom = new Float32Array(8760);
  const heizstab = new Float32Array(8760);
  let sumWP = 0, sumHS = 0, sumWaerme = 0, sumWPelectric = 0, sumCOPWeighted = 0;

  for (let i = 0; i < 8760; i++) {
    const q = heatDemand[i];
    if (q <= 0) continue;
    const tOut = outdoorTempHour(i);
    const cop = copFn(tOut, vorlauf);
    // WP deckt bis wpKwNenn × COP(tOut); darüber springt Heizstab ein
    const wpMaxHeat = wpKwNenn * cop;
    let wpHeat, hsHeat;
    if (cop < minCOP) {
      wpHeat = 0;
      hsHeat = q;
    } else if (q <= wpMaxHeat) {
      wpHeat = q;
      hsHeat = 0;
    } else {
      wpHeat = wpMaxHeat;
      hsHeat = q - wpMaxHeat;
    }
    const elecWp = wpHeat / cop;
    wpStrom[i] = elecWp;
    heizstab[i] = hsHeat;
    sumWP += elecWp;
    sumHS += hsHeat;
    sumWaerme += q;
    sumWPelectric += elecWp;
    sumCOPWeighted += wpHeat;
  }
  const jaz = sumWPelectric > 0 ? sumCOPWeighted / sumWPelectric : 0;
  return {
    wpStrom, heizstab,
    jazEffektiv: +jaz.toFixed(2),
    anteilHeizstab: sumWaerme > 0 ? +(sumHS / sumWaerme).toFixed(3) : 0,
    sumElectricity: sumWP,
    sumBackup: sumHS,
  };
}

/**
 * Dispatch-Simulation: PV deckt erst Last, dann Batterie, dann Einspeisung.
 * battKwh: Nutzbare Batteriekapazität (kWh).
 */
export function dispatch({ load, pv, battKwh = 0, effCharge = 0.95, effDisch = 0.95 }) {
  const n = load.length;
  const pvToLoad = new Float32Array(n);
  const pvToBatt = new Float32Array(n);
  const battToLoad = new Float32Array(n);
  const gridImport = new Float32Array(n);
  const gridExport = new Float32Array(n);
  const soc = new Float32Array(n);

  let battSoc = 0;
  let totPvGen = 0, totLoad = 0, totGridImp = 0, totGridExp = 0, totSelfUse = 0;

  for (let i = 0; i < n; i++) {
    const l = load[i];
    const p = pv[i];
    totPvGen += p;
    totLoad += l;
    let remLoad = l;
    let remPV = p;

    // 1. PV deckt Last direkt
    const direct = Math.min(remLoad, remPV);
    pvToLoad[i] = direct;
    remLoad -= direct;
    remPV -= direct;
    totSelfUse += direct;

    // 2. PV-Überschuss in Batterie (bis Kapazität)
    if (remPV > 0 && battKwh > 0) {
      const battFreeCap = battKwh - battSoc;
      const inBatt = Math.min(remPV * effCharge, battFreeCap);
      battSoc += inBatt;
      pvToBatt[i] = inBatt / effCharge;
      remPV -= inBatt / effCharge;
    }
    // 3. Rest PV → Einspeisung
    if (remPV > 0) { gridExport[i] = remPV; totGridExp += remPV; }

    // 4. Restlast aus Batterie
    if (remLoad > 0 && battSoc > 0) {
      const fromBatt = Math.min(remLoad / effDisch, battSoc);
      const toLoad = fromBatt * effDisch;
      battSoc -= fromBatt;
      battToLoad[i] = toLoad;
      remLoad -= toLoad;
      totSelfUse += toLoad;
    }
    // 5. Restlast → Netz
    if (remLoad > 0) { gridImport[i] = remLoad; totGridImp += remLoad; }

    soc[i] = battSoc;
  }

  const autarkie = totLoad > 0 ? totSelfUse / totLoad : 0;
  const eigenverbrauchsquote = totPvGen > 0 ? totSelfUse / totPvGen : 0;

  return {
    pvToLoad, pvToBatt, battToLoad, gridImport, gridExport, soc,
    totPvGen, totLoad, totGridImp, totGridExp, totSelfUse,
    autarkie: +autarkie.toFixed(3),
    eigenverbrauchsquote: +eigenverbrauchsquote.toFixed(3),
  };
}

/** Aggregiert stündliche Serie auf Tages-, Wochen-, Monats- oder Jahres-Mittel. */
export function aggregate(series, mode = 'day', offset = 0) {
  switch (mode) {
    case 'day': {
      // ein typischer Winter-/Sommertag als 24-h-Profil
      return Array.from(series.slice(offset, offset + 24));
    }
    case 'week': {
      return Array.from(series.slice(offset, offset + 168));
    }
    case 'month': {
      return Array.from(series.slice(offset, offset + 720));
    }
    case 'year': {
      // Tages-Summen
      const out = new Array(365).fill(0);
      for (let i = 0; i < 8760; i++) out[Math.floor(i / 24)] += series[i];
      return out;
    }
  }
  return [];
}

/** Findet den Start-Index (Stunde des Jahres) für eine Saison. */
export function seasonOffset(season = 'winter') {
  // repräsentativer Tag je Saison (Mittwoch)
  if (season === 'winter') return 15 * 24;  // 16. Januar
  if (season === 'spring') return 105 * 24; // 16. April
  if (season === 'summer') return 196 * 24; // 16. Juli
  return 0;
}
