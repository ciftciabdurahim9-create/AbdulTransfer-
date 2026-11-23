
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Render proxy ayarı
app.set("trust proxy", 1);
app.disable("x-powered-by");

const TEMP_DIR = path.join("/tmp", "abdultransfer");
const PUBLIC_DIR = path.join(__dirname, "public");

const EXPIRY_MS = 30 * 60 * 1000;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 20;

fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.json({ limit: "10kb" }));

// Statik dosyalar
app.use(express.static(PUBLIC_DIR));

// API istek sınırı
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Çok fazla istek gönderdin. Lütfen biraz bekle."
  }
});

app.use("/api", apiLimiter);

// Aktarım verileri
const transfers = new Map();

// Dosya depolama
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },

  filename: (req, file, cb) => {
    cb(null, crypto.randomBytes(24).toString("hex"));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 0
  }
});

// Güvenli dosya adı
function safeFileName(name) {
  return path.basename(String(name))
    .replace(/[\/\\<>:"|?*\x00-\x1F]/g, "_")
    .slice(0, 180) || "dosya";
}

// Benzersiz aktarım kodu
function createCode() {
  let code;

  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (transfers.has(code));

  return code;
}

// Aktarım kontrolü
function getTransfer(code) {
  const transfer = transfers.get(String(code));

  if (!transfer) return null;

  if (Date.now() >= transfer.expiresAt) {
    deleteTransfer(code);
    return null;
  }

  return transfer;
}

// Aktarımı ve dosyaları sil
function deleteTransfer(code) {
  const transfer = transfers.get(String(code));

  if (!transfer) return;

  for (const file of transfer.files) {
    try {
      fs.unlinkSync(file.path);
    } catch (error) {
      console.error("Dosya silme hatası:", error.message);
    }
  }

  transfers.delete(String(code));
}

// Token doğrulama
function checkUploadAccess(req, res, next) {
  const transfer = getTransfer(req.params.code);
  const token = req.headers["x-transfer-token"];

  if (!transfer) {
    return res.status(404).json({
      error: "Aktarım bulunamadı veya süresi doldu."
    });
  }

  if (
    typeof token !== "string" ||
    token.length !== transfer.token.length ||
    !crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(transfer.token)
    )
  ) {
    return res.status(403).json({
      error: "Aktarım yetkisi geçersiz."
    });
  }

  req.transfer = transfer;
  next();
}

// Ana sayfa
app.get("/", (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, "index.html");

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send(
      "AbdulTransfer ana sayfası bulunamadı. public/index.html dosyasını kontrol et."
    );
  }

  res.sendFile(indexPath);
});

// Yeni aktarım oluştur
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

// Dosya yükle
app.post(
  "/api/upload/:code",
  checkUploadAccess,
  upload.array("files", MAX_FILES),
  (req, res) => {
    const transfer = req.transfer;

    const uploadedFiles = (req.files || []).map(file => {
      const item = {
        id: file.filename,
        name: safeFileName(file.originalname),
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
      files: uploadedFiles
    });
  }
);

// Aktarımdaki dosyaları listele
app.get("/api/files/:code", (req, res) => {
  const transfer = getTransfer(req.params.code);

  if (!transfer) {
    return res.status(404).json({
      error: "Aktarım bulunamadı veya süresi doldu."
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

// Dosya indir
app.get("/api/download/:code/:id", (req, res) => {
  const transfer = getTransfer(req.params.code);

  if (!transfer) {
    return res.status(404).send(
      "Aktarım bulunamadı veya süresi doldu."
    );
  }

  const file = transfer.files.find(
    item => item.id === req.params.id
  );

  if (!file || !fs.existsSync(file.path)) {
    return res.status(404).send("Dosya bulunamadı.");
  }

  res.download(file.path, file.name);
});

// Aktarımı iptal et
app.delete(
  "/api/transfer/:code",
  checkUploadAccess,
  (req, res) => {
    deleteTransfer(req.params.code);

    res.json({
      success: true,
      message: "Aktarım silindi."
    });
  }
);

// Sunucu durumunu kontrol et
app.get("/api/status", (req, res) => {
  res.json({
    name: "AbdulTransfer",
    status: "active",
    version: "1.0.0"
  });
});

// Süresi dolan aktarımları temizle
setInterval(() => {
  for (const [code, transfer] of transfers.entries()) {
    if (Date.now() >= transfer.expiresAt) {
      deleteTransfer(code);
    }
  }
}, 60 * 1000);

// Hata yönetimi
app.use((err, req, res, next) => {
  console.error("Sunucu hatası:", err);

  if (err instanceof multer.MulterError) {
    if (req.files) {
      for (const file of req.files) {
        try {
          fs.unlinkSync(file.path);
        } catch {}
      }
    }

    return res.status(400).json({
      error: "Dosya yükleme sınırı aşıldı veya dosya yüklenemedi."
    });
  }

  res.status(500).json({
    error: "Sunucuda beklenmeyen bir hata oluştu."
  });
});

// Sunucuyu başlat
app.listen(PORT, "0.0.0.0", () => {
  console.log("AbdulTransfer çalışıyor: " + PORT);
});
  
