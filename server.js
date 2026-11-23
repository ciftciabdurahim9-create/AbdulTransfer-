
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const STORAGE = path.join(os.tmpdir(), "abdultransfer");
fs.mkdirSync(STORAGE, { recursive: true });

const sessions = new Map();
const SESSION_TIME = 30 * 60 * 1000;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 100;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

app.use("/api", limiter);

function token() {
  return crypto.randomBytes(32).toString("hex");
}

function makeCode() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, "0");
}

function getSession(code) {
  const session = sessions.get(String(code || ""));
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    removeSession(session.code);
    return null;
  }

  return session;
}

function removeSession(code) {
  const session = sessions.get(code);
  if (!session) return;

  for (const file of session.files) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
  }

  sessions.delete(code);
}

function getBearer(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function authorize(role) {
  return (req, res, next) => {
    const session = getSession(req.params.code);

    if (!session) {
      return res.status(404).json({
        error: "Aktarım odası bulunamadı veya süresi doldu."
      });
    }

    const supplied = getBearer(req);
    const expected = role === "receiver"
      ? session.receiverToken
      : session.senderToken;

    if (!expected || supplied !== expected) {
      return res.status(403).json({
        error: "Bu işlem için yetkin yok."
      });
    }

    req.transferSession = session;
    next();
  };
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || "").slice(0, 20);
    cb(null, crypto.randomBytes(18).toString("hex") + extension);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/status", (req, res) => {
  res.json({
    name: "AbdulTransfer",
    status: "active",
    version: "2.0.0"
  });
});

// Yeni telefonda aktarım odası oluştur.
app.post("/api/create", (req, res) => {
  let code;

  do {
    code = makeCode();
  } while (sessions.has(code));

  const receiverToken = token();

  const session = {
    code,
    receiverToken,
    senderToken: null,
    files: [],
    expiresAt: Date.now() + SESSION_TIME
  };

  sessions.set(code, session);

  const transferUrl =
    `${req.protocol}://${req.get("host")}/?code=${code}`;

  res.json({
    code,
    receiverToken,
    transferUrl,
    expiresAt: session.expiresAt
  });
});

// Eski telefon bağlantıyı açınca eşleştir.
app.post("/api/join", (req, res) => {
  const code = String(req.body?.code || "").trim();

  if (!/^\d{8}$/.test(code)) {
    return res.status(400).json({ error: "Kod geçersiz." });
  }

  const session = getSession(code);

  if (!session) {
    return res.status(404).json({
      error: "Aktarım bağlantısı geçersiz veya süresi dolmuş."
    });
  }

  if (session.senderToken) {
    return res.status(409).json({
      error: "Bu bağlantı daha önce kullanılmış."
    });
  }

  session.senderToken = token();

  res.json({
    senderToken: session.senderToken,
    message: "Cihaz eşleştirildi."
  });
});

// Eski telefondan toplu dosya yükleme.
app.post(
  "/api/upload/:code",
  authorize("sender"),
  (req, res, next) => {
    upload.array("files", MAX_FILES)(req, res, (err) => {
      if (err) {
        let message = "Dosyalar yüklenemedi.";

        if (err.code === "LIMIT_FILE_SIZE") {
          message = "Bir dosya 100 MB sınırını aşıyor.";
        }

        if (err.code === "LIMIT_FILE_COUNT") {
          message = "Tek seferde en fazla 100 dosya gönderebilirsin.";
        }

        return res.status(400).json({ error: message });
      }

      next();
    });
  },
  (req, res) => {
    const session = req.transferSession;

    const uploaded = (req.files || []).map(file => {
      const item = {
        id: token().slice(0, 24),
        name: path.basename(file.originalname || "dosya"),
        size: file.size,
        mimeType: file.mimetype || "application/octet-stream",
        path: file.path
      };

      session.files.push(item);

      return {
        id: item.id,
        name: item.name,
        size: item.size
      };
    });

    res.json({
      success: true,
      uploaded,
      totalFiles: session.files.length
    });
  }
);

// Yeni telefon gelen dosyaları görür.
app.get(
  "/api/files/:code",
  authorize("receiver"),
  (req, res) => {
    const files = req.transferSession.files.map(file => ({
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType
    }));

    res.json({ files });
  }
);

// Yeni telefon dosyayı indirir.
app.get(
  "/api/download/:code/:id",
  authorize("receiver"),
  (req, res) => {
    const file = req.transferSession.files.find(
      item => item.id === req.params.id
    );

    if (!file || !fs.existsSync(file.path)) {
      return res.status(404).json({ error: "Dosya bulunamadı." });
    }

    res.download(file.path, file.name);
  }
);

// Aktarım odasını kapat ve geçici dosyaları sil.
app.post(
  "/api/finish/:code",
  authorize("receiver"),
  (req, res) => {
    removeSession(req.params.code);
    res.json({ success: true });
  }
);

// Süresi dolan odaları temizle.
setInterval(() => {
  for (const [code, session] of sessions.entries()) {
    if (Date.now() > session.expiresAt) {
      removeSession(code);
    }
  }
}, 60 * 1000).unref();

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Sunucu hatası oluştu." });
});

app.listen(PORT, () => {
  console.log(`AbdulTransfer ${PORT} portunda çalışıyor.`);
});
    
