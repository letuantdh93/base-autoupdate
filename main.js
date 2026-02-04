const { app, BrowserWindow } = require("electron");
const path = require("path");

let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true, // QUAN TRỌNG
      contextIsolation: true,
      // đảm bảo preload chạy với quyền đọc file (mặc dù chúng ta cũng fallback sang IPC)
      sandbox: false,
      devTools: true,
      // pass the userData path into the renderer/preload via argv
      additionalArguments: [`--dirname=${app.getPath("userData")}`],
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

const { ipcMain } = require("electron");
const fs = require("fs");
const http = require("http");

ipcMain.on("save-json", (event, data) => {
  const filePath = path.join(app.getPath("userData"), "result.json");

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

  console.log("✅ Đã lưu result.json ", filePath);

  // Acknowledge to whoever sent it (used by main to coordinate fetch→count→post)
  try {
    event.sender.send("save-json-done", { ok: true });
  } catch (err) {
    console.warn("save-json: failed to send acknowledgement", err);
  }

  // Also emit on ipcMain so main-side waiters can observe completion
  try {
    ipcMain.emit("save-json-done", event, { ok: true });
  } catch (err) {
    console.warn("save-json: failed to emit internal completion", err);
  }
});

// Khi preload không có quyền truy cập `fs`, preload sẽ gọi handler này
ipcMain.handle("read-techs", async () => {
  try {
    const filePath = path.join(app.getPath("userData"), "techs.json");
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("ipcMain: read-techs failed", err);
    return [];
  }
});

// ---------------------------
// Automatic POST of result.json
// ---------------------------
const POST_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const POST_HOST = "171.244.41.10";
const POST_PORT = 22280;
const POST_PATH = "/api/external/update-techs";

function readResultFile() {
  const filePath = path.join(app.getPath("userData"), "result.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("readResultFile: failed to read/parse result.json", err);
    return null;
  }
}

function buildPayloadFromResult(result) {
  // Accepts either array-of-objects [{ name, 'stage-88602': n, ... }] or
  // object map { name: { ... } } — normalize to expected payload
  const arr = Array.isArray(result)
    ? result
    : Object.keys(result || {}).map((k) => ({ name: k, ...result[k] }));

  const payloadTechs = arr.map((item) => {
    const thietke = Number(item["thietke"]) || 0;
    const thicong = Number(item["thicong"]) || 0;
    const nt_xlsc = Number(item["nt_xlsc"]) || 0;
    const score = Number(item.score) || 0;

    return {
      name: item.name || "",
      thietke,
      thicong,
      nt_xlsc,
      score,
    };
  });

  return { techs: payloadTechs };
}

function httpPostJson(host, port, pathUrl, bodyObj, timeout = 10000) {
  const body = JSON.stringify(bodyObj);
  const opts = {
    hostname: host,
    port,
    path: pathUrl,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout,
  };

  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ statusCode: res.statusCode, body: text });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.write(body);
    req.end();
  });
}

async function postResultOnce() {
  const result = readResultFile();
  if (!result) {
    console.warn(
      "postResultOnce: result.json missing or unreadable — skipping POST",
    );
    return { ok: false, reason: "no-result" };
  }

  const payload = buildPayloadFromResult(result);
  console.log("postResultOnce: POSTing payload ->", JSON.stringify(payload));

  try {
    const res = await httpPostJson(POST_HOST, POST_PORT, POST_PATH, payload);
    console.log("postResultOnce: response", res.statusCode, res.body);
    return { ok: true, status: res.statusCode, body: res.body };
  } catch (err) {
    console.error("postResultOnce: POST failed", err);
    return { ok: false, reason: err.message };
  }
}

// Start automatic posting (call after app ready)
function startAutoPost() {
  // Run immediately, then every interval
  postResultOnce().catch((e) =>
    console.error("startAutoPost: initial post failed", e),
  );
  setInterval(() => {
    postResultOnce().catch((e) =>
      console.error("startAutoPost: scheduled post failed", e),
    );
  }, POST_INTERVAL_MS);
  console.log(`Auto-post scheduled every ${POST_INTERVAL_MS / 1000}s`);
}

// --- FETCH techs.json from remote and save locally ---
const FETCH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (same cadence)
const FETCH_HOST = "171.244.41.10";
const FETCH_PORT = 22280;
const FETCH_PATH = "/api/techs";

function httpGetJson(host, port, pathUrl, timeout = 10000) {
  const opts = {
    hostname: host,
    port,
    path: pathUrl,
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    timeout,
  };

  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          const json = JSON.parse(text);
          resolve({ statusCode: res.statusCode, body: json });
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.end();
  });
}

async function fetchTechsOnce() {
  try {
    const res = await httpGetJson(FETCH_HOST, FETCH_PORT, FETCH_PATH);
    if (res.statusCode && res.statusCode >= 400) {
      console.warn("fetchTechsOnce: non-2xx status", res.statusCode);
      return { ok: false, status: res.statusCode };
    }

    // Accept either { techs: [...] } or [...]
    const body = res.body;
    const techs = Array.isArray(body)
      ? body
      : body && Array.isArray(body.techs)
        ? body.techs
        : null;
    if (!Array.isArray(techs)) {
      console.error("fetchTechsOnce: unexpected payload shape", body);
      return { ok: false, reason: "unexpected-payload" };
    }

    const filePath = path.join(app.getPath("userData"), "techs.json");
    fs.writeFileSync(filePath, JSON.stringify(techs, null, 2), "utf8");
    console.log(`✅ Fetched and saved ${techs.length} tech(s) to techs.json`);
    return { ok: true, count: techs.length };
  } catch (err) {
    console.error("fetchTechsOnce: failed", err);
    return { ok: false, reason: err.message };
  }
}

// Wait for renderer to save result.json (ack via 'save-json-done')
function waitForSaveJson(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener("save-json-done", onDone);
      reject(new Error("timeout waiting for save-json-done"));
    }, timeout);

    function onDone(event, info) {
      clearTimeout(timer);
      resolve(info);
    }

    ipcMain.once("save-json-done", onDone);
  });
}

// Full sequence: fetch -> ask renderer to count & save -> wait -> post
async function fetchThenCountThenPost() {
  const fetched = await fetchTechsOnce();
  if (!fetched.ok) return { ok: false, stage: "fetch", detail: fetched };

  if (!mainWindow || !mainWindow.webContents) {
    return { ok: false, reason: "no-main-window" };
  }

  try {
    mainWindow.webContents.send("run-count-now");
    console.log("fetchThenCountThenPost: asked renderer to run count");
  } catch (err) {
    console.error("fetchThenCountThenPost: failed to send run-count-now", err);
    return { ok: false, stage: "notify-renderer", reason: err.message };
  }

  try {
    await waitForSaveJson(20000);
  } catch (err) {
    console.error(
      "fetchThenCountThenPost: waiting for save-json-done failed",
      err,
    );
    return { ok: false, stage: "wait-save", reason: err.message };
  }

  const posted = await postResultOnce();
  return { ok: true, fetch: fetched, post: posted };
}

function startAutoFetch() {
  // run the full sequence immediately, then schedule
  fetchThenCountThenPost().catch((e) =>
    console.error("startAutoFetch: initial run failed", e),
  );
  setInterval(() => {
    fetchThenCountThenPost().catch((e) =>
      console.error("startAutoFetch: scheduled run failed", e),
    );
  }, FETCH_INTERVAL_MS);
  console.log(`Auto-fetch+post scheduled every ${FETCH_INTERVAL_MS / 1000}s`);
}

// Manual trigger from renderer for testing
ipcMain.handle("fetch-techs-now", async () => {
  return await fetchTechsOnce();
});

// Manual fetch + immediate POST (convenience) — uses the full ordered flow
ipcMain.handle("fetch-and-post-now", async () => {
  return await fetchThenCountThenPost();
});

// Manual trigger from renderer for testing
ipcMain.handle("post-result-now", async () => {
  return await postResultOnce();
});

// Ensure auto-fetch (which includes count+post) starts after app ready
app.whenReady().then(() => {
  // don't block startup
  setTimeout(() => {
    startAutoFetch();
    // ensure automatic POSTing of result.json also starts
    startAutoPost();
  }, 2000);
});
