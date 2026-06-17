const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:9300/ws?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiYWRtaW4iLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzgxNzA4NTEzLCJleHAiOjE3ODE3OTQ5MTN9.88brm2nrbDA5RJitbBFFqXuPpORsx7zN2mU8j5Z8GKY");
let done = false;
ws.on("open", () => console.log("WS OPEN"));
ws.on("message", (d) => {
    if (done) return;
    const m = JSON.parse(d.toString());
    console.log("WS TYPE:", m.type);
    if (m.devices) {
        console.log("WS DEVICES:", m.devices.length);
        m.devices.forEach(x => console.log(" ", x.info.deviceId.slice(0,8), x.status, x.info.appVersion));
    }
    done = true;
    ws.close();
});
ws.on("error", (e) => console.error("WS ERROR:", e.message));
ws.on("close", () => { if(!done) console.log("WS CLOSED (no msg)"); process.exit(done ? 0 : 1); });
setTimeout(() => { if(!done) console.log("WS TIMEOUT"); process.exit(2); }, 6000);
