
const { db } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

// Save the latest reading for one radar target.
async function saveRadarReading(reading) {
    const {
        deviceId = "RADAR-01",
        targetId,
        x,
        y,
        speed,
        distance,
        angle
    } = reading;

    // Validate identifiers and coordinates.
    if (
        !/^[A-Za-z0-9_-]{1,30}$/.test(deviceId) ||
        !/^[A-Za-z0-9_-]{1,30}$/.test(targetId) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
    ) {
        throw new Error("Invalid radar reading");
    }

    if (
        speed !== undefined &&
        speed !== null &&
        !Number.isFinite(speed)
    ) {
        throw new Error("Invalid speed value");
    }

    if (
        distance !== undefined &&
        distance !== null &&
        !Number.isFinite(distance)
    ) {
        throw new Error("Invalid distance value");
    }

    if (
        angle !== undefined &&
        angle !== null &&
        !Number.isFinite(angle)
    ) {
        throw new Error("Invalid angle value");
    }

    // One document per radar device and target slot.
    const documentId = `${deviceId}_${targetId}`;

    const data = {
        deviceId,
        targetId,
        x,
        y,
        source: "hardware",

        // Updated every time a fresh radar measurement arrives.
        timestamp: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),

        speed: speed ?? null,
        distance: distance ?? null,
        angle: angle ?? null
    };

    await db
        .collection("radarreadings")
        .doc(documentId)
        .set(data, { merge: true });

    console.log("Radar reading saved:", documentId);
}

module.exports = { saveRadarReading };
