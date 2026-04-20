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
    lora_rx_current_ma:         10,
    lora_tx_14dbm_current_ma:   45,
    lora_tx_17dbm_current_ma:   75,
    lora_tx_19dbm_current_ma:   85,

    // GNSS / GPS
    gnss_active_current_ma:     30,    // GNSS chipset active current (standalone fix)
    lpgps_active_current_ma:    20,    // LP-GPS chipset active current
    gps_active_current_ma:      22,    // kept for AGPS (assisted mode)
    gps_standby_current_ma:     0.05,

    // WiFi
    wifi_scan_current_ma:       11.6,
    wifi_scan_duration_s:       9,

    // BLE scan (geolocation) — current measured at 10.12 mA
    ble_scan_current_ma:        10.12,
    ble_scan_duration_s:        3,     // fallback default; profile-based path uses per-scan durations

    // Monitoring wakeup
    monitoring_current_ma:      5,
    monitoring_window_ms:       10,

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

// Piecewise-linear interpolation of TX current from measured calibration points.
// Values outside the range are clamped to the nearest endpoint.
function getTxCurrentMa(dbm) {
    const pts = [
        [14, HW.lora_tx_14dbm_current_ma],
        [17, HW.lora_tx_17dbm_current_ma],
        [19, HW.lora_tx_19dbm_current_ma],
    ];
    if (dbm <= pts[0][0]) return pts[0][1];
    if (dbm >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i < pts.length - 1; i++) {
        if (dbm <= pts[i + 1][0]) {
            const t = (dbm - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
            return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
        }
    }
}

const CELLULAR_TECHS = {
    ltem: {
        descr: 'LTE-M',
        get tx_current()   { return HW.ltem_tx_current_ma;   },
        get rx_current()   { return HW.ltem_rx_current_ma;   },
        get idle_current() { return HW.ltem_idle_current_ma; },
    },
    nbiot: {
        descr: 'NB-IoT',
        get tx_current()   { return HW.nbiot_tx_current_ma;   },
        get rx_current()   { return HW.nbiot_rx_current_ma;   },
        get idle_current() { return HW.nbiot_idle_current_ma; },
    },
};

// LoRa payload lengths [bytes] — protocol constants, not measurements
const HEARTBEAT_PAYL_LEN              = 12;
const STATUS_PAYL_LEN                 = 12;
const GPS_PAYL_LEN                    = 16;
const LPGPS_PAYL_LEN                  = 24;
const AGPS_MIN_PAYL_LEN               = 6;
const AGPS_ADDITIONAL_SAT_PAYL_LEN   = 5;
const WIFI_MIN_PAYL_LEN               = 6;
const WIFI_ADDITIONAL_BSSID_PAYL_LEN  = 7;
const BLE_MIN_PAYL_LEN                = 6;
const BLE_ADDITIONAL_BSSID_PAYL_LEN   = 7;
const RECOVERY_BEACON_PAYL_LEN        = 4;

const SCANCOLL_MIN_PAYL_LEN                  = 8;
const SCANCOLL_ADDITIONAL_MACADDR_PAYL_LEN   = 7;
const SCANCOLL_ADDITIONAL_BEACONID_PAYL_LEN  = 4;


/* ─────────────────────────────────────────────────────────────────
 * CALCULATION FUNCTIONS
 * ──────────────────────────────────────────────────────────────── */

function calculate_lora_current(sf, tx_power, payl_len, nof_msg_per_day) {
    const SYMBOL_TIME   = (2 ** sf) / 125;
    const PREAMBLE_TIME = 12.25 * SYMBOL_TIME;

    let time_on_air;
    if (sf >= 11) {
        time_on_air = SYMBOL_TIME * (8 + Math.ceil(((payl_len + 12) * 8 - 4 * (sf - 7) + 16) / (4 * sf - 8)) * 5);
    } else {
        time_on_air = SYMBOL_TIME * (8 + Math.ceil(((payl_len + 12) * 8 - 4 * (sf - 7) + 16) / (4 * sf - 0)) * 5);
    }
    const total_time_on_air = time_on_air + PREAMBLE_TIME;

    const tx_energy  = total_time_on_air * HW.supply_voltage * getTxCurrentMa(tx_power) / 1000;
    const rx_energy  = 2 * 8 * SYMBOL_TIME * HW.supply_voltage * HW.lora_rx_current_ma / 1000;
    const mcu_energy = (total_time_on_air + 2000) * HW.supply_voltage * HW.mcu_active_current_ma / 1000;
    const total_energy = tx_energy + rx_energy + mcu_energy;

    return (total_energy / HW.supply_voltage) * (nof_msg_per_day / (24 * 3600));
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
function calculate_cellular_current(tech, sessions_per_day, session_duration_s) {
    if (!tech || sessions_per_day <= 0) return 0;
    const ct = CELLULAR_TECHS[tech];
    const CONNECT_TIME_S = 1.0;
    const energy_per_session = (
        CONNECT_TIME_S     * ct.tx_current * HW.supply_voltage / 1000 +
        session_duration_s * ct.rx_current * HW.supply_voltage / 1000
    );
    return (energy_per_session / HW.supply_voltage) * (sessions_per_day / (24 * 3600));
}

/**
 * Recovery beacon: periodic LoRa TX at configurable SF/power.
 * interval_min = 0 means disabled.
 */
function calculate_recovery_beacon_current(beacon_interval_min, sf, tx_power) {
    if (beacon_interval_min <= 0) return 0;
    const nof_msg_per_day = (24 * 60) / beacon_interval_min;
    return calculate_lora_current(sf, tx_power, RECOVERY_BEACON_PAYL_LEN, nof_msg_per_day);
}


/* ─────────────────────────────────────────────────────────────────
 * MAIN ENTRY POINT
 * ──────────────────────────────────────────────────────────────── */
function calculate_battery_life_time(input) {

    // Network usage factors (0–1) — scale LoRa TX and Cellular currents
    const lora_factor     = input.net_usage_lora_pct     !== undefined ? input.net_usage_lora_pct     / 100 : 1.0;
    const cellular_factor = input.net_usage_cellular_pct !== undefined ? input.net_usage_cellular_pct / 100 : 1.0;

    // LoRa currents (scaled by lora_factor)
    const custom_msg_lora_current =
        calculate_lora_current(input.sf, input.tx_power, input.custom_msg.payl_len, input.custom_msg.nof_msg_per_day) * lora_factor;

    const heartbeat_lora_current =
        calculate_lora_current(input.sf, input.tx_power, HEARTBEAT_PAYL_LEN, input.heartbeat.nof_msg_per_day) * lora_factor;

    const status_lora_current =
        calculate_lora_current(input.sf, input.tx_power, STATUS_PAYL_LEN, input.status_msg.nof_msg_per_day) * lora_factor;

    const gps_lora_current =
        calculate_lora_current(input.sf, input.tx_power, GPS_PAYL_LEN, input.gps.nof_msg_per_day) * lora_factor;

    const lpgps_lora_current =
        calculate_lora_current(input.sf, input.tx_power, LPGPS_PAYL_LEN, input.lpgps?.nof_msg_per_day || 0) * lora_factor;

    const agps_lora_current = calculate_lora_current(
        input.sf, input.tx_power,
        AGPS_MIN_PAYL_LEN + (input.agps.nof_satellites * AGPS_ADDITIONAL_SAT_PAYL_LEN),
        input.agps.nof_msg_per_day
    ) * lora_factor;

    const wifi_lora_current = calculate_lora_current(
        input.sf, input.tx_power,
        WIFI_MIN_PAYL_LEN + (input.wifi.nof_bssid * WIFI_ADDITIONAL_BSSID_PAYL_LEN),
        input.wifi.nof_msg_per_day
    ) * lora_factor;

    // BLE geoloc LoRa uplinks — BLE Scan 1 and BLE Scan 2 tracked separately
    const ble1_lora = (input.ble.ble1
        ? calculate_lora_current(
              input.sf, input.tx_power,
              BLE_MIN_PAYL_LEN + input.ble.ble1.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN,
              input.ble.ble1.nof_msg_per_day)
        : calculate_lora_current(
              input.sf, input.tx_power,
              BLE_MIN_PAYL_LEN + input.ble.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN,
              input.ble.nof_msg_per_day)
    ) * lora_factor;
    const ble2_lora = input.ble.ble2
        ? calculate_lora_current(
              input.sf, input.tx_power,
              BLE_MIN_PAYL_LEN + input.ble.ble2.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN,
              input.ble.ble2.nof_msg_per_day) * lora_factor
        : 0;
    const ble_lora_current = ble1_lora + ble2_lora;

    // Scan collection (fragmented)
    const scancoll_unit_len = (input.scan_collection.tech === 'BLE' && input.scan_collection.idtype === 'ID')
        ? SCANCOLL_ADDITIONAL_BEACONID_PAYL_LEN
        : SCANCOLL_ADDITIONAL_MACADDR_PAYL_LEN;

    const nof_id_in_full_msg = Math.floor((input.scan_collection.max_payl_len - SCANCOLL_MIN_PAYL_LEN) / scancoll_unit_len);
    const nof_id_last_msg    = input.scan_collection.nof_id % nof_id_in_full_msg;
    const nof_full_fragments = Math.floor(input.scan_collection.nof_id / nof_id_in_full_msg);

    const scan_collection_lora_current = (
        calculate_lora_current(
            input.sf, input.tx_power,
            SCANCOLL_MIN_PAYL_LEN + nof_id_in_full_msg * scancoll_unit_len,
            nof_full_fragments * input.scan_collection.nof_msg_per_day
        ) +
        calculate_lora_current(
            input.sf, input.tx_power,
            SCANCOLL_MIN_PAYL_LEN + nof_id_last_msg * scancoll_unit_len,
            input.scan_collection.nof_msg_per_day
        )
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

    // Cellular (scaled by cellular_factor)
    const cellular_current = calculate_cellular_current(
        input.cellular.tech,
        input.cellular.sessions_per_day,
        input.cellular.session_duration_s
    ) * cellular_factor;

    // Recovery beacon
    const recovery_beacon_current = calculate_recovery_beacon_current(
        input.recovery_beacon.interval_min,
        input.recovery_beacon.sf,
        input.recovery_beacon.tx_power
    );

    // Battery self-discharge (leakage)
    const battery_leakage_current = calculate_battery_leakage_current(
        input.battery_capacity_mah,
        input.annual_discharge_pct
    );
    const fix_current = HW.quiescent_current_ma + battery_leakage_current;

    // Group totals
    const cpu_total      = cpu_idle_current + monitoring_current + fix_current;
    const geoloc_total   = gps_geoloc_current + lpgps_geoloc_current + agps_geoloc_current + wifi_geoloc_current + ble_geoloc_current
                         + gps_lora_current + lpgps_lora_current + agps_lora_current + wifi_lora_current + ble_lora_current;
    const cellular_total = cellular_current;
    const lora_total     = custom_msg_lora_current + heartbeat_lora_current + status_lora_current
                         + scan_collection_lora_current + custom_ble_usage_current + scan_collection_current
                         + ble_lora_current;
    const beacon_total   = recovery_beacon_current;

    const total_current = cpu_total + geoloc_total + cellular_total + lora_total + beacon_total;

    const battery_life_days = Math.round(
        10 * (input.battery_capacity_mah / total_current) / 24
    ) / 10;

    // Per-component breakdown (mA)
    const components = {
        cpu_quiescent:        fix_current,
        cpu_idle:             cpu_idle_current,
        cpu_monitoring:       monitoring_current,
        geoloc_gps:           gps_geoloc_current   + gps_lora_current,
        geoloc_lpgps:         lpgps_geoloc_current + lpgps_lora_current,
        geoloc_agps:          agps_geoloc_current  + agps_lora_current,
        geoloc_wifi:          wifi_geoloc_current + wifi_lora_current,
        geoloc_ble:           ble_geoloc_current  + ble_lora_current,  // combined (manual/fallback)
        geoloc_ble1:          ble1_hw + ble1_lora,                     // BLE Scan 1 (profile mode)
        geoloc_ble2:          ble2_hw + ble2_lora,                     // BLE Scan 2 (0 if not split)
        cellular:             cellular_current,
        lora_heartbeat:       heartbeat_lora_current,
        lora_status_msg:      status_lora_current,
        lora_custom_msg:      custom_msg_lora_current,
        lora_scan_collection: scan_collection_lora_current + scan_collection_current,
        lora_custom_ble:      custom_ble_usage_current,
        recovery_beacon:      recovery_beacon_current,
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
        battery: {
            capacity_mah:         input.battery_capacity_mah,
            annual_discharge_pct: input.annual_discharge_pct,
            annual_discharge_mah: Math.round(input.battery_capacity_mah * input.annual_discharge_pct / 100 * 10) / 10,
            leakage_current_ua:   Math.round(battery_leakage_current * 1000 * 10) / 10,
        }
    };
}

if (typeof module !== 'undefined') {
    module.exports = { calculate_battery_life_time, applyHardwareMeasurements, HW };
}
