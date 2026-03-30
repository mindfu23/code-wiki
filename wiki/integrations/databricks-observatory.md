---
title: "Databricks Observatory Setup"
description: "Guide for ingesting observatory metrics into Databricks Community Edition using the medallion architecture"
tags: ["databricks", "observability", "analytics", "data-engineering"]
language: "python"
updated: "2026-03-22"
---

# Databricks Observatory — Setup Guide

This guide walks through ingesting metrics from the code-wiki Observatory into Databricks Community Edition, building a medallion lakehouse (bronze → silver → gold), and creating SQL dashboards.

## 1. Sign Up for Databricks Community Edition

1. Go to [community.cloud.databricks.com](https://community.cloud.databricks.com/)
2. Click "Get Started — Free"
3. Select "Community Edition" (not the full trial)
4. Create your account — no credit card required
5. Once in, create a cluster: Compute → Create Cluster → use defaults → Start

Community Edition gives you:
- One small cluster (terminates after 2 hours of inactivity)
- Delta Lake support
- Notebooks (Python, SQL, Scala)
- No Delta Live Tables or Workflows (paid features), but you can demonstrate the medallion pattern manually

## 2. Export Endpoint

The Observatory exposes a bronze data export at:

```
https://mindfu23code-wiki.netlify.app/.netlify/functions/export-bronze
```

Query params:
- `?source=github,netlify` — filter to specific sources
- `?format=ndjson` — newline-delimited JSON (useful for streaming)

## 3. Bronze Layer — Raw Ingestion

Create a Python notebook and run:

```python
import requests
import json

# Fetch raw metrics from Observatory
url = "https://mindfu23code-wiki.netlify.app/.netlify/functions/export-bronze"
response = requests.get(url)
data = response.json()

# Create bronze tables per source
for source_name, source_data in data.get("sources", {}).items():
    df = spark.createDataFrame([{
        "source": source_name,
        "snapshot_time": data["snapshotTime"],
        "raw_json": json.dumps(source_data),
        "ingested_at": data["exportedAt"],
    }])

    df.write.format("delta") \
      .mode("append") \
      .saveAsTable(f"bronze_{source_name}")

    print(f"Saved bronze_{source_name}")
```

### GitHub-specific bronze table

```python
github_data = data["sources"].get("github", {})
repos = github_data.get("repos", [])

# Flatten to simple types (raw API responses have nested objects Spark can't auto-infer)
flat_repos = [{
    "name": r.get("name", ""),
    "full_name": r.get("full_name", ""),
    "language": r.get("language") or "Unknown",
    "private": bool(r.get("private", False)),
    "fork": bool(r.get("fork", False)),
    "stargazers_count": int(r.get("stargazers_count", 0)),
    "open_issues_count": int(r.get("open_issues_count", 0)),
    "pushed_at": r.get("pushed_at", ""),
    "created_at": r.get("created_at", ""),
    "updated_at": r.get("updated_at", ""),
    "html_url": r.get("html_url", ""),
    "description": r.get("description") or "",
    "default_branch": r.get("default_branch", "main"),
    "size": int(r.get("size", 0)),
} for r in repos]

github_df = spark.createDataFrame(flat_repos)
github_df.write.format("delta") \
  .mode("overwrite") \
  .saveAsTable("bronze_github_repos")

display(github_df)
```

### Netlify-specific bronze table

```python
netlify_data = data["sources"].get("netlify", {})
sites = netlify_data.get("sites", [])

# Flatten to simple types
flat_sites = [{
    "site_id": s.get("id", ""),
    "name": s.get("name", ""),
    "url": s.get("url", ""),
    "ssl_url": s.get("ssl_url", ""),
    "admin_url": s.get("admin_url", ""),
    "created_at": s.get("created_at", ""),
    "updated_at": s.get("updated_at", ""),
    "repo_url": (s.get("build_settings") or {}).get("repo_url", ""),
    "repo_branch": (s.get("build_settings") or {}).get("repo_branch", ""),
    "build_command": (s.get("build_settings") or {}).get("cmd", ""),
    "publish_dir": (s.get("build_settings") or {}).get("dir", ""),
    "deploy_state": (s.get("published_deploy") or {}).get("state", ""),
} for s in sites]

netlify_df = spark.createDataFrame(flat_sites)
netlify_df.write.format("delta") \
  .mode("overwrite") \
  .saveAsTable("bronze_netlify_sites")

display(netlify_df)
```

## 4. Silver Layer — Cleaned & Normalized

```sql
-- Silver: normalized project-level view joining GitHub and Netlify data
CREATE OR REPLACE TABLE silver_project_metrics AS
SELECT
  g.name AS project_name,
  g.language,
  g.open_issues_count AS open_issues,
  g.pushed_at AS last_commit_date,
  g.stargazers_count AS stars,
  g.size AS repo_size_kb,
  n.name AS netlify_site,
  n.ssl_url AS site_url,
  CASE
    WHEN n.deploy_state = 'ready' THEN 'healthy'
    WHEN n.deploy_state = 'error' THEN 'error'
    ELSE 'unknown'
  END AS deploy_status,
  current_timestamp() AS processed_at
FROM bronze_github_repos g
LEFT JOIN bronze_netlify_sites n
  ON lower(n.repo_url) LIKE concat('%/', lower(g.name), '%')
```

## 5. Gold Layer — Business-Ready Aggregations

```sql
-- Gold: project health summary
CREATE OR REPLACE TABLE gold_project_health AS
SELECT
  project_name,
  language,
  last_commit_date,
  datediff(current_date(), to_date(last_commit_date)) AS days_since_commit,
  stars,
  deploy_status,
  open_issues,
  CASE
    WHEN deploy_status = 'error' THEN 'needs-attention'
    WHEN datediff(current_date(), to_date(last_commit_date)) > 90 THEN 'stale'
    ELSE 'healthy'
  END AS health_category
FROM silver_project_metrics
```

```sql
-- Gold: infrastructure overview
CREATE OR REPLACE TABLE gold_infra_overview AS
SELECT
  count(*) AS total_projects,
  count(netlify_site) AS deployed_projects,
  sum(CASE WHEN deploy_status = 'error' THEN 1 ELSE 0 END) AS projects_with_errors,
  sum(CASE WHEN datediff(current_date(), to_date(last_commit_date)) > 90 THEN 1 ELSE 0 END) AS stale_projects,
  sum(open_issues) AS total_open_issues
FROM silver_project_metrics
```

## 6. SQL Dashboard Visualizations

After running each SQL cell, click the **"+"** button (or chart icon) below the results table to add a visualization. The recommended chart type is noted for each query.

### 6a. Health Category Breakdown
**Visualization: Pie chart** — Keys: `health_category`, Values: `project_count`

```sql
SELECT health_category, count(*) AS project_count
FROM gold_project_health
GROUP BY health_category
ORDER BY project_count DESC
```

### 6b. Language Distribution
**Visualization: Bar chart** — X: `language`, Y: `project_count`

```sql
SELECT language, count(*) AS project_count
FROM gold_project_health
GROUP BY language
ORDER BY project_count DESC
```

### 6c. Deploy Status Overview
**Visualization: Pie chart** — Keys: `deploy_status`, Values: `project_count`

```sql
SELECT deploy_status, count(*) AS project_count
FROM gold_project_health
GROUP BY deploy_status
```

### 6d. Stalest Projects (days since last commit)
**Visualization: Bar chart** — X: `project_name`, Y: `days_since_commit`, Color: `health_category`

```sql
SELECT project_name, days_since_commit, language, deploy_status, health_category
FROM gold_project_health
WHERE days_since_commit > 30
ORDER BY days_since_commit DESC
```

### 6e. Project Activity Heatmap
**Visualization: Bar chart** — X: `project_name`, Y: `days_since_commit`, Color: `language`

```sql
SELECT project_name, days_since_commit, stars, open_issues, language
FROM gold_project_health
ORDER BY days_since_commit ASC
LIMIT 20
```

### 6f. Infrastructure Summary (single row KPIs)
**Visualization: Counter** — select each column as a separate counter, or leave as table

```sql
SELECT
  total_projects,
  deployed_projects,
  (total_projects - deployed_projects) AS not_deployed,
  projects_with_errors,
  stale_projects,
  total_open_issues
FROM gold_infra_overview
```

### 6g. Projects with Open Issues
**Visualization: Bar chart** — X: `project_name`, Y: `open_issues`

```sql
SELECT project_name, open_issues, language, deploy_status
FROM gold_project_health
WHERE open_issues > 0
ORDER BY open_issues DESC
```

### 6h. Repo Size Distribution
**Visualization: Bar chart** — X: `project_name`, Y: `repo_size_kb`

```sql
SELECT project_name, repo_size_kb, language
FROM silver_project_metrics
WHERE repo_size_kb > 0
ORDER BY repo_size_kb DESC
LIMIT 20
```

## 7. Scheduling (Manual in Community Edition)

Community Edition doesn't have Workflows/Jobs. To accumulate historical data:

1. Run the bronze ingestion notebook manually each day (or whenever you collect new metrics)
2. Use `mode("append")` for bronze tables to build history
3. Silver/gold tables use `CREATE OR REPLACE` to always reflect the latest snapshot

In production Databricks, you'd use:
- **Delta Live Tables** for declarative bronze → silver → gold pipeline
- **Workflows** for scheduled notebook execution
- **Auto Loader** for incremental file ingestion

## 8. Portfolio Presentation Notes

When presenting this as a proof of concept:

- **Emphasize the architecture**: "The same medallion pipeline handles an org with 5,000 repos without structural changes"
- **Show real data**: Navigate the dashboard, then show the same data flowing through Databricks
- **Highlight cross-source joins**: The silver layer joining GitHub commits with Netlify deploys is a genuine data engineering challenge
- **Address scale honestly**: "This is portfolio-scale data. The design decisions — partitioning, Delta format, incremental loading — are the patterns that matter at enterprise scale"
- **Point out what's real**: "I can explain why this traffic spike happened, or why this n8n workflow failed — because it's my actual infrastructure"
