
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const { saveRadarReading } = require("./saveRadarReading");

// ================= CONFIGURATION =================

const PORT = process.argv[2] || "COM4";
const BAUD_RATE = 115200;
const DEVICE_ID = "RADAR-01";

const SAVE_INTERVAL_MS = 250;
const TARGET_FINALIZE_DELAY_MS = 120;

// ================= STATE =================

let currentTarget = null;
let finalizeTimer = null;

const uploadStates = new Map();

// ================= SERIAL PORT =================

const port = new SerialPort({
    path: PORT,
    baudRate: BAUD_RATE
});

const parser = port.pipe(
    new ReadlineParser({ delimiter: "\n" })
);

// ================= HELPERS =================

function normalizeTargetId(id) {
    const value = String(id).trim().toUpperCase();
    return value.startsWith("T") ? value : `T${value}`;
}

function hasRequiredData(target) {
    return (
        target &&
        Number.isFinite(target.x) &&
        Number.isFinite(target.y) &&
        Number.isFinite(target.speed)
    );
}

// ================= FIREBASE UPLOAD QUEUE =================

// Keep only the newest pending measurement for each target.
// This prevents old positions from building up in a queue.

function queueTarget(target) {
    if (!hasRequiredData(target)) return;

    const documentId = `${target.deviceId}_${target.targetId}`;

    let state = uploadStates.get(documentId);

    if (!state) {
        state = {
            latest: null,
            timer: null,
            inFlight: false,
            lastUploadedAt: 0,
            retryAfter: 0
        };

        uploadStates.set(documentId, state);
    }

    // Replace any older pending position.
    state.latest = { ...target };

    scheduleUpload(documentId, state);
}

function scheduleUpload(documentId, state) {
    if (state.timer || state.inFlight || !state.latest) {
        return;
    }

    const intervalWait = Math.max(
        0,
        SAVE_INTERVAL_MS - (Date.now() - state.lastUploadedAt)
    );

    const retryWait = Math.max(
        0,
        state.retryAfter - Date.now()
    );

    const delay = Math.max(intervalWait, retryWait);

    state.timer = setTimeout(() => {
        flushUpload(documentId, state);
    }, delay);
}

async function flushUpload(documentId, state) {
    state.timer = null;

    if (state.inFlight || !state.latest) {
        return;
    }

    const reading = state.latest;

    state.latest = null;
    state.inFlight = true;

    try {
        await saveRadarReading(reading);

        state.lastUploadedAt = Date.now();
        state.retryAfter = 0;

        console.log(
            `[FIREBASE] Updated ${documentId}: X=${reading.x}, Y=${reading.y}, Speed=${reading.speed}`
        );

    } catch (error) {
        // Retry the failed reading unless a newer reading arrived.
        if (!state.latest) {
            state.latest = reading;
        }

        state.retryAfter = Date.now() + 1000;

        console.error(
            `[FIREBASE ERROR] ${documentId}:`,
            error.message || error
        );

    } finally {
        state.inFlight = false;

        // If newer data arrived during the upload, send that next.
        if (state.latest) {
            scheduleUpload(documentId, state);
        }
    }
}

// ================= TARGET FINALIZATION =================

function flushCurrentTarget() {
    if (finalizeTimer) {
        clearTimeout(finalizeTimer);
        finalizeTimer = null;
    }

    if (!currentTarget) return;

    const completedTarget = { ...currentTarget };

    currentTarget = null;

    if (hasRequiredData(completedTarget)) {
        console.log(
            `[RADAR] Complete measurement received: ${completedTarget.targetId}`
        );

        queueTarget(completedTarget);
    }
}

function scheduleTargetFinalization() {
    if (finalizeTimer) {
        clearTimeout(finalizeTimer);
    }

    finalizeTimer = setTimeout(() => {
        flushCurrentTarget();
    }, TARGET_FINALIZE_DELAY_MS);
}

// ================= PARSE TARGET FIELDS =================

function updateTargetFields(line) {
    if (!currentTarget) return;

    let changed = false;

    // X coordinate in mm
    const xMatch = line.match(
        /X(?:\s+Position)?\s*:\s*(-?\d+(?:\.\d+)?)/i
    );

    if (xMatch) {
        currentTarget.x = Number(xMatch[1]);
        changed = true;
    }

    // Y coordinate in mm
    const yMatch = line.match(
        /Y(?:\s+Position)?\s*:\s*(-?\d+(?:\.\d+)?)/i
    );

    if (yMatch) {
        currentTarget.y = Number(yMatch[1]);
        changed = true;
    }

    // Speed
    const speedMatch = line.match(
        /Speed\s*:\s*(-?\d+(?:\.\d+)?)\s*(cm\/s|m\/s)?/i
    );

    if (speedMatch) {
        let speed = Number(speedMatch[1]);

        if (
            speedMatch[2] &&
            speedMatch[2].toLowerCase() === "cm/s"
        ) {
            speed = speed / 100;
        }

        currentTarget.speed = speed;
        changed = true;
    }

    // Distance (optional)
    const distanceMatch = line.match(
        /Distance\s*:\s*(-?\d+(?:\.\d+)?)/i
    );

    if (distanceMatch) {
        currentTarget.distance = Number(distanceMatch[1]);
        changed = true;
    }

    // Angle (optional)
    const angleMatch = line.match(
        /Angle\s*:\s*(-?\d+(?:\.\d+)?)/i
    );

    if (angleMatch) {
        currentTarget.angle = Number(angleMatch[1]);
        changed = true;
    }

    if (changed) {
        // Wait briefly for the remaining fields.
        scheduleTargetFinalization();
    }

    // Angle is normally the last field in your radar output.
    if (angleMatch && hasRequiredData(currentTarget)) {
        flushCurrentTarget();
    }
}

// ================= OLD RAW PACKET FORMAT =================

function processRawPacket(line) {
    const rawMatch = line.match(/Raw Packet:\s*(.+)/i);

    if (!rawMatch) return false;

    const targets = rawMatch[1]
        .split(";")
        .map(item => item.trim())
        .filter(Boolean);

    for (const item of targets) {
        const match = item.match(
            /^(T?\d+)\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/i
        );

        if (!match) {
            console.log("[PARSER] Invalid raw target:", item);
            continue;
        }

        const target = {
            deviceId: DEVICE_ID,
            targetId: normalizeTargetId(match[1]),
            x: Number(match[2]),
            y: Number(match[3]),

            // Existing raw packet format uses cm/s.
            speed: Number(match[4]) / 100,

            distance: Number(match[5]),
            angle: Number(match[6])
        };

        queueTarget(target);
    }

    return true;
}

// ================= SERIAL DATA HANDLER =================

function handleSerialData(rawLine) {
    const line = String(rawLine).trim();

    if (!line) return;

    console.log("[SERIAL]", line);

    // Support the older raw packet format.
    if (processRawPacket(line)) {
        return;
    }

    // Multiline format: Target ID: T1
    const targetIdMatch = line.match(
        /Target\s*ID\s*:\s*(T?\d+)/i
    );

    // Older inline format: Target 1 | X: ...
    const inlineTargetMatch = line.match(
        /(?:->\s*)?(?:RADAR\s+)?TARGET\s+(T?\d+)\s*\|/i
    );

    const detectedId = targetIdMatch
        ? targetIdMatch[1]
        : inlineTargetMatch
            ? inlineTargetMatch[1]
            : null;

    if (detectedId) {
        // Finish the previous target before starting another.
        flushCurrentTarget();

        currentTarget = {
            deviceId: DEVICE_ID,
            targetId: normalizeTargetId(detectedId)
        };
    }

    // Collect the fields for the current target.
    updateTargetFields(line);
}

// ================= SERIAL EVENTS =================

port.on("open", () => {
    console.log("\n==================================");
    console.log("       OFLINK RADAR GATEWAY");
    console.log("==================================");

    console.log(`Serial Port: ${PORT}`);
    console.log(`Baud Rate: ${BAUD_RATE}`);
    console.log(`Device ID: ${DEVICE_ID}`);
    console.log(`Upload Interval: ${SAVE_INTERVAL_MS} ms`);

    console.log("----------------------------------");
    console.log("Waiting for live radar measurements...\n");
});

parser.on("data", handleSerialData);

port.on("error", (error) => {
    console.error("[SERIAL ERROR]", error.message);

    if (error.message.includes("Access denied")) {
        console.log(
            "Close Arduino Serial Monitor/Plotter and stop old gateway processes."
        );
    }
});

port.on("close", () => {
    console.log("[SERIAL] Connection closed.");

    if (finalizeTimer) {
        clearTimeout(finalizeTimer);
    }
});

// ================= SAFE EXIT =================

process.on("SIGINT", () => {
    console.log("\nStopping OFLINK gateway...");

    if (finalizeTimer) {
        clearTimeout(finalizeTimer);
    }

    if (port.isOpen) {
        port.close(() => process.exit(0));
    } else {
        process.exit(0);
    }
});
