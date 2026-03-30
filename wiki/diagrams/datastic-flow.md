---
title: "Datastic — Data Flow"
tags: ["architecture", "data-pipeline", "bigquery"]
language: "typescript"
updated: "2026-03-30"
description: "Architecture flow for Datastic: GH Archive + HuggingFace analytics via BigQuery, dbt, and GitHub Actions."
source_repo: "Datastic"
---

# Datastic Data Flow

Data analytics dashboard pulling from GH Archive and HuggingFace Hub via BigQuery.

```mermaid
flowchart LR
    User([User]) --> React["React SPA<br/>Netlify"]
    React -->|fetch| NF["Netlify Functions"]
    NF -->|query| BQ["BigQuery"]
    GHA["GH Archive"] -->|daily| dbt["dbt Models"]
    HF["HuggingFace Hub"] -->|daily| dbt
    dbt --> BQ
    BQ --> NF
    NF --> React
    React --> User
    GA["GitHub Actions"] -->|schedule| dbt
```

## Key Services
- **GitHub Actions**: Scheduled dbt runs to transform raw data
- **dbt**: Data modeling layer on top of BigQuery
- **BigQuery**: Warehouse for GH Archive and HuggingFace data
- **Netlify Functions**: Query proxy to BigQuery (server-side credentials)
