// =======================================================
// 🔥 CRITICAL: Load environment variables FIRST
// =======================================================
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Resolve __dirname (ESM safe)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local explicitly from server folder
dotenv.config({
  path: path.resolve(__dirname, ".env.local"),
});

// Debug: Verify MONGO_URI is loaded (safe logging - no credentials)
if (process.env.MONGO_URI) {
  let uri = process.env.MONGO_URI;
  
  // Check for common mistake: MONGO_URI=MONGO_URI=...
  if (uri.startsWith('MONGO_URI=')) {
    console.warn("⚠️  WARNING: MONGO_URI contains 'MONGO_URI=' prefix");
    console.warn("   Your .env.local likely has: MONGO_URI=MONGO_URI=...");
    console.warn("   Should be: MONGO_URI=mongodb://...");
    uri = uri.replace(/^MONGO_URI=/, '');
  }
  
  // Check for line breaks (common issue)
  const hasLineBreaks = /\n|\r/.test(uri);
  if (hasLineBreaks) {
    console.warn("⚠️  WARNING: MONGO_URI contains line breaks");
    console.warn("   Keep MONGO_URI on a single line in .env.local");
  }
  
  // Safe logging: mask credentials and show scheme + host only
  const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@').replace(/\s+/g, '');
  const scheme = uri.trim().startsWith('mongodb+srv://') ? 'mongodb+srv' : 'mongodb';
  const prefix = uri.trim().startsWith('mongodb://') || uri.trim().startsWith('mongodb+srv://') ? '✅' : '⚠️';
  console.log(`${prefix} MONGO_URI loaded: ${scheme}://***@... (${maskedUri.length} chars)`);
} else {
  console.warn("⚠️  MONGO_URI not found in .env.local");
}

// Debug: Verify JWT_SECRET is loaded
if (process.env.JWT_SECRET) {
  console.log(`✅ JWT_SECRET loaded: ${process.env.JWT_SECRET.substring(0, 10)}... (${process.env.JWT_SECRET.length} chars)`);
} else {
  console.warn("⚠️  JWT_SECRET not found in .env.local - using default (NOT SECURE FOR PRODUCTION)");
}

// =======================================================
// NORMAL SERVER IMPORTS (AFTER ENV LOAD)
// =======================================================
import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.js";
import auditsRoutes from "./routes/audits.js";
import connectDB from "./config/database.js";

// =======================================================
// APP SETUP - CREATE EXPRESS APP FIRST
// =======================================================
const app = express();

// =======================================================
// MIDDLEWARE - REGISTER BEFORE ROUTES
// =======================================================
function parseAllowedOrigins() {
  const raw = [
    process.env.FRONTEND_URLS, // comma-separated
    process.env.FRONTEND_URL,  // single
  ]
    .filter(Boolean)
    .join(",");

  const envOrigins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\/+$/, ""));

  const defaults = [
    "http://localhost:3000",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4173",
    "http://localhost:5200",
    "http://localhost:5201",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5200",
    "http://127.0.0.1:5201",
  ];

  return new Set([...defaults, ...envOrigins]);
}

const allowedOrigins = parseAllowedOrigins();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow non-browser clients (curl, server-to-server) with no origin header
      if (!origin) return cb(null, true);
      const normalized = origin.replace(/\/+$/, "");
      // Allow any localhost/127.0.0.1 port for local development
      if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(normalized)) {
        return cb(null, true);
      }
      if (allowedOrigins.has(normalized)) return cb(null, true);
      console.warn(`⚠️  CORS blocked request from origin: ${origin}`);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// =======================================================
// ROUTES - REGISTER ALL ROUTES BEFORE app.listen()
// =======================================================

// Root route (deployment sanity check)
app.get("/", (_, res) => {
  res.json({ status: "OK", message: "Backend is running" });
});

// Hard test route - MUST work
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Health check route
app.get("/health", (_, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/audit", auditsRoutes); // Unified audit endpoint
app.use("/api/audits", auditsRoutes); // Legacy compatibility

// =======================================================
// ERROR HANDLING
// =======================================================
app.use((err, req, res, next) => {
  console.error("❌ ERROR:", err);
  res.status(500).json({ error: err.message });
});

// =======================================================
// INITIALIZE SERVICES (MongoDB first, then others)
// =======================================================
async function initializeServices() {
  try {
    // 1. Connect to MongoDB (fail fast if connection fails)
    console.log("🔌 Connecting to MongoDB...");
    await connectDB();
    
    // 2. Validate OpenAI API key (non-blocking - audit will gracefully degrade if unavailable)
    console.log("🤖 Validating OpenAI service...");
    const openaiReady = !!process.env.OPENAI_API_KEY;
    if (!openaiReady) {
      console.warn("⚠️  OPENAI_API_KEY not set. Audit endpoints will return fallback responses.");
    } else {
      console.log("✅ OpenAI service ready for audits");
    }

    // Final confirmation
    console.log("\n" + "=".repeat(60));
    console.log("✅ MongoDB connected");
    console.log("✅ Authentication: JWT + MongoDB");
    if (openaiReady) {
      console.log("✅ AI service ready for audits");
    } else {
      console.log("⚠️  AI service unavailable - audits will use fallback");
    }
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("❌ Failed to initialize services:", error.message);
    // Do NOT kill the HTTP server process — keep it running so the frontend
    // doesn't see a connection error. Endpoints that require MongoDB will
    // fail gracefully until connectivity is restored.
    console.error("⚠️  Services not fully initialized. Server will keep running and retry MongoDB connection in 30s.");
    setTimeout(() => {
      initializeServices().catch(() => {});
    }, 30_000);
  }
}

// =======================================================
// START SERVER - LISTEN ON process.env.PORT || 3001
// =======================================================
const port = Number(process.env.PORT) || 3001;

app.listen(port, () => {
  console.log(`Server running on ${port}`);
  console.log("Test routes:");
  console.log(`  http://localhost:${port}/`);
  console.log(`  http://localhost:${port}/ping`);
  console.log(`  http://localhost:${port}/health`);
  
  // Validate environment variables (warn but don't exit)
  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️  OPENAI_API_KEY not set - audit features may not work");
  }

  // Initialize services AFTER server is listening
  // MongoDB connection must succeed before other services start
  initializeServices();
});

// =======================================================
// SHUTDOWN HANDLERS
// =======================================================
process.on("SIGINT", () => {
  console.log("🛑 Shutting down...");
  process.exit(0);
});
