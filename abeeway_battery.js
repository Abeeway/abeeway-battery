/*********************************************************************/
/***** BATTERY LIFE CALCULATION SCRIPTS                          *****/
/*********************************************************************/

/* ─────────────────────────────────────────────────────────────────
 * TOOL VERSION — MAJOR.MINOR.PATCH (history in CHANGELOG.md)
 *   MAJOR : model structure changes
 *   MINOR : estimates change (constants, formulas)
 *   PATCH : display / UI only, estimates unchanged
 * ──────────────────────────────────────────────────────────────── */
const TOOL_VERSION = '1.0.0';


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
    lora_startup_time_ms:       50,    // radio startup before each TX (not part of time on air) — measured
    lora_startup_current_ma:    4,     // current during radio startup — measured
    // RX window length = preamble-detection timeout at the window's SF (see lora_rx_window_ms())
    lora_rx_min_symbols:        2,     // minimum symbols to detect a preamble (2: matches Joulescope RX2 @ SF12 ≈ 68 ms)
    lora_rx_error_ms:           10,    // max timing error on window opening (± clock drift) [ms]

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

// Uplink DR → modulation per LoRaWAN region (LoRaWAN Regional Parameters RP002).
//   { sf, bw }  : LoRa, spreading factor + bandwidth [kHz]
//   { fsk }     : GFSK, bit rate [kbps]
// DRs missing from a region are RFU / LR-FHSS (not modelled).
const _LORA_SF12_SF7_125 = {
    0: { sf: 12, bw: 125 }, 1: { sf: 11, bw: 125 }, 2: { sf: 10, bw: 125 },
    3: { sf:  9, bw: 125 }, 4: { sf:  8, bw: 125 }, 5: { sf:  7, bw: 125 },
};
const LORAWAN_DR_TABLE = {
    EU868: { ..._LORA_SF12_SF7_125, 6: { sf: 7, bw: 250 }, 7: { fsk: 50 } },
    US915: { 0: { sf: 10, bw: 125 }, 1: { sf: 9, bw: 125 }, 2: { sf: 8, bw: 125 },
             3: { sf:  7, bw: 125 }, 4: { sf: 8, bw: 500 } },
    AU915: { ..._LORA_SF12_SF7_125, 6: { sf: 8, bw: 500 } },
    AS923: { ..._LORA_SF12_SF7_125, 6: { sf: 7, bw: 250 }, 7: { fsk: 50 } },
    KR920: { ..._LORA_SF12_SF7_125 },
    IN865: { ..._LORA_SF12_SF7_125, 7: { fsk: 50 } },
    RU864: { ..._LORA_SF12_SF7_125, 6: { sf: 7, bw: 250 }, 7: { fsk: 50 } },
};

// Human-readable DR label, e.g. "DR0(SF12)", "DR6(SF7/250kHz)", "DR7(FSK)"
function loraDrLabel(dr, region) {
    const m = (LORAWAN_DR_TABLE[region] ?? LORAWAN_DR_TABLE.EU868)[dr];
    if (!m) return `DR${dr}(n/a)`;
    if (m.fsk) return `DR${dr}(FSK)`;
    return m.bw === 125 ? `DR${dr}(SF${m.sf})` : `DR${dr}(SF${m.sf}/${m.bw}kHz)`;
}

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
const BLE_RSSI_PAYL_LEN               = 1;  // RSSI byte reported with each beacon
const BLE_MIN_PAYL_LEN                = GEOLOC_HDR;       // 8 (no tech-specific minimum)
const BLE_ADDITIONAL_BSSID_PAYL_LEN   = 7 + BLE_RSSI_PAYL_LEN;  // default bytes per beacon (report type 0) = 8
// Bytes per reported beacon from ble_scanX_report_type = ID length + 1 B RSSI:
//   0 → 7 + 1 = 8 B,  1 → 2 + 1 = 3 B,  2 → 16 + 1 = 17 B
function bleIdBytes(report_type) {
    const rt = parseInt(report_type);
    const id_len = rt === 1 ? 2 : rt === 2 ? 16 : 7;
    return id_len + BLE_RSSI_PAYL_LEN;
}
const RECOVERY_BEACON_MAH             = 0.00036;  // energy per single beacon transmission [mAh]
const LORA_PROBE_ENERGY_MAH           = 0.006;    // energy per single LoRa link-check (probe) [mAh]


/* ─────────────────────────────────────────────────────────────────
 * DEVICE CONFIG PARAMETER IDs
 * Production config files identify parameters by ID ("P0100=300")
 * instead of by name ("core_monitoring_period = 300").
 * ID format: 'P' + group (2 hex digits) + index in group (2 hex digits).
 * The parser converts IDs to names with this table, so the rest of the
 * tool only works with parameter names.
 * ──────────────────────────────────────────────────────────────── */
const CONFIG_PARAM_ID_TO_NAME = {
    P0100: "core_monitoring_period",
    P0101: "core_status_period",
    P0102: "core_notif_enable",
    P0103: "core_temp_high_threshold",
    P0104: "core_temp_low_threshold",
    P0105: "core_temp_hysteresis",
    P0106: "core_button1_map",
    P0107: "core_button2_map",
    P0108: "core_buttons_timing",
    P0109: "core_led0_map",
    P010a: "core_led1_map",
    P010b: "core_buzzer_map",
    P010c: "core_almanac_validity",
    P010d: "core_almanac_outdated_ratio",
    P010f: "core_db_type_mask",

    P0200: "geoloc_motion_period",
    P0201: "geoloc_static_period",
    P0202: "geoloc_sos_period",
    P0203: "geoloc_motion_nb_start",
    P0204: "geoloc_motion_nb_stop",
    P0205: "geoloc_start_stop_period",
    P0206: "geoloc_gnss_hold_on_mode",
    P0207: "geoloc_gnss_hold_on_timeout",
    P0208: "geoloc_profile0_triggers",
    P0209: "geoloc_profile1_triggers",
    P020a: "geoloc_profile2_triggers",
    P020b: "geoloc_gbe_profile0_techno",
    P020c: "geoloc_gbe_profile1_techno",
    P020d: "geoloc_gbe_profile2_techno",

    P0300: "gnss_constellation",
    P0301: "gnss_max_time",
    P0302: "gnss_t0_timeout_static",
    P0303: "gnss_ehpe_static",
    P0304: "gnss_convergence_static",
    P0305: "gnss_t0_timeout_motion",
    P0306: "gnss_ehpe_motion",
    P0307: "gnss_convergence_motion",
    P0308: "gnss_standby_time",
    P0309: "gnss_agnss_max_time",
    P030a: "gnss_t1_timeout",

    P0400: "lr_constellation",
    P0401: "lr_scan_mode",
    P0402: "lr_nb_scan",
    P0403: "lr_inter_scan_time",
    P0404: "lr_wifi_report_nb_bssid",
    P0405: "lr_wifi_min_nb_bssid",
    P0406: "lr_wifi_min_rssi",
    P0407: "lr_wifi_bssid_mac_type",
    P0408: "lr_rbeacon_type",
    P0409: "lr_rbeacon_sos_period",
    P040a: "lr_rbeacon_motion_period",
    P040b: "lr_rbeacon_static_period",
    P040c: "lr_rbeacon_ranging_timeout",

    P0500: "ble_scan1_duration",
    P0501: "ble_scan1_window",
    P0502: "ble_scan1_interval",
    P0503: "ble_scan1_type",
    P0504: "ble_scan1_min_rssi",
    P0505: "ble_scan1_min_nb_beacons",
    P0506: "ble_scan1_filter1_mask",
    P0507: "ble_scan1_filter1_value",
    P0508: "ble_scan1_filter1_offset",
    P0509: "ble_scan1_filter2_mask",
    P050a: "ble_scan1_filter2_value",
    P050b: "ble_scan1_filter2_offset",
    P050c: "ble_scan1_nb_beacons",
    P050d: "ble_scan1_report_type",
    P050e: "ble_scan1_report_id_ofs",

    P0600: "ble_scan2_duration",
    P0601: "ble_scan2_window",
    P0602: "ble_scan2_interval",
    P0603: "ble_scan2_type",
    P0604: "ble_scan2_min_rssi",
    P0605: "ble_scan2_min_nb_beacons",
    P0606: "ble_scan2_filter1_mask",
    P0607: "ble_scan2_filter1_value",
    P0608: "ble_scan2_filter1_offset",
    P0609: "ble_scan2_filter2_mask",
    P060a: "ble_scan2_filter2_value",
    P060b: "ble_scan2_filter2_offset",
    P060c: "ble_scan2_nb_beacons",
    P060d: "ble_scan2_report_type",
    P060e: "ble_scan2_report_id_ofs",

    P0700: "accelero_motion_sensi",
    P0701: "accelero_motion_duration",
    P0702: "accelero_full_scale",
    P0703: "accelero_output_data_rate",
    P0704: "accelero_shock_threshold",

    P0800: "net_selection",
    P0801: "net_reconnection_spacing_static",
    P0802: "net_main_probe_timeout_static",
    P0803: "net_reconnection_spacing_motion",
    P0804: "net_main_probe_timeout_motion",

    P0900: "lorawan_cnx_timeout",
    P0901: "lorawan_heartbeat_period",
    P0902: "lorawan_probe_max_attempts_static",
    P0903: "lorawan_probe_period_static",
    P0904: "lorawan_confirm_notif_map",
    P0905: "lorawan_confirm_notif_retry",
    P0906: "lorawan_s1_tx_strategy",
    P0907: "lorawan_s1_ul_port",
    P0908: "lorawan_s1_dl_port",
    P0909: "lorawan_probe_period_motion",
    P090a: "lorawan_probe_max_attempts_motion",

    P0a00: "cell_sim_interface",
    P0a01: "cell_network_type",
    P0a02: "cell_search_bands",
    P0a03: "cell_cnx_timeout_static",
    P0a04: "cell_cnx_timeout_motion",
    P0a05: "cell_cnx_nw_reconnect_timeout",
    P0a06: "cell_cnx_max_attempts",
    P0a07: "cell_access_point_name",
    P0a08: "cell_operator_sim_slot_0",
    P0a09: "cell_operator_sim_slot_1",
    P0a0a: "cell_low_power_mode",
    P0a0b: "cell_psm_tau_period",
    P0a0c: "cell_psm_active_time",
    P0a0d: "cell_edrx_pcl",
    P0a0e: "cell_edrx_ptw",
    P0a0f: "cell_rai_timeout",
    P0a10: "cell_max_probe_attempts",
    P0a11: "cell_probe_period",
    P0a12: "cell_s1_transport_proto",
    P0a13: "cell_s1_ip_url_addr",
    P0a14: "cell_s1_dst_ip_port",
    P0a15: "cell_s1_src_ip_port",
    P0a16: "cell_s1_tx_aggr_time",
    P0a17: "cell_apn_user_id",
    P0a18: "cell_apn_user_pwd",
    P0a19: "cell_apn_auth_protocol",
    P0a1a: "cell_fuota_server_ip_url_addr",
    P0a1b: "cell_restricted_plmns",
    P0a1c: "cell_lpm_recovery_timeout",

    P0b00: "ble_cnx_tx_power",
    P0b01: "ble_cnx_adv_duration",
    P0b02: "ble_cnx_behavior",
    P0b03: "ble_beacon_tx_power",
    P0b04: "ble_beacon_type",
    P0b05: "ble_beacon_identifier",
    P0b06: "ble_beacon_fast_adv_interval",
    P0b07: "ble_beacon_slow_adv_interval",
    P0b08: "ble_scan_presence_period",
    P0b09: "ble_scan_presence_max_time",
};


/**
 * Default AT3 device configuration (name format), loaded by the
 * "Load default configuration" button for quick testing of the tool.
 * Same content as AT3_name_based_config.txt.
 */
const DEFAULT_DEVICE_CONFIG_TEXT = `
core_monitoring_period = 300
core_status_period = 3600
core_notif_enable = "{3B,00,07,03,00,00}"
core_temp_high_threshold = 60
core_temp_low_threshold = 0
core_temp_hysteresis = 5
core_button1_map = 896
core_button2_map = 0
core_buttons_timing = 3289762
core_led0_map = "{00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00}"
core_led1_map = "{00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00}"
core_buzzer_map = "{09,03,24,09,01,25,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00}"
core_almanac_validity = 120
core_almanac_outdated_ratio = 100
core_db_type_mask = "{00,00,00,00,00,00,00}"
geoloc_motion_period = 300
geoloc_static_period = 3600
geoloc_sos_period = 60
geoloc_motion_nb_start = 1
geoloc_motion_nb_stop = 1
geoloc_start_stop_period = 120
geoloc_gnss_hold_on_mode = 0
geoloc_gnss_hold_on_timeout = 0
geoloc_profile0_triggers = 61
geoloc_profile1_triggers = 0
geoloc_profile2_triggers = 0
geoloc_gbe_profile0_techno = "{06,00,00,00,00,00}"
geoloc_gbe_profile1_techno = "{00,00,00,00,00,00}"
geoloc_gbe_profile2_techno = "{00,00,00,00,00,00}"
gnss_constellation = 2
gnss_max_time = 300
gnss_t0_timeout_static = 30
gnss_ehpe_static = 20
gnss_convergence_static = 20
gnss_t0_timeout_motion = 30
gnss_ehpe_motion = 30
gnss_convergence_motion = 20
gnss_standby_time = 604800
gnss_agnss_max_time = 45
gnss_t1_timeout = 0
lr_constellation = 6
lr_scan_mode = 1
lr_nb_scan = 2
lr_inter_scan_time = 5
lr_wifi_report_nb_bssid = 4
lr_wifi_min_nb_bssid = 3
lr_wifi_min_rssi = 0
lr_wifi_bssid_mac_type = 1
lr_rbeacon_type = 2
lr_rbeacon_sos_period = 0
lr_rbeacon_motion_period = 0
lr_rbeacon_static_period = 0
lr_rbeacon_ranging_timeout = 120
ble_scan1_duration = 3000
ble_scan2_duration = 3000
ble_scan1_window = 120
ble_scan2_window = 120
ble_scan1_interval = 130
ble_scan2_interval = 130
ble_scan1_type = 0
ble_scan2_type = 0
ble_scan1_min_rssi = -80
ble_scan2_min_rssi = -80
ble_scan1_min_nb_beacons = 1
ble_scan2_min_nb_beacons = 1
ble_scan1_filter1_mask = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan2_filter1_mask = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan1_filter1_value = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan2_filter1_value = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan1_filter1_offset = 0
ble_scan2_filter1_offset = 0
ble_scan1_filter2_mask = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan2_filter2_mask = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan1_filter2_value = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan2_filter2_value = "{00,00,00,00,00,00,00,00,00,00}"
ble_scan1_filter2_offset = 0
ble_scan2_filter2_offset = 0
ble_scan1_nb_beacons = 4
ble_scan2_nb_beacons = 4
ble_scan1_report_type = 0
ble_scan2_report_type = 0
ble_scan1_report_id_ofs = 0
ble_scan2_report_id_ofs = 0
accelero_motion_sensi = 8
accelero_motion_duration = 120
accelero_full_scale = 3
accelero_output_data_rate = 0
accelero_shock_threshold = 0
net_selection = 0
net_reconnection_spacing_static = 600
net_main_probe_timeout_static = 600
net_reconnection_spacing_motion = 600
net_main_probe_timeout_motion = 600
lorawan_cnx_timeout = 0
lorawan_heartbeat_period = 600
lorawan_probe_max_attempts_static = 4
lorawan_probe_period_static = 43200
lorawan_probe_period_motion = 43200
lorawan_probe_max_attempts_motion = 4
lorawan_confirm_notif_map = "{00,00,00,00,00,00}"
lorawan_confirm_notif_retry = 0
lorawan_s1_tx_strategy = 473102
lorawan_s1_ul_port = 19
lorawan_s1_dl_port = 3
cell_sim_interface = 0
cell_network_type = 1
cell_search_bands = "{01,03,08,13,14,1C,00,00,00,00,00,00,00,00,00,00,00,00,00}"
cell_cnx_timeout_static = 180
cell_cnx_timeout_motion = 300
cell_cnx_nw_reconnect_timeout = 60
cell_cnx_max_attempts = 3
cell_access_point_name = ""
cell_operator_sim_slot_0 = ""
cell_operator_sim_slot_1 = ""
cell_low_power_mode = 1
cell_psm_tau_period = 24
cell_psm_active_time = 2
cell_edrx_pcl = 15
cell_edrx_ptw = 3
cell_rai_timeout = 500
cell_max_probe_attempts = 0
cell_probe_period = 120
cell_s1_transport_proto = 1
cell_s1_ip_url_addr = ""
cell_s1_dst_ip_port = 0
cell_s1_src_ip_port = 0
cell_s1_tx_aggr_time = 120
cell_apn_user_id = ""
cell_apn_user_pwd = ""
cell_apn_auth_protocol = 1
cell_fuota_server_ip_url_addr = "tools.abeeway.io"
cell_restricted_plmns = ""
cell_lpm_recovery_timeout = 0
ble_cnx_tx_power = 25
ble_cnx_adv_duration = 60
ble_cnx_behavior = 1
ble_beacon_tx_power = 25
ble_beacon_type = 0
ble_beacon_identifier = "{00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00,00}"
ble_beacon_fast_adv_interval = 333
ble_beacon_slow_adv_interval = 1000
ble_scan_presence_period = 0
ble_scan_presence_max_time = 0
`;

const CONFIG_PARAM_ID_REGEX = /^[Pp][0-9a-fA-F]{4}$/;

/**
 * Convert a config key to its parameter name.
 * Returns { name, isId, known }:
 *   - name key ("core_status_period") → returned as is (isId = false)
 *   - known ID  ("P0101" / "p0101")   → its name       (isId = true, known = true)
 *   - unknown ID                      → the ID itself  (isId = true, known = false)
 */
function configKeyToName(key) {
    if (!CONFIG_PARAM_ID_REGEX.test(key)) return { name: key, isId: false, known: true };
    const id   = 'P' + key.slice(1).toLowerCase();
    const name = CONFIG_PARAM_ID_TO_NAME[id];
    return name ? { name, isId: true, known: true } : { name: key, isId: true, known: false };
}


/* ─────────────────────────────────────────────────────────────────
 * CALCULATION FUNCTIONS
 * ──────────────────────────────────────────────────────────────── */

// LoRa time-on-air + RX windows → average current [mA].
//
// ToA formula (LoRa spec, explicit header, CRC enabled, CR 4/5):
//   T_sym [ms]   = 2^SF / BW_kHz  (BW = 125 kHz unless given: 250 / 500 kHz DRs)
//   T_preamble   = (n_preamble + 4.25) × T_sym = 12.25 × T_sym  (n_preamble = 8)
//   DE           = 1 if T_sym ≥ 16 ms (low-data-rate optimisation: SF11/SF12 at 125 kHz), else 0
//   n_payload    = 8 + max(⌈(8×PL - 4×SF + 44) / (4×(SF − 2×DE))⌉ × 5, 0)
//     where PL = payload_bytes + 13 (LoRaWAN MAC overhead:
//                MHDR(1) + DevAddr(4) + FCtrl(1) + FCnt(2) + FPort(1) + MIC(4))
//   T_payload    = n_payload × T_sym
//   T_packet     = T_preamble + T_payload   (pure time on air, no startup)
//
// Radio startup (before each TX): T_startup = HW.lora_startup_time_ms (50 ms, measured)
//   at I_startup = HW.lora_startup_current_ma (4 mA, measured), not at TX current
//
// RX windows (Class A, no downlink assumed → each window only waits for a preamble):
//   RX1 modulation = TX modulation (RX1DROffset = 0)
//   RX2 modulation = SF12 / 125 kHz (always)
//   T_win = max(N_min, ⌈((2×N_min − 8)×T_sym + 2×T_err) / T_sym⌉) × T_sym
//     N_min = HW.lora_rx_min_symbols (2), T_err = HW.lora_rx_error_ms (10 ms)
//     FSK: T_sym = 8 / kbps (one byte)
//
// Energy per uplink [mJ]:
//   E_TX  = T_packet [ms] × V [V] × I_TX(dBm, product) [mA]  / 1000
//   E_RX  = (T_win(RX1) + T_win(RX2)) [ms] × V [V] × I_RX [mA]  / 1000
//   E_SU  = T_startup [ms] × V [V] × I_startup [mA]  / 1000
//   Note: I_TX already includes MCU active current (measured with MCU running)
//
// Average current [mA] = (E_TX + E_RX + E_SU) / V × N_msg_per_day / 86400
//
// FSK DRs (e.g. EU868 DR7, 50 kbps): ToA = (5 preamble + 3 sync + 1 length + PL + 2 CRC) bytes × 8 / kbps
//
// `sf` may be a number (LoRa, 125 kHz) or a modulation from LORAWAN_DR_TABLE ({sf, bw} or {fsk}).
function lora_time_on_air_ms(mod, payl_len) {
    const PL = payl_len + 13;                             // total PHY bytes incl. LoRaWAN overhead
    if (mod.fsk) {
        return (5 + 3 + 1 + PL + 2) * 8 / mod.fsk;
    }
    const sf         = mod.sf;
    const T_sym      = (2 ** sf) / (mod.bw || 125);       // symbol period [ms]
    const T_preamble = 12.25 * T_sym;                     // preamble time [ms]
    const DE         = T_sym >= 16 ? 1 : 0;
    const n_payload  = 8 + Math.max(
        Math.ceil((8 * PL - 4 * sf + 44) / (4 * (sf - 2 * DE))) * 5, 0);
    return T_preamble + n_payload * T_sym;
}

// RX2 always uses SF12 / 125 kHz
const LORA_RX2_MOD = { sf: 12, bw: 125 };

// RX window duration [ms] for a modulation ({sf, bw} or {fsk}): time the radio
// stays in RX to detect a preamble before timing out (no downlink).
function lora_rx_window_ms(mod) {
    const T_sym = mod.fsk ? 8 / mod.fsk                    // FSK: one byte [ms]
                          : (2 ** mod.sf) / (mod.bw || 125);
    const N_min = HW.lora_rx_min_symbols;
    const n_sym = Math.max(N_min,
        Math.ceil(((2 * N_min - 8) * T_sym + 2 * HW.lora_rx_error_ms) / T_sym));
    return n_sym * T_sym;
}

function calculate_lora_current(sf, tx_power, payl_len, nof_msg_per_day, product) {
    const mod        = typeof sf === 'object' ? sf : { sf, bw: 125 };
    const T_packet   = lora_time_on_air_ms(mod, payl_len);  // time on air [ms]

    const E_TX = T_packet * HW.supply_voltage * getTxCurrentMa(tx_power, product) / 1000;
    // RX1 at the TX modulation, RX2 at SF12
    const T_rx = lora_rx_window_ms(mod) + lora_rx_window_ms(LORA_RX2_MOD);
    const E_RX = T_rx * HW.supply_voltage * HW.lora_rx_current_ma / 1000;
    // Radio startup before the TX, at startup current (not TX current)
    const E_SU = HW.lora_startup_time_ms * HW.supply_voltage * HW.lora_startup_current_ma / 1000;

    return ((E_TX + E_RX + E_SU) / HW.supply_voltage) * (nof_msg_per_day / (24 * 3600));
}

// DR-distribution-weighted LoRa current.
// dr_dist: [{dr, pct}, ...] where pct values sum to 100.
// Modulation per DR comes from LORAWAN_DR_TABLE for the configured region.
// DRs not defined in the region are ignored and the remaining weights are
// renormalised, so every uplink is still counted.
function calculate_lora_current_dr_weighted(tx_power, payl_len, nof_msg_per_day, dr_dist, region, product) {
    const drMap = LORAWAN_DR_TABLE[region] ?? LORAWAN_DR_TABLE.EU868;
    const valid = dr_dist.filter(({ dr, pct }) => drMap[dr] && pct > 0);
    const sum   = valid.reduce((s, { pct }) => s + pct, 0);
    if (sum <= 0) return 0;
    let current = 0;
    for (const { dr, pct } of valid) {
        current += (pct / sum) * calculate_lora_current(drMap[dr], tx_power, payl_len, nof_msg_per_day, product);
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

    // TX1 DR choice depends on device state (lorawan_s1_tx_strategy):
    //   static : ADR distribution when ADR is on, else byte 1 mask  → input.dr_distribution
    //   motion : byte 1 mask (ADR ignored in motion)                 → input.lora_tx1_motion_dr_distribution
    // Without a motion distribution, TX1 uses input.dr_distribution in both states.
    const dr_dist_motion = input.lora_tx1_motion_dr_distribution?.length > 0
        ? input.lora_tx1_motion_dr_distribution : dr_dist;
    const lora_motion_frac = input.lora_motion_frac ?? 0;
    const loraCalcWith = dist => (payl_len, nof_msg) => dist
        ? calculate_lora_current_dr_weighted(input.tx_power, payl_len, nof_msg, dist, region, product)
        : calculate_lora_current(input.sf ?? 10, input.tx_power, payl_len, nof_msg, product);
    const loraCalcStatic = loraCalcWith(dr_dist);
    const loraCalcMotion = loraCalcWith(dr_dist_motion);
    // Helper: TX1 LoRa current for messages spread over static and motion time
    const loraCalc = (payl_len, nof_msg) =>
        (1 - lora_motion_frac) * loraCalcStatic(payl_len, nof_msg) +
        lora_motion_frac       * loraCalcMotion(payl_len, nof_msg);

    // TX2: fraction of uplinks duplicated, using TX2 DR distribution (falls back to TX1 if absent)
    const tx2_factor  = input.lora_tx2_factor ?? 0;
    const tx2_dr_dist = input.lora_tx2_dr_distribution?.length > 0 ? input.lora_tx2_dr_distribution : dr_dist;
    const loraCalcTx2 = tx2_factor > 0
        ? (payl_len, nof_msg) => (tx2_dr_dist
            ? calculate_lora_current_dr_weighted(input.tx_power, payl_len, nof_msg * tx2_factor, tx2_dr_dist, region, product)
            : calculate_lora_current(input.sf ?? 10, input.tx_power, payl_len, nof_msg * tx2_factor, product))
        : () => 0;

    // Print formulas to console once per calculation
    const fmtDist = dist => dist.map(({dr, pct}) => `${loraDrLabel(dr, region)} ${pct.toFixed(1)}%`).join(', ');
    const drSfStr = !dr_dist ? `SF${input.sf ?? 10} (single)`
        : dr_dist_motion !== dr_dist && fmtDist(dr_dist_motion) !== fmtDist(dr_dist)
            ? `Static: ${fmtDist(dr_dist)}  |  Motion: ${fmtDist(dr_dist_motion)}`
            : fmtDist(dr_dist);
    const tx2DrStr = tx2_dr_dist
        ? fmtDist(tx2_dr_dist)
        : 'same as TX1';
    console.log(
`[LoRa consumption formula]
  Region : ${region}   TX power : ${input.tx_power} dBm   Product : ${product}
  TX1 DR/SF : ${drSfStr}
  TX2 DR/SF : ${tx2DrStr}   TX2 factor : ${(tx2_factor * 100).toFixed(0)}% of uplinks

  Time-on-air (LoRa spec, explicit header, CRC on, CR 4/5, BW 125 kHz unless DR uses 250/500 kHz):
    T_sym [ms]   = 2^SF / BW_kHz
    T_preamble   = 12.25 × T_sym          (8 preamble symbols + 4.25 header symbols)
    DE           = 1 if T_sym ≥ 16 ms else 0   (low-data-rate optimisation)
    PL           = payload_bytes + 13     (LoRaWAN overhead: MHDR+FHDR+FPort+MIC)
    n_payload    = 8 + max(⌈(8×PL − 4×SF + 44) / (4×(SF − 2×DE))⌉ × 5, 0)
    T_packet     = T_preamble + n_payload × T_sym
    FSK DR       : T_packet = (5 + 3 + 1 + PL + 2) bytes × 8 / kbps

  Energy per uplink [mJ]:
    E_TX  = T_packet [ms] × V [V] × I_TX(dBm, product) [mA]  / 1000   (I_TX includes MCU)
    E_RX  = (T_win(RX1) + T_win(RX2)) × ${HW.lora_rx_current_ma} mA × V [V]  / 1000
            RX1 at the TX SF/BW, RX2 at SF12/125 kHz (${lora_rx_window_ms(LORA_RX2_MOD).toFixed(1)} ms)
            T_win = max(${HW.lora_rx_min_symbols}, ⌈((2×${HW.lora_rx_min_symbols} − 8)×T_sym + 2×${HW.lora_rx_error_ms} ms) / T_sym⌉) × T_sym
    E_SU  = ${HW.lora_startup_time_ms} ms × ${HW.lora_startup_current_ma} mA × V [V]  / 1000   (radio startup before each TX)

  Average current [mA] = (E_TX + E_RX + E_SU) / V × N_msg/day / 86400`);

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
    // Bytes per beacon (ID + RSSI) come from ble_scanX_report_type (id_bytes); 8 B when not given
    const ble1_payl = input.ble.ble1
        ? BLE_MIN_PAYL_LEN + input.ble.ble1.nof_beaconid * (input.ble.ble1.id_bytes ?? BLE_ADDITIONAL_BSSID_PAYL_LEN)
        : BLE_MIN_PAYL_LEN + input.ble.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN;
    const ble1_nof = input.ble.ble1 ? input.ble.ble1.nof_msg_per_day : input.ble.nof_msg_per_day;
    const ble1_lora = (loraCalc(ble1_payl, ble1_nof) + loraCalcTx2(ble1_payl, ble1_nof)) * lora_factor;

    const ble2_lora = input.ble.ble2
        ? (() => {
            const p = BLE_MIN_PAYL_LEN + input.ble.ble2.nof_beaconid * (input.ble.ble2.id_bytes ?? BLE_ADDITIONAL_BSSID_PAYL_LEN);
            const n = input.ble.ble2.nof_msg_per_day;
            return (loraCalc(p, n) + loraCalcTx2(p, n)) * lora_factor;
          })()
        : 0;
    const ble_lora_current = ble1_lora + ble2_lora;

    // Position uplinks — one combined uplink per geoloc trigger (design.txt rule).
    // When the page passes the geoloc scenarios (profile mode), each scenario is charged once
    // per trigger at its combined payload length, e.g. "BLE Scan 1(failure) + WiFi(success)",
    // and the per-techno uplinks above are NOT charged. TX1 DR and TX2 follow the state the
    // trigger fired in: motion (in-motion periodic, motion start) or static (static periodic,
    // motion end). Manual mode (no scenarios) keeps the per-techno uplinks.
    //   input.position_uplinks = { scenarios: [{ label, payl_len, motion_per_day, static_per_day }],
    //                              tx2_factor_static, tx2_factor_motion }
    const pos_in        = input.position_uplinks;
    const pos_scenarios = Array.isArray(pos_in?.scenarios) ? pos_in.scenarios : null;
    const tx2CalcWith   = factor => factor > 0
        ? (pl, n) => (tx2_dr_dist
            ? calculate_lora_current_dr_weighted(input.tx_power, pl, n * factor, tx2_dr_dist, region, product)
            : calculate_lora_current(input.sf ?? 10, input.tx_power, pl, n * factor, product))
        : () => 0;
    const posTx2Static = tx2CalcWith(pos_in?.tx2_factor_static ?? 0);
    const posTx2Motion = tx2CalcWith(pos_in?.tx2_factor_motion ?? 0);
    const position_lora_current = pos_scenarios
        ? pos_scenarios.reduce((sum, sc) => {
            const pl = sc.payl_len, nM = sc.motion_per_day || 0, nS = sc.static_per_day || 0;
            return sum + (loraCalcMotion(pl, nM) + posTx2Motion(pl, nM)
                        + loraCalcStatic(pl, nS) + posTx2Static(pl, nS)) * lora_factor;
          }, 0)
        : gps_lora_current + lpgps_lora_current + agps_lora_current + wifi_lora_current + ble_lora_current;

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

    // System
    const cpu_idle_current   = calculate_cpu_idle_current(input.cpu_idle_ua);
    const monitoring_current = calculate_monitoring_current(
        input.monitoring.period_s, input.monitoring.current_ma, input.monitoring.window_ms
    );

    // Total scheduled uplinks per day for cellular (excludes heartbeat, which is LoRa-only)
    const ble_msgs_per_day = input.ble.ble1
        ? (input.ble.ble1.nof_msg_per_day || 0) + (input.ble.ble2?.nof_msg_per_day || 0)
        : (input.ble.nof_msg_per_day || 0);
    const total_uplinks_per_day =
        (input.custom_msg.nof_msg_per_day || 0) +
        (input.status_msg.nof_msg_per_day || 0) +
        (input.gps.nof_msg_per_day        || 0) +
        (input.lpgps?.nof_msg_per_day     || 0) +
        (input.agps.nof_msg_per_day       || 0) +
        (input.wifi.nof_msg_per_day       || 0) +
        ble_msgs_per_day;

    // Cellular — when the page provides the LTE uplink count (status + probes + motion
    // notifications + position uplinks, already scaled by cellular usage), use it so the
    // energy matches the LTE uplinks table. Otherwise cellular_factor scales the message sum.
    const cellular_uplinks_per_day = input.cellular.uplinks_per_day !== undefined
        ? input.cellular.uplinks_per_day
        : total_uplinks_per_day * cellular_factor;
    const cellular_current = calculate_cellular_current(
        input.cellular.coverage_pct,
        cellular_uplinks_per_day
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

    // Motion notifications — mode-specific, for TX1 DR and TX2 factor alike:
    // start → motion (byte 1 DR, dM), end → static (ADR/byte 1 DR, dS)
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
        (loraCalcMotion(MOTION_START_PAYL_LEN, motStartNof) + loraCalcTx2Start(MOTION_START_PAYL_LEN, motStartNof)) * lora_factor;
    const motion_end_lora_current =
        (loraCalcStatic(MOTION_END_PAYL_LEN, motEndNof) + loraCalcTx2End(MOTION_END_PAYL_LEN, motEndNof)) * lora_factor;

    // Group totals
    // Geolocation: HW scan/fix current only. LoRa TX for all message types lives in lora_total.
    const cpu_total      = cpu_idle_current + monitoring_current + fix_current;
    const geoloc_total   = gps_geoloc_current + lpgps_geoloc_current + agps_geoloc_current + wifi_geoloc_current + ble_geoloc_current;
    const cellular_total = cellular_current;
    const lora_total     = custom_msg_lora_current + heartbeat_lora_current + status_lora_current
                         + position_lora_current
                         + lora_probe_current
                         + motion_start_lora_current + motion_end_lora_current;
    const beacon_total   = recovery_beacon_current;
    // BLE radio usage (advertising / connection / scan) — no LoRa TX, own group
    const ble_total      = custom_ble_usage_current;

    const total_current = cpu_total + geoloc_total + cellular_total + lora_total + beacon_total + ble_total;

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
        lora_position:        position_lora_current,   // combined geoloc uplinks (or per-techno in manual mode)
        lora_custom_msg:      custom_msg_lora_current,
        ble_custom:           custom_ble_usage_current,
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
        ble:             ble_total,
    };

    return {
        tool_version: TOOL_VERSION,
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
        TOOL_VERSION,
        calculate_battery_life_time,
        calculate_lora_current,
        calculate_lora_current_dr_weighted,
        calculate_cellular_current,
        applyHardwareMeasurements,
        configKeyToName,
        CONFIG_PARAM_ID_TO_NAME,
        DEFAULT_DEVICE_CONFIG_TEXT,
        LORAWAN_DR_TABLE,
        loraDrLabel,
        lora_time_on_air_ms,
        lora_rx_window_ms,
        bleIdBytes,
        LORA_TX_CURRENT_MA,
        CELLULAR_ENERGY_PER_UPLINK_MAH,
        LORA_PROBE_ENERGY_MAH,
        HW,
    };
}
