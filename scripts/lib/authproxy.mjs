// Stands in for Traefik + tinyauth in tests: every request to the admin --
// page, service-worker script, fetches made by the worker -- arrives with the
// identity header the real edge injects. Also the switch for simulating a
// server that is down (502) or unreachable (connection dropped).
import http from "node:http";

export function startAuthProxy({ port, target, email }) {
  const state = { failPattern: null, down: false };
  const server = http.createServer((req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    if (state.failPattern && state.failPattern.test(req.url)) { res.writeHead(502, { "content-type": "text/plain" }); res.end("simulated outage"); return; }
    const headers = { ...req.headers, "remote-email": email, host: `127.0.0.1:${target}` };
    const up = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers }, (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  server.keepAliveTimeout = 1000;
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) })));
}
