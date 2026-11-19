
const { SerialPort } = require("serialport");

async function checkPorts() {
  try {
    const ports = await SerialPort.list();

    console.log("Checking available serial ports...");

    if (ports.length === 0) {
      console.log("No serial devices detected.");
      return;
    }

    ports.forEach((port) => {
      console.log("Port:", port.path);
      console.log("Manufacturer:", port.manufacturer || "Unknown");
      console.log("----------------------");
    });

  } catch (error) {
    console.error("Serial port error:", error.message);
  }
}

checkPorts();
