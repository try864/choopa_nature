import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "choopanature.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  price REAL NOT NULL,
  image TEXT NOT NULL,
  photographer_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(photographer_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  photo_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'paid',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, photo_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(photo_id) REFERENCES photos(id)
);
`);

fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

const storage = multer.diskStorage({
  destination: path.join(__dirname, "uploads"),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, /^image\\/(jpeg|png|webp)$/.test(file.mimetype));
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Connexion requise." });
  next();
}
function photographer(req, res, next) {
  if (!req.session.user || !["photographer", "admin"].includes(req.session.user.role))
    return res.status(403).json({ error: "Compte photographe requis." });
  next();
}

app.post("/api/register", async (req, res) => {
  const { name, email, password, role = "buyer" } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Champs manquants." });
  if (!["buyer", "photographer"].includes(role)) return res.status(400).json({ error: "Rôle invalide." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)")
      .run(name.trim(), email.trim().toLowerCase(), hash, role);
    req.session.user = { id: result.lastInsertRowid, name, email: email.toLowerCase(), role };
    res.json({ user: req.session.user });
  } catch {
    res.status(409).json({ error: "Cet email est déjà utilisé." });
  }
});

app.post("/api/login", async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email?.toLowerCase());
  if (!user || !(await bcrypt.compare(req.body.password || "", user.password)))
    return res.status(401).json({ error: "Email ou mot de passe incorrect." });
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.get("/api/photos", (req, res) => {
  const q = `%${(req.query.q || "").trim()}%`;
  const category = req.query.category || "all";
  let sql = `
    SELECT p.id,p.title,p.description,p.category,p.price,p.image,p.created_at,
           u.name AS photographer
    FROM photos p JOIN users u ON u.id=p.photographer_id
    WHERE (p.title LIKE ? OR p.description LIKE ? OR u.name LIKE ?)
  `;
  const args = [q,q,q];
  if (category !== "all") { sql += " AND p.category=?"; args.push(category); }
  sql += " ORDER BY p.created_at DESC";
  res.json(db.prepare(sql).all(...args));
});

app.post("/api/photos", photographer, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image JPEG, PNG ou WEBP requise." });
  const { title, description = "", category, price } = req.body;
  if (!title || !category || !Number.isFinite(Number(price)) || Number(price) < 0)
    return res.status(400).json({ error: "Informations de photo invalides." });
  const image = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO photos(title,description,category,price,image,photographer_id)
    VALUES(?,?,?,?,?,?)
  `).run(title, description, category, Number(price), image, req.session.user.id);
  res.json({ id: result.lastInsertRowid });
});

app.delete("/api/photos/:id", photographer, (req,res) => {
  const photo = db.prepare("SELECT * FROM photos WHERE id=?").get(req.params.id);
  if (!photo || (photo.photographer_id !== req.session.user.id && req.session.user.role !== "admin"))
    return res.status(403).json({ error: "Action non autorisée." });
  db.prepare("DELETE FROM photos WHERE id=?").run(req.params.id);
  const file = path.join(__dirname, photo.image.replace(/^\\//,""));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

/*
  DEMO CHECKOUT:
  This records a purchase immediately. For production, replace this route
  with Stripe/PayPal or another supported payment provider and verify the
  payment server-side before creating the purchase.
*/
app.post("/api/purchases", auth, (req,res) => {
  const photo = db.prepare("SELECT * FROM photos WHERE id=?").get(req.body.photoId);
  if (!photo) return res.status(404).json({ error: "Photo introuvable." });
  try {
    db.prepare("INSERT INTO purchases(user_id,photo_id,amount,status) VALUES(?,?,?,'paid')")
      .run(req.session.user.id, photo.id, photo.price);
    res.json({ ok:true, message:"Achat enregistré en mode démonstration." });
  } catch {
    res.status(409).json({ error:"Cette photo est déjà dans vos achats." });
  }
});

app.get("/api/purchases", auth, (req,res) => {
  res.json(db.prepare(`
    SELECT p.id,p.title,p.image,p.price,p.photographer,pu.created_at
    FROM purchases pu
    JOIN photos p ON p.id=pu.photo_id
    JOIN users u ON u.id=p.photographer_id
    WHERE pu.user_id=?
    ORDER BY pu.created_at DESC
  `).all(req.session.user.id));
});

app.get("*", (_,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => console.log(`ChoopaNature: http://localhost:${PORT}`));
