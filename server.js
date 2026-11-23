
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const TEMP_DIR = path.join("/tmp", "abdultransfer");
const EXPIRY_MS = 30 * 60 * 1000;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 20;

fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api", limiter);

const transfers = new Map();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    cb(null, crypto.randomBytes(16).toString("hex"));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

function createCode() {
  let code;

  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (transfers.has(code));

  return code;
}

function getTransfer(code) {
  const transfer = transfers.get(String(code));

  if (!transfer) return null;

  if (Date.now() > transfer.expiresAt) {
    deleteTransfer(code);
    return null;
  }

  return transfer;
}

function deleteTransfer(code) {
  const transfer = transfers.get(String(code));
  if (!transfer) return;

  for (const file of transfer.files) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }

  transfers.delete(String(code));
}

app.post("/api/create", (req, res) => {
  const code = createCode();
  const token = crypto.randomBytes(32).toString("hex");

  transfers.set(code, {
    token,
    files: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + EXPIRY_MS
  });

  res.json({
    success: true,
    code,
    token,
    expiresInMinutes: 30
  });
});

app.post("/api/upload/:code", upload.array("files", MAX_FILES), (req, res) => {
  const transfer = getTransfer(req.params.code);

  if (!transfer) {
    for (const file of req.files || []) {
      try { fs.unlinkSync(file.path); } catch {}
    }

    return res.status(404).json({
      error: "Aktarım bulunamadı veya süresi doldu."
    });
  }

  const token = req.headers["x-transfer-token"];

  if (!token || token !== transfer.token) {
    for (const file of req.files || []) {
      try { fs.unlinkSync(file.path); } catch {}
    }

    return res.status(403).json({
      error: "Aktarım yetkisi geçersiz."
    });
  }

  const uploaded = (req.files || []).map(file => {
    const item = {
      id: file.filename,
      name: path.basename(file.originalname).slice(0, 180),
      size: file.size,
      path: file.path
    };

    transfer.files.push(item);

    return {
      id: item.id,
      name: item.name,
      size: item.size
    };
  });

  res.json({
    success: true,
    files: uploaded
  });
});

app.get("/api/files/:code", (req, res) => {
  const transfer = getTransfer(req.params.code);

  if (!transfer) {
    return res.status(404).json({
      error: "Kod bulunamadı veya süresi doldu."
    });
  }

  res.json({
    files: transfer.files.map(file => ({
      id: file.id,
      name: file.name,
      size: file.size
    })),
    expiresAt: transfer.expiresAt
  });
});

app.get("/api/download/:code/:id", (req, res) => {
  const transfer = getTransfer(req.params.code);

  if (!transfer) {
    return res.status(404).send("Aktarım bulunamadı veya süresi doldu.");
  }

  const file = transfer.files.find(item => item.id === req.params.id);

  if (!file || !fs.existsSync(file.path)) {
    return res.status(404).send("Dosya bulunamadı.");
  }

  res.download(file.path, file.name);
});

app.delete("/api/transfer/:code", (req, res) => {
  const transfer = getTransfer(req.params.code);

  if (!transfer) {
    return res.status(404).json({ error: "Aktarım bulunamadı." });
  }

  const token = req.headers["x-transfer-token"];

  if (!token || token !== transfer.token) {
    return res.status(403).json({ error: "Yetkisiz işlem." });
  }

  deleteTransfer(req.params.code);
  res.json({ success: true });
});

setInterval(() => {
  for (const [code, transfer] of transfers.entries()) {
    if (Date.now() > transfer.expiresAt) {
      deleteTransfer(code);
    }
  }
}, 60 * 1000);

app.get("/api/status", (req, res) => {
  res.json({
    name: "AbdulTransfer",
    status: "active"
  });
});

app.listen(PORT, () => {
  console.log(`AbdulTransfer çalışıyor: ${PORT}`);
});
