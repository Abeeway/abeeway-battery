/*********************************************************************/
/***** BATTERY LIFE CALCULATION SCRIPTS                          *****/
/*********************************************************************/


/* GLOBAL CONSTANTS */

const SPREADING_FACTORS = [7, 8, 9, 10, 11, 12]

const BATTERY_TYPES = {
    primary:      {
        descr: 'Primary (LTC)',
        leakage_per_month: 0.003,            // =0.3%
        practical_capacity_multiplier: 0.80  // =80%
    },
    rechargeable: {
        descr: 'Rechargeable (Li-Po)',
        leakage_per_month: 0.05,             // =5%
        practical_capacity_multiplier: 0.90  // =90%
    },
};

const PRODUCTS = {
    industrial: {
        descr: 'Industrial Tracker',
        battery: {
            nominal_capacity: 19000,
            practical_capacity: 19000 * BATTERY_TYPES.primary.practical_capacity_multiplier,
            leakage_per_month: BATTERY_TYPES.primary.leakage_per_month,
        }
    },
    compact: {
        descr: 'Compact Tracker',
        battery: {
            nominal_capacity: 8000,
            practical_capacity: 8000 * BATTERY_TYPES.primary.practical_capacity_multiplier,
            leakage_per_month: BATTERY_TYPES.primary.leakage_per_month,
        }
    },
    micro: {
        descr: 'Microtracker',
        battery: {
            nominal_capacity: 450,
            practical_capacity: 450 * BATTERY_TYPES.rechargeable.practical_capacity_multiplier,
            leakage_per_month: BATTERY_TYPES.rechargeable.leakage_per_month,
        }
    },
    smart_badge: {
        descr: 'Smart Badge',
        battery: {
            nominal_capacity: 1300,
            practical_capacity: 1300 * BATTERY_TYPES.rechargeable.practical_capacity_multiplier,
            leakage_per_month: BATTERY_TYPES.rechargeable.leakage_per_month,
        }
    },
    combo_tracker: {
        descr: 'Combo Tracker',
        cellular: true,                                                               // LTE-M/NB-IoT capable
        battery: {
            nominal_capacity: 5000,
            practical_capacity: 5000 * BATTERY_TYPES.primary.practical_capacity_multiplier,
            leakage_per_month: BATTERY_TYPES.primary.leakage_per_month,
        }
    },
}

const BLE_OPERATIONS = {
    fast_adv:  { descr: 'Fast advertisement (2s)',  time: 2,  current: 10  },   // [s], [mA]
    slow_adv:  { descr: 'Slow advertisement (10s)', time: 10, current: 3.5 },
    connected: { descr: 'Connected (2s)',           time: 2,  current: 3.6 },
    fast_scan: { descr: 'Fast BLE scan (8sec)',     time: 8,  current: 2   },
    slow_scan: { descr: 'Slow BLE scan (30sec)',    time: 30, current: 0.5 },
};

const TX_POWERS = {
    _14dBm_: { descr: '14 dBm', current: 45 },      // SX1262 TX [mA]
    _17dBm_: { descr: '17 dBm', current: 75 },
    _19dBm_: { descr: '19 dBm', current: 85 },
}

const CELLULAR_TECHS = {
    ltem:  { descr: 'LTE-M',  tx_current: 200, rx_current: 7,   idle_current: 3   },  // [mA]
    nbiot: { descr: 'NB-IoT', tx_current: 220, rx_current: 5,   idle_current: 2.5 },  // [mA]
};

const SUPPLY_VOLTAGE        = 3.6;     // [V]
const MCU_CURRENT           = 0.3;     // MCU active mode [mA]
const RX_CURRENT            = 10;      // SX1262 RX [mA]
const GPS_CURRENT           = 22;      // GPS active [mA]
const GPS_STANDBY_CURRENT   = 0.05;    // GPS standby [mA]
const WIFI_CURRENT          = 60;      // WiFi scan [mA]
const WIFI_ON_TIME          = 3;       // WiFi on time [s]
const BLE_CURRENT           = 10;      // BLE scan [mA]
const BLE_ON_TIME           = 3;       // BLE on time [s]

const ACCELEROMETER_CURRENT = 0.0065;  // [mA] (=6.5 uA)
const QUIESENT_CURRENT      = 0.0010;  // [mA] (=1 uA)

const HEARTBEAT_PAYL_LEN             = 12;   // [bytes]
const GPS_PAYL_LEN                   = 16;
const AGPS_MIN_PAYL_LEN              = 6;
const AGPS_ADDITIONAL_SAT_PAYL_LEN  = 5;
const WIFI_MIN_PAYL_LEN              = 6;
const WIFI_ADDITIONAL_BSSID_PAYL_LEN = 7;
const BLE_MIN_PAYL_LEN               = 6;
const BLE_ADDITIONAL_BSSID_PAYL_LEN  = 7;
const RECOVERY_BEACON_PAYL_LEN       = 4;   // minimal ID-only payload [bytes]

const SCANCOLL_MIN_PAYL_LEN                 = 8;
const SCANCOLL_ADDITIONAL_MACADDR_PAYL_LEN  = 7;
const SCANCOLL_ADDITIONAL_BEACONID_PAYL_LEN = 4;


/* CALCULATION FUNCTIONS */

function calculate_lora_current(sf, tx_power, payl_len, nof_msg_per_day) {

    const SYMBOL_TIME = (2**sf)/125;
    const PREAMBLE_TIME = 12.25 * SYMBOL_TIME;

    let time_on_air;
    if (sf >= 11) {
        time_on_air = SYMBOL_TIME*(8+Math.ceil(((payl_len+12)*8-4*(sf-7)+16)/(4*sf-8))*5);
    } else {
        time_on_air = SYMBOL_TIME*(8+Math.ceil(((payl_len+12)*8-4*(sf-7)+16)/(4*sf-0))*5);
    }
    const total_time_on_air = time_on_air + PREAMBLE_TIME;

    const tx_energy  = total_time_on_air * SUPPLY_VOLTAGE * TX_POWERS[tx_power].current / 1000;
    const rx_energy  = 2 * 8*SYMBOL_TIME * SUPPLY_VOLTAGE * RX_CURRENT / 1000;
    const mcu_energy = (total_time_on_air + 2000) * SUPPLY_VOLTAGE * MCU_CURRENT / 1000;
    const total_energy_per_transmission = tx_energy + rx_energy + mcu_energy;

    const average_current = (total_energy_per_transmission / SUPPLY_VOLTAGE) * (nof_msg_per_day / (24*3600));
    return average_current;
}

function calculate_gps_current(gps_ttff, gps_conv_time, nof_msg_per_day) {

    const gps_usage_time_of_cold_start = Math.min(gps_ttff + gps_conv_time, 300);

    const average_current_with_cold_starts_only =
        gps_usage_time_of_cold_start * GPS_CURRENT * nof_msg_per_day / (24*3600);

    const average_current_with_hot_starts = (
        gps_usage_time_of_cold_start * GPS_CURRENT +
        (nof_msg_per_day - 1) * gps_conv_time * GPS_CURRENT +
        (24 * 3600 - gps_conv_time * nof_msg_per_day) * GPS_STANDBY_CURRENT
    ) / (24 * 3600);

    return Math.min(average_current_with_cold_starts_only, average_current_with_hot_starts);
}

function calculate_agps_current(agps_on_time, nof_msg_per_day) {
    return agps_on_time * GPS_CURRENT * nof_msg_per_day / (24*3600);
}

function calculate_wifi_current(nof_msg_per_day) {
    return WIFI_ON_TIME * WIFI_CURRENT * nof_msg_per_day / (24*3600);
}

function calculate_ble_current(nof_msg_per_day) {
    return BLE_ON_TIME * BLE_CURRENT * nof_msg_per_day / (24*3600);
}

function calculate_scancollection_current(nof_msg_per_day, tech) {
    if (tech === 'WiFi') return calculate_wifi_current(nof_msg_per_day);
    if (tech === 'BLE')  return calculate_ble_current(nof_msg_per_day);
    return 0;
}

function calculate_custom_ble_usage_current(operation, usage_time_per_day) {
    return BLE_OPERATIONS[operation].current * usage_time_per_day / 24;
}

function calculate_accelerometer_current(accelerometer_on) {
    return accelerometer_on ? ACCELEROMETER_CURRENT : 0;
}

function calculate_battery_leakage_current(product) {
    const battery_capacity     = PRODUCTS[product].battery.nominal_capacity;
    const battery_leakage_per_month = PRODUCTS[product].battery.leakage_per_month;
    return (battery_capacity / 2) * (battery_leakage_per_month / (30*24));
}

/**
 * Cellular communication current.
 * Each session = connection overhead (tx_current for CELLULAR_CONNECT_TIME)
 *              + active data exchange (rx_current for session_duration seconds)
 */
function calculate_cellular_current(tech, sessions_per_day, session_duration_s) {
    if (!tech || sessions_per_day <= 0) return 0;
    const ct = CELLULAR_TECHS[tech];
    const CONNECT_TIME_S = 1.0;   // connection establishment overhead [s]
    const energy_per_session = (
        CONNECT_TIME_S    * ct.tx_current * SUPPLY_VOLTAGE / 1000 +   // [mJ]
        session_duration_s * ct.rx_current * SUPPLY_VOLTAGE / 1000     // [mJ]
    );
    return (energy_per_session / SUPPLY_VOLTAGE) * (sessions_per_day / (24*3600));
}

/**
 * Recovery beacon current: periodic LoRa transmission at configurable SF/power.
 * beacon_interval_min = 0 means disabled.
 */
function calculate_recovery_beacon_current(beacon_interval_min, sf, tx_power) {
    if (beacon_interval_min <= 0) return 0;
    const nof_msg_per_day = (24 * 60) / beacon_interval_min;
    return calculate_lora_current(sf, tx_power, RECOVERY_BEACON_PAYL_LEN, nof_msg_per_day);
}


/* MAIN ENTRY POINT */

function calculate_battery_life_time(input) {

    // --- LoRa currents ---
    const custom_msg_lora_current = input.nof_msg_repetition *
        calculate_lora_current(input.sf, input.tx_power, input.custom_msg.payl_len, input.custom_msg.nof_msg_per_day);

    const heartbeat_lora_current = input.nof_msg_repetition *
        calculate_lora_current(input.sf, input.tx_power, HEARTBEAT_PAYL_LEN, input.heartbeat.nof_msg_per_day);

    const gps_lora_current = input.nof_msg_repetition *
        calculate_lora_current(input.sf, input.tx_power, GPS_PAYL_LEN, input.gps.nof_msg_per_day);

    const agps_lora_current = input.nof_msg_repetition * calculate_lora_current(
        input.sf, input.tx_power,
        AGPS_MIN_PAYL_LEN + (input.agps.nof_satellites * AGPS_ADDITIONAL_SAT_PAYL_LEN),
        input.agps.nof_msg_per_day
    );

    const wifi_lora_current = input.nof_msg_repetition * calculate_lora_current(
        input.sf, input.tx_power,
        WIFI_MIN_PAYL_LEN + (input.wifi.nof_bssid * WIFI_ADDITIONAL_BSSID_PAYL_LEN),
        input.wifi.nof_msg_per_day
    );

    const ble_lora_current = input.nof_msg_repetition * calculate_lora_current(
        input.sf, input.tx_power,
        BLE_MIN_PAYL_LEN + (input.ble.nof_beaconid * BLE_ADDITIONAL_BSSID_PAYL_LEN),
        input.ble.nof_msg_per_day
    );

    // scan collection (fragmented)
    let scancoll_additional_payl_len = (input.scan_collection.tech === 'BLE' && input.scan_collection.idtype === 'ID')
        ? SCANCOLL_ADDITIONAL_BEACONID_PAYL_LEN
        : SCANCOLL_ADDITIONAL_MACADDR_PAYL_LEN;

    const nof_id_in_full_msg  = Math.floor((input.scan_collection.max_payl_len - SCANCOLL_MIN_PAYL_LEN) / scancoll_additional_payl_len);
    const nof_id_last_msg     = input.scan_collection.nof_id % nof_id_in_full_msg;
    const nof_full_fragments  = Math.floor(input.scan_collection.nof_id / nof_id_in_full_msg);

    let scan_collection_lora_current = input.nof_msg_repetition * (
        calculate_lora_current(
            input.sf, input.tx_power,
            SCANCOLL_MIN_PAYL_LEN + nof_id_in_full_msg * scancoll_additional_payl_len,
            nof_full_fragments * input.scan_collection.nof_msg_per_day
        ) +
        calculate_lora_current(
            input.sf, input.tx_power,
            SCANCOLL_MIN_PAYL_LEN + nof_id_last_msg * scancoll_additional_payl_len,
            input.scan_collection.nof_msg_per_day
        )
    );

    // --- Geolocation hardware currents ---
    const gps_geoloc_current  = calculate_gps_current(input.gps.ttff, input.gps.conv_time, input.gps.nof_msg_per_day);
    const agps_geoloc_current = calculate_agps_current(input.agps.on_time, input.agps.nof_msg_per_day);
    const wifi_geoloc_current = calculate_wifi_current(input.wifi.nof_msg_per_day);
    const ble_geoloc_current  = calculate_ble_current(input.ble.nof_msg_per_day);

    // --- BLE custom usage ---
    const custom_ble_usage_current = calculate_custom_ble_usage_current(
        input.custom_ble.operation, input.custom_ble.usage_time_per_day
    );
    const scan_collection_current = calculate_scancollection_current(
        input.scan_collection.nof_msg_per_day, input.scan_collection.tech
    );

    // --- CPU / system ---
    const accelerometer_current = calculate_accelerometer_current(input.accelerometer_on);

    // --- Cellular ---
    const cellular_current = calculate_cellular_current(
        input.cellular.tech,
        input.cellular.sessions_per_day,
        input.cellular.session_duration_s
    );

    // --- Recovery beacon ---
    const recovery_beacon_current = calculate_recovery_beacon_current(
        input.recovery_beacon.interval_min,
        input.recovery_beacon.sf,
        input.recovery_beacon.tx_power
    );

    // --- Battery leakage ---
    const battery_leakage_current = calculate_battery_leakage_current(input.product);
    const fix_current = QUIESENT_CURRENT + battery_leakage_current;

    // --- Grouped totals ---
    const cpu_total       = accelerometer_current + fix_current;
    const geoloc_total    = gps_geoloc_current + agps_geoloc_current + wifi_geoloc_current + ble_geoloc_current +
                            gps_lora_current + agps_lora_current + wifi_lora_current + ble_lora_current;
    const cellular_total  = cellular_current;
    const lora_total      = custom_msg_lora_current + heartbeat_lora_current +
                            scan_collection_lora_current + custom_ble_usage_current + scan_collection_current +
                            ble_lora_current;   // non-geoloc LoRa
    const beacon_total    = recovery_beacon_current;

    const total_current = cpu_total + geoloc_total + cellular_total + lora_total + beacon_total;

    const battery_life_days = Math.round(
        10 * (PRODUCTS[input.product].battery.practical_capacity / total_current) / 24
    ) / 10;

    // --- Per-component mA (for charts) ---
    const components = {
        cpu_quiescent:        fix_current,
        cpu_accelerometer:    accelerometer_current,
        geoloc_gps:           gps_geoloc_current + gps_lora_current,
        geoloc_agps:          agps_geoloc_current + agps_lora_current,
        geoloc_wifi:          wifi_geoloc_current + wifi_lora_current,
        geoloc_ble:           ble_geoloc_current  + ble_lora_current,
        cellular:             cellular_current,
        lora_heartbeat:       heartbeat_lora_current,
        lora_custom_msg:      custom_msg_lora_current,
        lora_scan_collection: scan_collection_lora_current + scan_collection_current,
        lora_custom_ble:      custom_ble_usage_current,
        recovery_beacon:      recovery_beacon_current,
    };

    // percentage distribution
    const distribution = {};
    for (const [k, v] of Object.entries(components)) {
        distribution[k] = Math.round(1000 * v / total_current) / 10;
    }

    // group totals in mA
    const group_currents_ma = {
        cpu:             cpu_total,
        geolocation:     geoloc_total,
        cellular:        cellular_total,
        lora:            lora_total,
        recovery_beacon: beacon_total,
    };

    return {
        battery_life_days,
        total_current_ma: total_current,
        components_ma: components,
        distribution_pct: distribution,
        group_currents_ma,
        battery: {
            nominal_capacity:    PRODUCTS[input.product].battery.nominal_capacity,
            practical_capacity:  PRODUCTS[input.product].battery.practical_capacity,
        }
    };
}

if (typeof module !== 'undefined') {
    module.exports = { calculate_battery_life_time };
}
