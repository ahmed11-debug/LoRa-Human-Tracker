
const fs = require("node:fs");
const path = require("node:path");

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// Location of the private key outside our React project
const keyPath = path.resolve(
  __dirname,
  "../../LoRaGatewaySecrets/serviceAccountKey.json"
);

// Check whether the key exists
if (!fs.existsSync(keyPath)) {
  console.error("Firebase key file not found.");
  console.error("Check your LoRaGatewaySecrets folder.");
  process.exit(1);
}

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  fs.readFileSync(keyPath, "utf8")
);

initializeApp({
  credential: cert(serviceAccount)
});

// Connect to Firestore
const db = getFirestore();

// Export connection for our future gateway
module.exports = { db };

// Test connection only when running this file directly
if (require.main === module) {
  async function testConnection() {
    try {
      console.log("Connecting to Firebase...");

      const snapshot = await db
        .collection("radarreadings")
        .doc("reading001")
        .get();

      console.log("Firebase connection successful!");

      if (snapshot.exists) {
        console.log("Target ID:", snapshot.get("targetId"));
        console.log("X Position:", snapshot.get("x"));
        console.log("Y Position:", snapshot.get("y"));
        console.log("Speed:", snapshot.get("speed"));
      } else {
        console.log("Connected, but reading001 was not found.");
      }

    } catch (error) {
      console.error("Firebase error:", error.message);
      process.exitCode = 1;
    } finally {
      await db.terminate();
    }
  }

  testConnection();
}
