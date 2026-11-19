
function parseRadarPacket(line) {
  const text = line.trim();

  // Remove receiver's debug prefix, if present
  const payload = text.startsWith("Raw Packet:")
    ? text.slice("Raw Packet:".length).trim()
    : text;

  const targets = [];

  for (const part of payload.split(";")) {
    if (!part.trim()) continue;

    const match = part.trim().match(
      /^([A-Za-z0-9_-]{1,30}):(.+)$/
    );

    if (!match) continue;

    const targetId = match[1];
    const values = match[2].split(",");

    if (values.length !== 5) continue;

    const numbers = values.map((v) =>
      v.trim() === "" ? NaN : Number(v.trim())
    );

    if (!numbers.every(Number.isFinite)) continue;

    const [x, y, speed, distance, angle] = numbers;

    targets.push({
      deviceId: "RADAR-01",
      targetId,
      x,                    // millimeters
      y,                    // millimeters
      speed: speed / 100,   // cm/s to m/s
      distance,             // centimeters
      angle                 // degrees
    });
  }

  return targets;
}

module.exports = { parseRadarPacket };

// Test using the actual packet we received
if (require.main === module) {
  const receivedPacket =
    "T1:-284,3372,0,338.39,-4.81;";

  console.log(
    JSON.stringify(
      parseRadarPacket(receivedPacket),
      null,
      2
    )
  );
}
