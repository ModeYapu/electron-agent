const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:9300/ws?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiYWRtaW4iLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzgxNzA4NTY3LCJleHAiOjE3ODE3OTQ5Njd9.eHJUHCDxsd4_UglnlTV8UU_VNRMt_Qlt3PRXWWgzqgo");

ws.on("open", () => console.log("OPEN"));

ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    const ts = new Date().toISOString().slice(11,19);
    console.log(`[${ts}] TYPE: ${m.type}`);
    if (m.devices) {
        m.devices.forEach(x => {
            console.log(`  DEV: ${x.info.deviceId.slice(0,8)} ${x.status} v${x.info.appVersion} page="${x.currentPage?.title||"?"}"`);
        });
    }
});

ws.on("close", (code) => { console.log("CLOSED code:", code); process.exit(0); });
ws.on("error", (e) => { console.error("ERROR:", e.message); process.exit(1); });

setTimeout(() => { console.log("--- TIMEOUT, closing ---"); ws.close(); }, 8000);
