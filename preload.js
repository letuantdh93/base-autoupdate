// preload.js
const { contextBridge, ipcRenderer } = require("electron");

// Try to require Node built-ins only if available in this preload environment.
const tryRequire = (name) => {
  try {
    return require(name);
  } catch (err) {
    return null;
  }
};

const fs = tryRequire("fs");
const path = tryRequire("path");

// Diagnostic log để xác nhận preload đã chạy (và xem fs/path có sẵn không)
console.log("preload: init — fs?", !!fs, "path?", !!path);

const readTechsViaMain = async () => {
  try {
    return await ipcRenderer.invoke("read-techs");
  } catch (err) {
    console.error("preload: ipc read-techs failed", err);
    return [];
  }
};

contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * Trả về danh sách techs. Luôn trả Promise (điều này an toàn trong cả sandboxed preload).
   */
  loadTechs: async () => {
    if (fs && path) {
      try {
        // Prefer a user-provided base dir passed from main via `--dirname=...`.
        // Fallback to __dirname when not provided.
        const argvDir = ((process && process.argv) || []).find(
          (a) => a && a.indexOf("--dirname=") === 0,
        );
        const baseDir = argvDir ? argvDir.split("=")[1] : __dirname;
        const filePath = path.join(baseDir, "techs.json");
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
      } catch (err) {
        console.warn("preload: fs read failed, falling back to main:", err);
        return await readTechsViaMain();
      }
    }

    // Nếu không có fs (ví dụ: preload bị sandboxed by a bundler), dùng IPC
    console.warn(
      "preload: fs/path not available — falling back to ipcRenderer.invoke('read-techs')",
    );
    return await readTechsViaMain();
  },

  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },

  /**
   * Nhận message từ main.js gửi xuống UI
   */
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, data) => {
      callback(data);
    });
  },

  /**
   * Gọi hàm async ở main.js
   */
  invoke: (channel, data) => {
    return ipcRenderer.invoke(channel, data);
  },
});
