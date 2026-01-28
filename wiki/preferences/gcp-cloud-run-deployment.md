# Google Cloud Run Deployment Guide

A comprehensive guide for deploying Python/FastAPI backends to Google Cloud Run via GitHub Actions.

## Prerequisites

- Google Cloud account with billing enabled
- GitHub repository
- `gcloud` CLI installed locally

## Initial GCP Setup

### 1. Create or Select a Project

```bash
# List existing projects
gcloud projects list

# Create a new project (optional)
gcloud projects create YOUR_PROJECT_ID --name="Your Project Name"

# Set active project
gcloud config set project YOUR_PROJECT_ID
```

### 2. Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project=YOUR_PROJECT_ID
```

### 3. Create Artifact Registry Repository

```bash
gcloud artifacts repositories create YOUR_REPO_NAME \
  --repository-format=docker \
  --location=us-central1 \
  --description="Docker images for your app" \
  --project=YOUR_PROJECT_ID
```

### 4. Create Service Account for GitHub Actions

```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions" \
  --project=YOUR_PROJECT_ID

# Store the email for convenience
SA_EMAIL="github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

### 5. Grant Required Permissions

```bash
# Cloud Run Admin - deploy services
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.admin"

# Artifact Registry Writer - push Docker images
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/artifactregistry.writer"

# Service Account User - deploy as compute service account
# First, find your compute service account number:
gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)"
# Then grant permission (replace PROJECT_NUMBER):
gcloud iam service-accounts add-iam-policy-binding \
  PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountUser" \
  --project=YOUR_PROJECT_ID
```

### 6. Create and Download Service Account Key

```bash
gcloud iam service-accounts keys create ~/github-actions-key.json \
  --iam-account=github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --project=YOUR_PROJECT_ID

# View the key (copy this for GitHub secrets)
cat ~/github-actions-key.json

# IMPORTANT: Delete the local key file after copying to GitHub
rm ~/github-actions-key.json
```

## GitHub Repository Setup

### Required Secrets

Go to GitHub → Repository → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `GCP_PROJECT_ID` | Your GCP project ID (e.g., `my-project-123`) |
| `GCP_SA_KEY` | The entire JSON content of the service account key |
| `ANTHROPIC_API_KEY` | (Optional) API key for Anthropic |
| `GOOGLE_API_KEY` | (Optional) API key for Google AI |
| `OPENAI_API_KEY` | (Optional) API key for OpenAI |
| `PERPLEXITY_API_KEY` | (Optional) API key for Perplexity |

## GitHub Actions Workflow

Create `.github/workflows/deploy-backend.yml`:

```yaml
name: Deploy Backend to Cloud Run

on:
  push:
    branches:
      - main
    paths:
      - 'src/**'
      - 'pyproject.toml'
      - 'Dockerfile'
      - '.github/workflows/deploy-backend.yml'
  workflow_dispatch:  # Allow manual trigger

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  SERVICE_NAME: your-api-name
  ARTIFACT_REPO: your-repo-name
  REGION: us-central1

jobs:
  deploy:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      id-token: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: ${{ env.PROJECT_ID }}

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build and push Docker image
        run: |
          docker build -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.ARTIFACT_REPO }}/${{ env.SERVICE_NAME }}:${{ github.sha }} .
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.ARTIFACT_REPO }}/${{ env.SERVICE_NAME }}:${{ github.sha }}

      - name: Deploy to Cloud Run
        env:
          ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GOOGLE_KEY: ${{ secrets.GOOGLE_API_KEY }}
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.ARTIFACT_REPO }}/${{ env.SERVICE_NAME }}:${{ github.sha }} \
            --platform managed \
            --region ${{ env.REGION }} \
            --allow-unauthenticated \
            --set-env-vars "ANTHROPIC_API_KEY=${ANTHROPIC_KEY},GOOGLE_API_KEY=${GOOGLE_KEY}" \
            --memory 2Gi \
            --cpu 1 \
            --min-instances 0 \
            --max-instances 3 \
            --timeout 300 \
            --cpu-boost

      - name: Get Cloud Run URL
        id: get-url
        run: |
          URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} --region ${{ env.REGION }} --format 'value(status.url)')
          echo "service_url=$URL" >> $GITHUB_OUTPUT
          echo "Backend deployed to: $URL"
```

## Dockerfile for FastAPI

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml .
COPY src/ ./src/
COPY config.yaml .  # If you have a config file

# Install Python dependencies
RUN pip install --no-cache-dir -e .

# Download spaCy model if using NER
RUN python -m spacy download en_core_web_sm

# Create any needed directories
RUN mkdir -p ./data

# Expose port (Cloud Run uses PORT env var)
EXPOSE 8080

# Set Python path
ENV PYTHONPATH=/app

# Disable Python buffering for better logging
ENV PYTHONUNBUFFERED=1

# Run the API server - use shell form to respect PORT env var
CMD uvicorn src.api:app --host 0.0.0.0 --port ${PORT:-8080}
```

## Common Dependencies (pyproject.toml)

For FastAPI with file uploads:

```toml
dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic>=2.0.0",
    "python-multipart>=0.0.6",  # REQUIRED for file uploads (UploadFile)
]
```

---

## Troubleshooting Guide

### Error: "Container failed to start on port 8080"

**Symptoms:**
- Deployment fails with timeout
- "Container failed to start and listen on the port"

**Solutions:**

1. **Check logs for the actual error:**
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=YOUR_SERVICE" \
     --project=YOUR_PROJECT_ID \
     --limit=50 \
     --format="table(timestamp,severity,textPayload)"
   ```

2. **Missing dependency:** Look for `RuntimeError` or `ImportError` in logs
   - Common: `python-multipart` required for `UploadFile`
   - Common: spaCy model not downloaded

3. **Use lazy imports:** Heavy imports at module level can cause startup timeout
   ```python
   # Bad - imports at module level
   from .heavy_module import HeavyClass

   # Good - lazy import when needed
   def get_heavy_class():
       from .heavy_module import HeavyClass
       return HeavyClass
   ```

4. **Increase memory/CPU:**
   ```yaml
   --memory 2Gi \
   --cpu 1 \
   --cpu-boost
   ```

### Error: "Permission denied on Artifact Registry"

**Symptoms:**
- `artifactregistry.repositories.uploadArtifacts denied`
- `artifactregistry.repositories.downloadArtifacts denied`

**Solution:**
```bash
# Grant Artifact Registry Writer role
gcloud artifacts repositories add-iam-policy-binding YOUR_REPO_NAME \
  --location=us-central1 \
  --member="serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer" \
  --project=YOUR_PROJECT_ID
```

### Error: "Project does not exist" or Wrong Project

**Symptoms:**
- Deploys to wrong project
- "projects/XXX does not exist"

**Root Cause:** The service account key (`GCP_SA_KEY`) contains a `project_id` field that determines which project gcloud authenticates to.

**Solution:**
1. Verify the project in your key matches `GCP_PROJECT_ID`:
   ```bash
   # Check project in your key
   cat your-key.json | grep project_id
   ```

2. If mismatched, create a NEW service account in the CORRECT project and update `GCP_SA_KEY`

3. After updating secrets, push a new commit (re-running old workflows uses cached secrets)

### Error: "Cloud Run Service Agent must have permission to read image"

**Symptoms:**
- Image pushed successfully
- Deploy fails with 403 Forbidden on image pull

**Root Cause:** Cross-project deployment - image in Project A, deploying to Project B

**Solution:** Keep everything in one project. Create service account in the same project as Artifact Registry.

### GitHub Actions Not Picking Up New Secrets

**Symptoms:**
- Updated secret but workflow still uses old value
- Same error after changing secrets

**Solution:**
1. Push a new commit (don't just re-run workflow)
2. The commit must change a file in the `paths` filter
3. Or use `workflow_dispatch` and click "Run workflow" (after fresh page load)

---

## Useful Commands

### View Cloud Run Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=YOUR_SERVICE" \
  --project=YOUR_PROJECT_ID \
  --limit=100
```

### List Cloud Run Services
```bash
gcloud run services list --project=YOUR_PROJECT_ID
```

### Get Service URL
```bash
gcloud run services describe YOUR_SERVICE \
  --region=us-central1 \
  --project=YOUR_PROJECT_ID \
  --format='value(status.url)'
```

### Delete a Service
```bash
gcloud run services delete YOUR_SERVICE \
  --region=us-central1 \
  --project=YOUR_PROJECT_ID
```

### List Artifact Registry Images
```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/YOUR_PROJECT_ID/YOUR_REPO_NAME
```

### Check IAM Permissions
```bash
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:github-actions@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

---

## Connecting Frontend (Netlify)

After successful deployment, connect your frontend to the Cloud Run backend:

### 1. Get the Cloud Run URL

```bash
gcloud run services describe YOUR_SERVICE \
  --region=us-central1 \
  --project=YOUR_PROJECT_ID \
  --format='value(status.url)'
```

This returns a URL like: `https://your-service-abc123-uc.a.run.app`

### 2. Set Netlify Environment Variable

1. Go to **Netlify** → Your Site → **Site configuration** → **Environment variables**
2. Add a new variable:
   - **Key:** `VITE_API_URL`
   - **Value:** Your Cloud Run URL (e.g., `https://your-service-abc123-uc.a.run.app`)
3. **Redeploy** your site for the change to take effect (Deploys → Trigger deploy → Deploy site)

### 3. Use in Frontend Code

```typescript
// In your frontend code
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Make API calls
const response = await fetch(`${API_URL}/health`);
```

### 4. Verify Connection

Test the health endpoint directly:
```bash
curl https://your-service-abc123-uc.a.run.app/health
```

Should return: `{"status":"healthy"}`

---

## Checklist for New Projects

- [ ] GCP project created with billing enabled
- [ ] APIs enabled (Cloud Run, Artifact Registry, Cloud Build)
- [ ] Artifact Registry repository created
- [ ] Service account created in the SAME project
- [ ] Service account has: `run.admin`, `artifactregistry.writer`, `iam.serviceAccountUser`
- [ ] Service account key generated and added to GitHub as `GCP_SA_KEY`
- [ ] `GCP_PROJECT_ID` secret matches the project in the service account key
- [ ] Dockerfile uses `PORT` environment variable (Cloud Run requirement)
- [ ] `python-multipart` included if using file uploads
- [ ] Heavy imports are lazy-loaded to avoid startup timeout
