const WebSocket = require("ws");
const ws = new WebSocket("ws://localhost:9300/ws?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiYWRtaW4iLCJ1c2VybmFtZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIiwiaWF0IjoxNzgxNzA4OTEzLCJleHAiOjE3ODE3OTUzMTN9.Ly98GfVcPFNBVQAA1-KMsg9KrKOb3jDGtS2hEg6llCE");
let done = false;
ws.on("open", () => { console.log("OPEN"); if (!done) { done = true; check(); } });
ws.on("message", (d) => {
    console.log("MSG:", JSON.parse(d.toString()).type);
    ws.close();
});
ws.on("close", () => { console.log("CLOSED"); process.exit(0); });
ws.on("error", (e) => console.error("ERROR:", e.message));
function check() { setTimeout(() => { if (!done) console.log("NO MSG YET"); }, 2000); }
setTimeout(() => process.exit(1), 5000);
