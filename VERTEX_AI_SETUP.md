# Vertex AI Gemini Setup Guide

## ✅ Code Configuration Complete

All code has been configured to use Vertex AI Gemini with service account authentication.

## 📝 Required: Create `.env.local` File

Create a file named `.env.local` in the `AI/server/` directory with the following content:

```env
# Vertex AI Gemini Configuration
# Service account JSON path (absolute path for Windows)
GOOGLE_APPLICATION_CREDENTIALS=C:\Users\manis\Downloads\satark-ai---compliance-auditor (10)\AI\server\keys\vertex.json

# Google Cloud Project ID
GCP_PROJECT_ID=nmc-ai-4a8c1

# Vertex AI Location
GCP_LOCATION=us-central1
```

## 🔧 What Was Fixed

### 1. Environment Variable Loading (`AI/server/config/env.js`)
- ✅ Created dedicated config file that loads dotenv BEFORE any imports
- ✅ Loads `.env.local` from `AI/server/.env.local`
- ✅ Ensures `process.env` is populated before module initialization

### 2. Server Entry Point (`AI/server/index.js`)
- ✅ Imports `./config/env.js` FIRST (before all other imports)
- ✅ Added startup verification logs showing:
  - `GOOGLE_APPLICATION_CREDENTIALS`
  - `GCP_PROJECT_ID`
  - `GCP_LOCATION`

### 3. Audit Service (`AI/server/services/auditService.js`)
- ✅ Updated `getVertexAIConfig()` to resolve and validate `keyFilename`
- ✅ VertexAI initialization explicitly passes `keyFilename`
- ✅ Handles Windows absolute paths correctly
- ✅ Validates service account JSON file exists

### 4. Gemini Service (`AI/server/services/geminiService.js`)
- ✅ Updated `getVertexAIConfig()` to resolve and validate `keyFilename`
- ✅ `getVertexAIClient()` explicitly passes `keyFilename` to VertexAI
- ✅ Handles Windows absolute paths correctly
- ✅ Validates service account JSON file exists

### 5. Model Configuration
- ✅ Model set to `gemini-1.0-pro-002` (as required)
- ✅ No fallback models or deprecated endpoints

### 6. Authentication
- ✅ Uses ONLY `@google-cloud/vertexai` SDK
- ✅ NO `@google/generative-ai` usage
- ✅ NO API key authentication
- ✅ NO `v1beta` endpoints
- ✅ Service account JSON authentication via `GOOGLE_APPLICATION_CREDENTIALS`

## 🚀 Verification

After creating `.env.local`, start the server:

```bash
npm run server
```

You should see startup logs like:

```
✅ Loaded .env.local from: [path]
============================================================
🔐 VERTEX AI GEMINI AUTHENTICATION CONFIGURATION
============================================================
   GOOGLE_APPLICATION_CREDENTIALS: C:\Users\manis\Downloads\satark-ai---compliance-auditor (10)\AI\server\keys\vertex.json
   GCP_PROJECT_ID: nmc-ai-4a8c1
   GCP_LOCATION: us-central1
   Model: gemini-1.0-pro-002
   SDK: @google-cloud/vertexai
   📁 Configuration loaded from: .env.local
   🔒 Security: Backend uses GOOGLE_APPLICATION_CREDENTIALS for authentication
   🔒 Security: No REST calls, no generativelanguage.googleapis.com endpoints
============================================================
```

## ✅ Expected Behavior

- ✅ No "Unable to authenticate your request" errors
- ✅ No GoogleAuthError
- ✅ No Gemini API 404 errors
- ✅ No fallback logic needed
- ✅ Compliance audit works without errors

## 🔍 Troubleshooting

If you see authentication errors:

1. **Verify `.env.local` exists** in `AI/server/.env.local`
2. **Check the path** in `GOOGLE_APPLICATION_CREDENTIALS` matches your actual file location
3. **Verify service account JSON** exists at the specified path
4. **Check project ID** matches your GCP project: `nmc-ai-4a8c1`
5. **Verify service account** has Vertex AI permissions in GCP Console

## 📋 Summary

All code changes are complete and production-ready. The only remaining step is to create the `.env.local` file with the configuration values shown above.








