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
https://your-code-wiki.netlify.app/.netlify/functions/export-bronze
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
url = "https://your-code-wiki.netlify.app/.netlify/functions/export-bronze"
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

github_df = spark.createDataFrame(repos)
github_df.write.format("delta") \
  .mode("overwrite") \
  .saveAsTable("bronze_github_repos")
```

### Netlify-specific bronze table

```python
netlify_data = data["sources"].get("netlify", {})
sites = netlify_data.get("sites", [])

netlify_df = spark.createDataFrame(sites)
netlify_df.write.format("delta") \
  .mode("overwrite") \
  .saveAsTable("bronze_netlify_sites")
```

## 4. Silver Layer — Cleaned & Normalized

```sql
-- Silver: normalized project-level view joining GitHub and Netlify data
CREATE OR REPLACE TABLE silver_project_metrics AS
SELECT
  g.name AS project_name,
  g.language,
  g.commits30d,
  g.lastCommitDate AS last_commit_date,
  g.openIssues AS open_issues,
  n.siteName AS netlify_site,
  n.url AS site_url,
  n.deploysLast30d AS deploys_30d,
  n.deploySuccessRate AS deploy_success_rate,
  CASE
    WHEN n.lastDeploy.state = 'ready' THEN 'healthy'
    WHEN n.lastDeploy.state = 'error' THEN 'error'
    ELSE 'unknown'
  END AS deploy_status,
  current_timestamp() AS processed_at
FROM bronze_github_repos g
LEFT JOIN bronze_netlify_sites n
  ON lower(n.repoUrl) LIKE concat('%/', lower(g.name), '%')
```

## 5. Gold Layer — Business-Ready Aggregations

```sql
-- Gold: project health summary
CREATE OR REPLACE TABLE gold_project_health AS
SELECT
  project_name,
  language,
  last_commit_date,
  datediff(current_date(), last_commit_date) AS days_since_commit,
  commits30d,
  deploy_status,
  deploy_success_rate,
  deploys_30d,
  open_issues,
  CASE
    WHEN deploy_status = 'error' THEN 'needs-attention'
    WHEN datediff(current_date(), last_commit_date) > 90 THEN 'stale'
    WHEN deploy_success_rate < 0.8 THEN 'unstable'
    ELSE 'healthy'
  END AS health_category
FROM silver_project_metrics

-- Gold: infrastructure overview
CREATE OR REPLACE TABLE gold_infra_overview AS
SELECT
  count(*) AS total_projects,
  count(netlify_site) AS deployed_projects,
  sum(deploys_30d) AS total_deploys_30d,
  avg(deploy_success_rate) AS avg_deploy_success_rate,
  sum(CASE WHEN deploy_status = 'error' THEN 1 ELSE 0 END) AS projects_with_errors,
  sum(CASE WHEN datediff(current_date(), last_commit_date) > 90 THEN 1 ELSE 0 END) AS stale_projects
FROM silver_project_metrics
```

## 6. SQL Dashboard Queries

### Effort vs Impact

```sql
SELECT
  project_name,
  commits30d AS effort,
  deploys_30d AS deployment_activity,
  health_category
FROM gold_project_health
ORDER BY commits30d DESC
```

### Stalest Projects

```sql
SELECT project_name, days_since_commit, language, deploy_status
FROM gold_project_health
WHERE days_since_commit > 30
ORDER BY days_since_commit DESC
```

### Language Distribution

```sql
SELECT language, count(*) AS project_count
FROM gold_project_health
GROUP BY language
ORDER BY project_count DESC
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
