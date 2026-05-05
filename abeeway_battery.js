/*********************************************************************/
/***** BATTERY LIFE CALCULATION SCRIPTS                          *****/
/*********************************************************************/


/* ─────────────────────────────────────────────────────────────────
 * HARDWARE MEASUREMENTS
 * These are the default chipset values.  They can be overridden at
 * runtime by loading hw_measurements.cfg via the UI — no source
 * code change needed.
 * All currents in mA, durations in seconds, voltage in V.
 * ──────────────────────────────────────────────────────────────── */
let HW = {
    // Supply
    supply_voltage:             3.6,

    // MCU & System
    mcu_active_current_ma:      0.3,
    quiescent_current_ma:       0.001,
    accelerometer_current_ma:   0.0065,

    // LoRa (SX1262)
    lora_rx_current_ma:         8,     // RX window current (I_RX)
    lora_rx_window_ms:          300,    // duration of each RX window (T_RX)

    // GNSS / GPS
    gnss_active_current_ma:     30,    // GNSS chipset active current (standalone fix)
    lpgps_active_current_ma:    24,    // LP-GPS chipset active current
    gps_active_current_ma:      24,    // kept for AGPS (assisted mode)
    gps_standby_current_ma:     0.05,

    // WiFi
    wifi_scan_current_ma:       11.6,
    wifi_scan_duration_s:       9,

    // BLE scan (geolocation) — current measured at 10.12 mA
    ble_scan_current_ma:        10.12,
    ble_scan_duration_s:        3,     // fallback default; profile-based path uses per-scan durations

    // Monitoring wakeup
    monitoring_current_ma:      2,
    monitoring_window_ms:       30,

    // BLE operations (custom usage)
    ble_fast_adv_current_ma:    10,
    ble_fast_adv_duration_s:    2,
    ble_slow_adv_current_ma:    3.5,
    ble_slow_adv_duration_s:    10,
    ble_connected_current_ma:   3.6,
    ble_connected_duration_s:   2,
    ble_fast_scan_current_ma:   2,
    ble_fast_scan_duration_s:   8,
    ble_slow_scan_current_ma:   0.5,
    ble_slow_scan_duration_s:   30,

    // Cellular LTE-M
    ltem_tx_current_ma:         200,
    ltem_rx_current_ma:         7,
    ltem_idle_current_ma:       3,

    // Cellular NB-IoT
    nbiot_tx_current_ma:        220,
    nbiot_rx_current_ma:        5,
    nbiot_idle_current_ma:      2.5,
};

/**
 * Apply parsed key=value pairs from hw_measurements.cfg to HW.
 * Only recognised keys are updated; unknown keys are ignored.
 * Returns the number of values successfully applied.
 */
function applyHardwareMeasurements(parsed) {
    let applied = 0;
    for (const [key, raw] of Object.entries(parsed)) {
        if (Object.prototype.hasOwnProperty.call(HW, key)) {
            const val = parseFloat(raw);
            if (!isNaN(val) && val >= 0) {
                HW[key] = val;
                applied++;
            }
        }
    }
    return applied;
}


/* ─────────────────────────────────────────────────────────────────
 * PRODUCT / PROTOCOL CONSTANTS
 * (Not hardware measurements — not affected by hw_measurements.cfg)
 * ──────────────────────────────────────────────────────────────── */
const SPREADING_FACTORS = [7, 8, 9, 10, 11, 12];

// TX power → TX current [mA] per product, measured calibration points (14–22 dBm)
const LORA_TX_CURRENT_MA = {
    compact:       { 14: 32, 15:  44, 16:  67, 17:  78, 18:  87, 19: 100, 20: 123, 21: 124, 22: 124 },
    combo_tracker: { 14: 27, 15:  34, 16:  59, 17:  66, 18:  73, 19:  82, 20:  92, 21:  94, 22:  99 },
};
// industrial / micro / smart_badge → same RF front-end as compact

// DR → SF mapping per LoRaWAN region (uplink only, 125 kHz BW unless noted)
const LORAWAN_DR_TO_SF = {
    EU868: { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, 5: 7 },
    US915: { 0: 10, 1:  9, 2:  8, 3: 7 },
    AU915: { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, 5: 7 },
    AS923: { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, 5: 7 },
    KR920: { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, 5: 7 },
    IN865: { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, 5: 7 },
    RU864: { 0: 12, 1: 11, 2: 10, 3: 9, 4: 8, 5: 7 },
};

const BATTERY_TYPES = {
    primary:      {
        descr: 'Primary (LTC)',
        leakage_per_month: 0.003,
        practical_capacity_multiplier: 0.80
    },
    rechargeable: {
        descr: 'Rechargeable (Li-Po)',
        leakage_per_month: 0.05,
        practical_capacity_multiplier: 0.90
    },
};

const PRODUCTS = {
    industrial: {
        descr: 'Industrial Tracker',
        battery: {
            nominal_capacity:   19000,
            practical_capacity: 19000 * BATTERY_TYPES.primary.practical_capacity_multiplier,
            leakage_per_month:  BATTERY_TYPES.primary.leakage_per_month,
        }
    },
    compact: {
        descr: 'Compact Tracker',
        battery: {
            nominal_capacity:   8000,
            practical_capacity: 8000 * BATTERY_TYPES.primary.practical_capacity_multiplier,
            leakage_per_month:  BATTERY_TYPES.primary.leakage_per_month,
        }
    },
    micro: {
        descr: 'Microtracker',
        battery: {
            nominal_capacity:   450,
            practical_capacity: 450 * BATTERY_TYPES.rechargeable.practical_capacity_multiplier,
            leakage_per_month:  BATTERY_TYPES.rechargeable.leakage_per_month,
        }
    },
    smart_badge: {
        descr: 'Smart Badge',
        battery: {
            nominal_capacity:   1300,
            practical_capacity: 1300 * BATTERY_TYPES.rechargeable.practical_capacity_multiplier,
            leakage_per_month:  BATTERY_TYPES.rechargeable.leakage_per_month,
        }
    },
    combo_tracker: {
        descr: 'Combo Tracker',
        cellular: true,
        battery: {
            nominal_capacity:   5000,
            practical_capacity: 5000 * BATTERY_TYPES.primary.practical_capacity_multiplier,
            leakage_per_month:  BATTERY_TYPES.primary.leakage_per_month,
        }
    },
};

// Getters: always reflect live HW values, even after hw_measurements.cfg is loaded
const BLE_OPERATIONS = {
    fast_adv:  { descr: 'Fast advertisement (2s)',
                 get time()    { return HW.ble_fast_adv_duration_s;  },
                 get current() { return HW.ble_fast_adv_current_ma;  } },
    slow_adv:  { descr: 'Slow advertisement (10s)',
                 get time()    { return HW.ble_slow_adv_duration_s;  },
                 get current() { return HW.ble_slow_adv_current_ma;  } },
    connected: { descr: 'Connected (2s)',
                 get time()    { return HW.ble_connected_duration_s; },
                 get current() { return HW.ble_connected_current_ma; } },
    fast_scan: { descr: 'Fast BLE scan (8sec)',
                 get time()    { return HW.ble_fast_scan_duration_s; },
                 get current() { return HW.ble_fast_scan_current_ma; } },
    slow_scan: { descr: 'Slow BLE scan (30sec)',
                 get time()    { return HW.ble_slow_scan_duration_s; },
                 get current() { return HW.ble_slow_scan_current_ma; } },
};

// Linear interpolation between adjacent 1-dBm calibration points (14–22 dBm).
// product: 'combo_tracker' uses combo table; all others use compact table.
function getTxCurrentMa(dbm, product) {
    const table = LORA_TX_CURRENT_MA[product] ?? LORA_TX_CURRENT_MA.compact;
    const clamped = Math.max(14, Math.min(22, dbm));
    const lo = Math.floor(clamped);
    const hi = Math.min(22, lo + 1);
    if (lo === hi) return table[lo];
    const t = clamped - lo;
    return table[lo] + t * (table[hi] - table[lo]);
}

// Energy consumed per cellular uplink depending on RF coverage quality [mAh]
const CELLULAR_ENERGY_PER_UPLINK_MAH = {
    excellent: 0.10,
    good:      0.25,
    bad:       0.60,
};

// LoRa payload lengths [bytes] — protocol constants, not measurements
const HEARTBEAT_PAYL_LEN              = 11;
const MOTION_START_PAYL_LEN           = 5;
const MOTION_END_PAYL_LEN             = 11;
const STATUS_PAYL_BY_TYPE             = [42, 35, 48, 54]; // Status 0/1/2/3
// Position uplinks: 8-byte uplink header (4B message + 4B position) shared across all geoloc techs
const GEOLOC_HDR                      = 8;
const GPS_PAYL_LEN                    = GEOLOC_HDR + 16;  // 24
const LPGPS_PAYL_LEN                  = GEOLOC_HDR + 24;  // 32
const AGPS_MIN_PAYL_LEN               = GEOLOC_HDR + 6;   // 14
const AGPS_ADDITIONAL_SAT_PAYL_LEN   = 5;
const WIFI_MIN_PAYL_LEN               = GEOLOC_HDR;       // 8 (7 bytes/BSSID, no tech-specific minimum)
const WIFI_ADDITIONAL_BSSID_PAYL_LEN  = 7;
const BLE_MIN_PAYL_LEN                = GEOLOC_HDR;       // 8 (7 bytes/beacon, no tech-specific minimum)
const BLE_ADDITIONAL_BSSID_PAYL_LEN   = 7;
const RECOVERY_BEACON_MAH             = 0.00036;  // energy per single beacon transmission [mAh]
const LORA_PROBE_ENERGY_MAH           = 0.006;    // energy per single LoRa link-check (probe) [mAh]

const SCANCOLL_MIN_PAYL_LEN                  = 8;
const SCANCOLL_ADDITIONAL_MACADDR_PAYL_LEN   = 7;
const SCANCOLL_ADDITIONAL_BEACONID_PAYL_LEN  = 4;


/* ─────────────────────────────────────────────────────────────────
 * CALCULATION FUNCTIONS
 * ──────────────────────────────────────────────────────────────── */

// LoRa time-on-air + RX windows → average current [mA].
//
// ToA formula (LoRa spec, explicit header, CRC enabled, CR 4/5):
//   T_sym [ms]   = 2^SF / BW_kHz  (BW = 125 kHz)
//   T_preamble   = (n_preamble + 4.25) × T_sym = 12.25 × T_sym  (n_preamble = 8)
//   DE           = 1 if SF ≥ 11 (low-data-rate optimisation), else 0
//   n_payload    = 8 + max(⌈(8×PL - 4×SF + 44) / (4×(SF − 2×DE))⌉ × 5, 0)
//     where PL = payload_bytes + 13 (LoRaWAN MAC overhead:
//                MHDR(1) + DevAddr(4) + FCtrl(1) + FCnt(2) + FPort(1) + MIC(4))
//   T_payload    = n_payload × T_sym
//   T_packet     = T_preamble + T_payload
//   T_radio_startup = Radio startup time [ms]
//
// Energy per uplink [mJ]:
//   E_TX  = T_packet [ms] × V [V] × I_TX(dBm, product) [mA]  / 1000
//   E_RX  = 2 × T_RX [ms] × V [V] × I_RX [mA]  / 1000   (RX1 + RX2 windows)
//   Note: I_TX already includes MCU active current (measured with MCU running)
//
// Average current [mA] = (E_TX + E_RX) / V × N_msg_per_day / 86400
function calculate_lora_current(sf, tx_power, payl_len, nof_msg_per_day, product) {
    const T_sym      = (2 ** sf) / 125;                   // symbol period [ms]
    const T_radio_startup = 80;                           // Radio startup time [ms]
    const T_preamble = 12.25 * T_sym;                     // preamble time [ms]
    const DE         = sf >= 11 ? 1 : 0;
    const PL         = payl_len + 13;                     // total PHY bytes incl. LoRaWAN overhead
    const n_payload  = 8 + Math.max(
        Math.ceil((8 * PL - 4 * sf + 44) / (4 * (sf - 2 * DE))) * 5, 0);
    const T_packet   = T_radio_startup + T_preamble + n_payload * T_sym;    // time on air [ms]

    const E_TX = T_packet * HW.supply_voltage * getTxCurrentMa(tx_power, product) / 1000;
    const E_RX = 2 * HW.lora_rx_window_ms * HW.supply_voltage * HW.lora_rx_current_ma / 1000;

    return ((E_TX + E_RX) / HW.supply_voltage) * (nof_msg_per_day / (24 * 3600));
}

// DR-distribution-weighted LoRa current.
// dr_dist: [{dr, pct}, ...] where pct values sum to 100.
// Falls back to DR→SF lookup for the configured region.
function calculate_lora_current_dr_weighted(tx_power, payl_len, nof_msg_per_day, dr_dist, region, product) {
    const sfMap = LORAWAN_DR_TO_SF[region] ?? LORAWAN_DR_TO_SF.EU868;
    let current = 0;
    for (const { dr, pct } of dr_dist) {
        const sf = sfMap[dr];
        if (sf == null || pct <= 0) continue;
        current += (pct / 100) * calculate_lora_current(sf, tx_power, payl_len, nof_msg_per_day, product);
    }
    return current;
}

/**
 * GNSS current — manual mode fallback (no profile, no failure model).
 * Uses TTFF + convergence as the active window per fix.
 */
function calculate_gps_current(ttff, conv_time, nof_msg_per_day) {
    return HW.gnss_active_current_ma * (ttff + conv_time) * nof_msg_per_day / (24 * 3600);
}

function calculate_agps_current(agps_on_time, nof_msg_per_day) {
    return agps_on_time * HW.gps_active_current_ma * nof_msg_per_day / (24 * 3600);
}

function calculate_wifi_current(nof_msg_per_day) {
    return HW.wifi_scan_duration_s * HW.wifi_scan_current_ma * nof_msg_per_day / (24 * 3600);
}

/**
 * BLE geolocation scan current.
 * scan_duration_s: explicit scan window in seconds; falls back to HW default when omitted.
 */
function calculate_ble_current(nof_msg_per_day, scan_duration_s) {
    const dur = (scan_duration_s !== undefined && scan_duration_s > 0)
        ? scan_duration_s
        : HW.ble_scan_duration_s;
    return dur * HW.ble_scan_current_ma * nof_msg_per_day / (24 * 3600);
}

function calculate_scancollection_current(nof_msg_per_day, tech) {
    if (tech === 'WiFi') return calculate_wifi_current(nof_msg_per_day);
    if (tech === 'BLE')  return calculate_ble_current(nof_msg_per_day);
    return 0;
}

function calculate_custom_ble_usage_current(operation, usage_time_per_day) {
    return BLE_OPERATIONS[operation].current * usage_time_per_day / 24;
}

/**
 * Always-on CPU idle current (µA → mA).
 */
function calculate_cpu_idle_current(cpu_idle_ua) {
    return cpu_idle_ua / 1000;
}

/**
 * Periodic monitoring wakeup: MCU active for window_ms every period_s.
 * Returns average current in mA.
 */
function calculate_monitoring_current(period_s, current_ma, window_ms) {
    if (period_s <= 0) return 0;
    return current_ma * (window_ms / 1000) / period_s;
}

/**
 * Battery self-discharge expressed as an average equivalent current drain.
 * I_leak [mA] = C × D/100 / (365 × 24)
 */
function calculate_battery_leakage_current(battery_capacity_mah, annual_discharge_pct) {
    return battery_capacity_mah * (annual_discharge_pct / 100) / (365 * 24);
}

/**
 * Cellular communication current.
 * Each session = TX overhead (connection) + RX data exchange.
 */
// Cellular average current [mA] from coverage distribution and uplink count.
//
// Formula:
//   E_uplink [mAh] = (excellent% × 0.10 + good% × 0.25 + bad% × 0.60) / 100
//   I_avg [mA]     = E_uplink [mAh] × N_uplinks_per_day / 24
//
// coverage_pct: { excellent, good, bad }  — values in %, must sum to 100
// uplinks_per_day: cellular uplinks = total_uplinks × (cellular_usage% / 100)
function calculate_cellular_current(coverage_pct, uplinks_per_day) {
    if (!coverage_pct || uplinks_per_day <= 0) return 0;
    const e = CELLULAR_ENERGY_PER_UPLINK_MAH;
    const energy_per_uplink =
        (coverage_pct.excellent / 100) * e.excellent +
        (coverage_pct.good      / 100) * e.good      +
        (coverage_pct.bad       / 100) * e.bad;
    return energy_per_uplink * uplinks_per_day / 24;
}

/**
 * Recovery beacon: proprietary short-range transmission (not LoRa).
 * Each beacon consumes RECOVERY_BEACON_MAH regardless of state.
 * Returns { motion, static } average currents in mA.
 */
function calculate_recovery_beacon_current(motion_period_s, static_period_s, motion_frac) {
    const motionCurrent = (motion_period_s > 0)
        ? motion_frac * RECOVERY_BEACON_MAH * 3600 / motion_period_s
        : 0;
    const staticCurrent = (static_period_s > 0)
        ? (1 - motion_frac) * RECOVERY_BEACON_MAH * 3600 / static_period_s
        : 0;
    return { motion: motionCurrent, static: staticCurrent };
}


/* ─────────────────────────────────────────────────────────────────
 * MAIN ENTRY POINT
 * ──────────────────────────────────────────────────────────────── */
function calculate_battery_life_time(input) {

    // Network usage factors (0–1) — scale LoRa TX and Cellular currents
    const lora_factor     = input.net_usage_lora_pct     !== undefined ? input.net_usage_lora_pct     / 100 : 1.0;
    const cellular_factor = input.net_usage_cellular_pct !== undefined ? input.net_usage_cellular_pct / 100 : 1.0;

    // Resolve effective DR distribution and region
    const region   = input.lorawan_region ?? 'EU868';
    const dr_dist  = input.dr_distribution?.length > 0 ? input.dr_distribution : null;
    const product  = input.product ?? 'compact';

    // Helper: pick DR-weighted or single-SF LoRa current calculator (TX1)
    const loraCalc = (payl_len, nof_msg) => dr_dist
        ? calculate_lora_current_dr_weighted(input.tx_power, payl_len, nof_msg, dr_dist, region, product)
        : calculate_lora_current(input.sf ?? 10, input.tx_power, payl_len, nof_msg, product);

    // TX2: fraction of uplinks duplicated, using TX2 DR distribution (falls back to TX1 if absent)
    const tx2_factor  = input.lora_tx2_factor ?? 0;
    const tx2_dr_dist = input.lora_tx2_dr_distribution?.length > 0 ? input.lora_tx2_dr_distribution : dr_dist;
    const loraCalcTx2 = tx2_factor > 0
        ? (payl_len, nof_msg) => (tx2_dr_dist
            ? calculate_lora_current_dr_weighted(input.tx_power, payl_len, nof_msg * tx2_factor, tx2_dr_dist, region, product)
            : calculate_lora_current(input.sf ?? 10, input.tx_power, payl_len, nof_msg * tx2_factor, product))
        : () => 0;

    // Print formulas to console once per calculation
    const sfMap = LORAWAN_DR_TO_SF[region] ?? LORAWAN_DR_TO_SF.EU868;
    const drSfStr = dr_dist
        ? dr_dist.map(({dr, pct}) => `DR${dr}(SF${sfMap[dr] ?? '?'}) ${pct.toFixed(1)}%`).join(', ')
        : `SF${input.sf ?? 10} (single)`;
    const tx2DrStr = tx2_dr_dist
        ? tx2_dr_dist.map(({dr, pct}) => `DR${dr}(SF${sfMap[dr] ?? '?'}) ${pct.toFixed(1)}%`).join(', ')
        : 'same as TX1';
    console.log(
`[LoRa consumption formula]
  Region : ${region}   TX power : ${input.tx_power} dBm   Product : ${product}
  TX1 DR/SF : ${drSfStr}
  TX2 DR/SF : ${tx2DrStr}   TX2 factor : ${(tx2_factor * 100).toFixed(0)}% of uplinks

  Time-on-air (LoRa spec, explicit header, CRC on, CR 4/5, BW 125 kHz):
    T_sym [ms]   = 2^SF / 125
    T_preamble   = 12.25 × T_sym          (8 preamble symbols + 4.25 header symbols)
    DE           = 1 if SF ≥ 11 else 0   (low-data-rate optimisation)
    PL           = payload_bytes + 13     (LoRaWAN overhead: MHDR+FHDR+FPort+MIC)
    n_payload    = 8 + max(⌈(8×PL − 4×SF + 44) / (4×(SF − 2×DE))⌉ × 5, 0)
    T_packet     = T_preamble + n_payload × T_sym

  Energy per uplink [mJ]:
    E_TX  = T_packet [ms] × V [V] × I_TX(dBm, product) [mA]  / 1000   (I_TX includes MCU)
    E_RX  = 2 × ${HW.lora_rx_window_ms} ms × ${HW.lora_rx_current_ma} mA × V [V]  / 1000   (RX1 + RX2)

  Average current [mA] = (E_TX + E_RX) / V × N_msg/day / 86400`);

    // LoRa currents (TX1 + TX2, scaled by lora_factor)
    const custom_msg_lora_current =
        (loraCalc(input.custom_msg.payl_len, input.custom_msg.nof_msg_per_day)
       + loraCalcTx2(input.custom_msg.payl_len, input.custom_msg.nof_msg_per_day)) * lora_factor;

    const heartbeat_lora_current =
        (loraCalc(HEARTBEAT_PAYL_LEN, input.heartbeat.nof_msg_per_day)
       + loraCalcTx2(HEARTBEAT_PAYL_LEN, input.heartbeat.nof_msg_per_day)) * lora_factor;

    const numStatusTypes   = product === 'combo_tracker' ? 4 : 2;
    const statusNPerType   = input.status_msg.nof_msg_per_day / numStatusTypes;
    const status_lora_current = STATUS_PAYL_BY_TYPE.slice(0, numStatusTypes).reduce((sum, payl) =>
        sum + (loraCalc(payl, statusNPerType) + loraCalcTx2(payl, statusNPerType)) * lora_factor, 0);

    const gps_lora_current =
        (loraCalc(GPS_PAYL_LEN, input.gps.nof_msg_per_day)
       + loraCalcTx2(GPS_PAYL_LEN, input.gps.nof_msg_per_day)) * lora_factor;

    const lpgps_lora_current =
        (loraCalc(LPGPS_PAYL_LEN, input.lpgps?.nof_msg_per_day || 0)
       + loraCalcTx2(LPGPS_PAYL_LEN, input.lpgps?.nof_msg_per_day || 0)) * lora_factor;

    const agps_payl = AGPS_MIN_PAYL_LEN + input.agps.nof_satellites * AGPS_ADDITIONAL_SAT_PAYL_LEN;
    const agps_lora_current =
        (loraCalc(agps_payl, input.agps.nof_msg_per_day)
       + loraCalcTx2(agps_payl, input.agps.nof_msg_per_day)) * lora_factor;

    const wifi_payl = WIFI_MIN_PAYL_LEN + input.wifi.nof_bssid * WIFI_ADDITIONAL_BSSID_PAYL_LEN;
    const wifi_lora_current =
        (loraCalc(wifi_payl, input.wifi.nof_msg_per_day)
       + loraCalcTx2(wifi_payl, input.wifi.nof_msg_per_day)) * lora_factor;

    // BLE geoloc LoRa uplinks — BLE Scan 1 and BLE Scan 2 tracked separately
    const ble1_payl = input.ble.ble1
        ? BLE_MIN_PAYL_LEN + input.ble.ble1.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN
        : BLE_MIN_PAYL_LEN + input.ble.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN;
    const ble1_nof = input.ble.ble1 ? input.ble.ble1.nof_msg_per_day : input.ble.nof_msg_per_day;
    const ble1_lora = (loraCalc(ble1_payl, ble1_nof) + loraCalcTx2(ble1_payl, ble1_nof)) * lora_factor;

    const ble2_lora = input.ble.ble2
        ? (() => {
            const p = BLE_MIN_PAYL_LEN + input.ble.ble2.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN;
            const n = input.ble.ble2.nof_msg_per_day;
            return (loraCalc(p, n) + loraCalcTx2(p, n)) * lora_factor;
          })()
        : 0;
    const ble_lora_current = ble1_lora + ble2_lora;

    // Scan collection (fragmented)
    const scancoll_unit_len = (input.scan_collection.tech === 'BLE' && input.scan_collection.idtype === 'ID')
        ? SCANCOLL_ADDITIONAL_BEACONID_PAYL_LEN
        : SCANCOLL_ADDITIONAL_MACADDR_PAYL_LEN;

    const nof_id_in_full_msg = Math.floor((input.scan_collection.max_payl_len - SCANCOLL_MIN_PAYL_LEN) / scancoll_unit_len);
    const nof_id_last_msg    = input.scan_collection.nof_id % nof_id_in_full_msg;
    const nof_full_fragments = Math.floor(input.scan_collection.nof_id / nof_id_in_full_msg);

    const sc_full_payl = SCANCOLL_MIN_PAYL_LEN + nof_id_in_full_msg * scancoll_unit_len;
    const sc_last_payl = SCANCOLL_MIN_PAYL_LEN + nof_id_last_msg * scancoll_unit_len;
    const sc_full_nof  = nof_full_fragments * input.scan_collection.nof_msg_per_day;
    const sc_last_nof  = input.scan_collection.nof_msg_per_day;
    const scan_collection_lora_current = (
        loraCalc(sc_full_payl, sc_full_nof) + loraCalcTx2(sc_full_payl, sc_full_nof) +
        loraCalc(sc_last_payl, sc_last_nof) + loraCalcTx2(sc_last_payl, sc_last_nof)
    ) * lora_factor;

    // Geolocation HW currents
    // Profile mode: gnss_current_ma is pre-computed (failure model + motion/static split).
    // Manual mode: fall back to simple formula.
    const gps_geoloc_current  = input.gps.gnss_current_ma !== undefined
        ? input.gps.gnss_current_ma
        : calculate_gps_current(input.gps.ttff, input.gps.conv_time, input.gps.nof_msg_per_day);
    const lpgps_geoloc_current = input.lpgps?.gnss_current_ma ?? 0;
    const agps_geoloc_current = calculate_agps_current(input.agps.on_time, input.agps.nof_msg_per_day);
    const wifi_geoloc_current = calculate_wifi_current(input.wifi.nof_msg_per_day);
    // BLE geoloc HW scan current — BLE Scan 1 and BLE Scan 2 tracked separately
    const ble1_hw = input.ble.ble1
        ? calculate_ble_current(input.ble.ble1.nof_msg_per_day, input.ble.ble1.scan_duration_s)
        : calculate_ble_current(input.ble.nof_msg_per_day);
    const ble2_hw = input.ble.ble2
        ? calculate_ble_current(input.ble.ble2.nof_msg_per_day, input.ble.ble2.scan_duration_s)
        : 0;
    const ble_geoloc_current = ble1_hw + ble2_hw;

    // BLE custom usage
    const custom_ble_usage_current = calculate_custom_ble_usage_current(
        input.custom_ble.operation, input.custom_ble.usage_time_per_day
    );
    const scan_collection_current = calculate_scancollection_current(
        input.scan_collection.nof_msg_per_day, input.scan_collection.tech
    );

    // System
    const cpu_idle_current   = calculate_cpu_idle_current(input.cpu_idle_ua);
    const monitoring_current = calculate_monitoring_current(
        input.monitoring.period_s, input.monitoring.current_ma, input.monitoring.window_ms
    );

    // Total scheduled uplinks per day (all message types, before network split)
    const ble_msgs_per_day = input.ble.ble1
        ? (input.ble.ble1.nof_msg_per_day || 0) + (input.ble.ble2?.nof_msg_per_day || 0)
        : (input.ble.nof_msg_per_day || 0);
    const total_uplinks_per_day =
        (input.custom_msg.nof_msg_per_day || 0) +
        (input.heartbeat.nof_msg_per_day  || 0) +
        (input.status_msg.nof_msg_per_day || 0) +
        (input.gps.nof_msg_per_day        || 0) +
        (input.lpgps?.nof_msg_per_day     || 0) +
        (input.agps.nof_msg_per_day       || 0) +
        (input.wifi.nof_msg_per_day       || 0) +
        ble_msgs_per_day;

    // Cellular — cellular_factor scales total uplinks to those routed over cellular
    const cellular_current = calculate_cellular_current(
        input.cellular.coverage_pct,
        total_uplinks_per_day * cellular_factor
    );

    // Recovery beacon
    const _beacon = calculate_recovery_beacon_current(
        input.recovery_beacon.motion_period_s,
        input.recovery_beacon.static_period_s,
        input.recovery_beacon.motion_frac
    );
    const recovery_beacon_motion_current = _beacon.motion;
    const recovery_beacon_static_current = _beacon.static;
    const recovery_beacon_current = recovery_beacon_motion_current + recovery_beacon_static_current;

    // Battery self-discharge: applied on the full (total) capacity, not the usable fraction.
    const battery_leakage_current = calculate_battery_leakage_current(
        input.battery_capacity_mah,
        input.annual_discharge_pct
    );
    const fix_current = HW.quiescent_current_ma + battery_leakage_current;

    // LoRa link-check (probe): fixed energy per event, no TX2
    const lora_probe_nof  = input.lora_probe?.nof_per_day || 0;
    const lora_probe_current = LORA_PROBE_ENERGY_MAH * lora_probe_nof / 24;

    // Motion notifications — TX2 factors are mode-specific: start→dM (entering motion), end→dS (entering static)
    const motStartNof = input.motion_notifications?.start_nof_per_day || 0;
    const motEndNof   = input.motion_notifications?.end_nof_per_day   || 0;
    const motStartTx2 = input.motion_notifications?.tx2_factor_start  ?? 0;
    const motEndTx2   = input.motion_notifications?.tx2_factor_end    ?? 0;
    const loraCalcTx2Start = motStartTx2 > 0
        ? (pl, n) => (tx2_dr_dist
            ? calculate_lora_current_dr_weighted(input.tx_power, pl, n * motStartTx2, tx2_dr_dist, region, product)
            : calculate_lora_current(input.sf ?? 10, input.tx_power, pl, n * motStartTx2, product))
        : () => 0;
    const loraCalcTx2End = motEndTx2 > 0
        ? (pl, n) => (tx2_dr_dist
            ? calculate_lora_current_dr_weighted(input.tx_power, pl, n * motEndTx2, tx2_dr_dist, region, product)
            : calculate_lora_current(input.sf ?? 10, input.tx_power, pl, n * motEndTx2, product))
        : () => 0;
    const motion_start_lora_current =
        (loraCalc(MOTION_START_PAYL_LEN, motStartNof) + loraCalcTx2Start(MOTION_START_PAYL_LEN, motStartNof)) * lora_factor;
    const motion_end_lora_current =
        (loraCalc(MOTION_END_PAYL_LEN, motEndNof) + loraCalcTx2End(MOTION_END_PAYL_LEN, motEndNof)) * lora_factor;

    // Group totals
    // Geolocation: HW scan/fix current only. LoRa TX for all message types lives in lora_total.
    const cpu_total      = cpu_idle_current + monitoring_current + fix_current;
    const geoloc_total   = gps_geoloc_current + lpgps_geoloc_current + agps_geoloc_current + wifi_geoloc_current + ble_geoloc_current;
    const cellular_total = cellular_current;
    const lora_total     = custom_msg_lora_current + heartbeat_lora_current + status_lora_current
                         + scan_collection_lora_current + custom_ble_usage_current + scan_collection_current
                         + gps_lora_current + lpgps_lora_current + agps_lora_current + wifi_lora_current + ble_lora_current
                         + lora_probe_current
                         + motion_start_lora_current + motion_end_lora_current;
    const beacon_total   = recovery_beacon_current;

    const total_current = cpu_total + geoloc_total + cellular_total + lora_total + beacon_total;

    // Lifetime uses the usable portion of the battery; self-discharge already accounts for total.
    const usable_mah = input.usable_capacity_mah ?? input.battery_capacity_mah;
    const battery_life_days = Math.round(
        10 * (usable_mah / total_current) / 24
    ) / 10;

    // Per-component breakdown (mA)
    const components = {
        cpu_quiescent:        fix_current,
        cpu_idle:             cpu_idle_current,
        cpu_monitoring:       monitoring_current,
        geoloc_gps:           gps_geoloc_current,
        geoloc_lpgps:         lpgps_geoloc_current,
        geoloc_agps:          agps_geoloc_current,
        geoloc_wifi:          wifi_geoloc_current,
        geoloc_ble:           ble_geoloc_current,   // combined (manual/fallback)
        geoloc_ble1:          ble1_hw,              // BLE Scan 1 (profile mode)
        geoloc_ble2:          ble2_hw,              // BLE Scan 2
        cellular:             cellular_current,
        lora_heartbeat:       heartbeat_lora_current,
        lora_status_msg:      status_lora_current,
        lora_custom_msg:      custom_msg_lora_current,
        lora_scan_collection: scan_collection_lora_current + scan_collection_current,
        lora_custom_ble:      custom_ble_usage_current,
        lora_probe:           lora_probe_current,
        lora_motion_start:    motion_start_lora_current,
        lora_motion_end:      motion_end_lora_current,
        recovery_beacon_motion: recovery_beacon_motion_current,
        recovery_beacon_static: recovery_beacon_static_current,
    };

    const distribution = {};
    for (const [k, v] of Object.entries(components)) {
        distribution[k] = Math.round(1000 * v / total_current) / 10;
    }

    const group_currents_ma = {
        cpu:             cpu_total,
        geolocation:     geoloc_total,
        cellular:        cellular_total,
        lora:            lora_total,
        network:         cellular_total + lora_total,
        recovery_beacon: beacon_total,
    };

    return {
        battery_life_days,
        total_current_ma:  total_current,
        components_ma:     components,
        distribution_pct:  distribution,
        group_currents_ma,
        lora: {
            dr_sf_str:  drSfStr,
            tx2_dr_str: tx2DrStr,
            tx2_factor,
        },
        battery: {
            total_capacity_mah:   input.battery_capacity_mah,
            capacity_mah:         usable_mah,
            usable_pct:           input.usable_pct ?? 100,
            annual_discharge_pct: input.annual_discharge_pct,
            annual_discharge_mah: Math.round(input.battery_capacity_mah * input.annual_discharge_pct / 100 * 10) / 10,
            leakage_current_ua:   Math.round(battery_leakage_current * 1000 * 10) / 10,
        }
    };
}

if (typeof module !== 'undefined') {
    module.exports = {
        calculate_battery_life_time,
        calculate_lora_current,
        calculate_lora_current_dr_weighted,
        calculate_cellular_current,
        applyHardwareMeasurements,
        LORAWAN_DR_TO_SF,
        LORA_TX_CURRENT_MA,
        CELLULAR_ENERGY_PER_UPLINK_MAH,
        LORA_PROBE_ENERGY_MAH,
        HW,
    };
}
