const { calculate_battery_life_time } = require('./abeeway_battery.js');

let input = {

    product: 'smart_badge',            // industrial|compact|micro|smart_badge|combo_tracker
    tx_power: '_14dBm_',               // _14dBm_|_17dBm_|_19dBm_
    sf: 10,                            // 7|8|9|10|11|12
    battery_capacity_mah: 1300,        // practical battery capacity [mAh]
    annual_discharge_pct: 2.4,         // annual self-discharge rate [%] (2.4 = mixed industrial)
    cpu_idle_ua: 8,                    // always-on CPU idle current [µA]

    monitoring: {
        period_s:   300,               // core_monitoring_period [s]
        current_ma: 5,                 // active current during monitoring [mA]
        window_ms:  10,                // active window duration [ms]
    },

    custom_msg: {
        nof_msg_per_day: 5,
        payl_len: 17,                  // [bytes]
    },
    heartbeat: {
        nof_msg_per_day: 24,           // derived from lorawan_heartbeat_period
    },
    status_msg: {
        nof_msg_per_day: 24,           // derived from core_status_period
    },
    gps: {
        nof_msg_per_day: 24,
        ttff: 49,                      // [s]
        conv_time: 90,                 // [s]
    },
    agps: {
        nof_msg_per_day: 0,
        on_time: 8,                    // [s]
        nof_satellites: 5,
    },
    wifi: {
        nof_msg_per_day: 0,
        nof_bssid: 4,
    },
    ble: {
        nof_msg_per_day: 0,
        nof_beaconid: 4,
    },
    custom_ble: {
        usage_time_per_day: 0,
        operation: 'fast_adv',         // fast_adv|slow_adv|connected|fast_scan|slow_scan
    },
    scan_collection: {
        nof_msg_per_day: 0,
        tech: 'BLE',                   // BLE|WiFi
        idtype: 'MAC',                 // MAC|ID
        max_payl_len: 92,              // 36|92
        nof_id: 8,
    },
    cellular: {
        tech: 'ltem',                  // ltem|nbiot|'' (disabled)
        sessions_per_day: 24,
        session_duration_s: 5,         // [s]
    },
    recovery_beacon: {
        interval_min: 0,               // 0 = disabled
        sf: 12,
        tx_power: '_19dBm_',
    },

};

let result = calculate_battery_life_time(input);

let out = `Battery life: ${result.battery_life_days} days (${(result.battery_life_days/365).toFixed(2)} years)\n`;
out += `Total avg current: ${Math.round(result.total_current_ma * 1000)} µA\n`;
out += `\nEnergy distribution:\n`;
for (const [key, pct] of Object.entries(result.distribution_pct)) {
    if (pct > 0) out += `  ${key.padEnd(30)} ${pct} %\n`;
}
out += `\nGroup currents (µA):\n`;
for (const [key, ma] of Object.entries(result.group_currents_ma)) {
    out += `  ${key.padEnd(20)} ${Math.round(ma * 1000)} µA\n`;
}

console.log(out);
