To build a system that meets your requirements, you can leverage **GitHub Actions** combined with the APIs of your preferred AI providers (OpenAI, Anthropic, Gemini). While there isn't a single out-of-the-box app that perfectly encapsulates your specific "compute-burning" logic alongside all the other features, you can achieve this by combining existing open-source actions with a custom workflow wrapper.

Here is how you would architect this custom solution:

### 1. Triggering at the End of the Billing Cycle
You can use GitHub Actions' `schedule` event with a `cron` syntax to run your workflow a few days before your monthly billing cycle resets. 
```yaml
on:
  schedule:
    # Runs at 00:00 on the 28th of every month
    - cron: '0 0 28 * *'
```
*Note on API Quotas:* Most AI providers (like Anthropic or OpenAI) have limited or complex APIs for directly querying remaining quotas programmatically. The easiest approach is simply scheduling the job at the end of the month and letting it run until it either finishes the codebase or hits an API rate limit/out-of-credits error (which you can catch and gracefully exit).

### 2. Tracking "Previously Reviewed" Code
To prevent the AI from repeatedly reviewing the exact same code, you can have the action maintain a `.ai-review-state.json` file in your repository (or use GitHub Repository Variables). This file would store the commit hashes of the last reviewed code for each file or directory. The action would:
1. Compare the current commit hash of a file against the stored hash.
2. Prioritize files that have changed since the last run.
3. If compute is still available, re-evaluate older files using newer models or updated security prompts.

### 3. Reviewing, Fixing, and Notifying
You can pass the code to the LLM with a strict prompt asking it to:
- Identify security vulnerabilities, performance bottlenecks, or modern code-style improvements.
- Output the exact replacement code.
- Provide a clear explanation of *why* the change is necessary.

### 4. Making Commits and Pull Requests
Instead of committing directly to `main`, the safest way to review and accept these changes is by generating a Pull Request. You can pipe the AI's output into the popular [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request) action. It will automatically bundle the modified files into a new branch, commit them, open a PR, and you can put the AI's explanation into the PR description. This acts as your notification and gives you the final say.

---

### Existing Open-Source Apps and Actions

While you may need to write a custom wrapper for the "credit tracking" and "state tracking" parts, there are several powerful open-source actions that handle the actual AI code review and PR generation. Here is the web search data on what currently exists:

Yes, there are several open-source GitHub Actions (and some Apps) that let you automate code reviews using LLM APIs like ChatGPT (OpenAI), Claude (Anthropic), and Gemini. Most of these can be easily scheduled, integrated into CI/CD, and some even support auto-creating PRs for code improvements or security fixes. Here are some of the most notable solutions, including insights into support for custom scheduling, credit management, and PR creation:

---

## 1. **AI Code Review Action – Automated PR Reviews Using AI**
- **Open-source** GitHub Action supporting Gemini and OpenAI GPT-4, with plans to add HuggingFace and more.
- **Features:** Pluggable providers, include/exclude filters, chunking for large diffs, custom rules, cost/token tracking (can help with credit management!), and detailed reports.
- **Scheduling:** Can be run on any GitHub Actions workflow triggers. While not *explicitly* designed to "use up credits," its cost tracking lets you monitor/estimate usage and adjust schedule.
- **PR Creation:** Reviews PRs but the workflow can be extended to create auto-fixing PRs.
- **Repo:** [legiaquan/code-review-action](https://github.com/legiaquan/code-review-action)[[1]](https://dev.to/quanlegia/ai-powered-code-review-action-automated-pr-reviews-using-ai-openai-gemini--3a35)

---

## 2. **AI Code & PR Review (gauravkrp/ai-code-reviewer)**
- **Supports** OpenAI GPT-4 and Anthropic Claude.
- **Features:** Inline suggestions, summaries, auto-fixes, can automatically create pull requests for suggested fixes, caches to reduce API costs, customizable focus (security, performance, bugs, etc.).
- **Scheduling:** Usable on any workflow event (push, pull_request, schedule, etc.), so you can run it on a cron to "use up credits."
- **PR Creation:** Supports auto-create PRs with fixes.
- **Marketplace:** [AI Code & PR Review](https://github.com/marketplace/actions/ai-code-review)[[2]](https://github.com/marketplace/actions/ai-code-pr-review)

---

## 3. **AI Code Review (multi-provider, including Google Gemini & Anthropic Claude)**
- **New/Experimental.** Allows you to select from OpenAI, Anthropic, Google, Perplexity…and configure custom providers.
- **Features:** Focus/extension/path filters, include/exclude paths, supports multiple file types.
- **Scheduling:** As with all GitHub Actions, supports cron triggers.
- **PR Creation:** Main focus is PR review; can be extended for PR creation.
- **Marketplace:** [AI Code Review](https://github.com/marketplace/actions/ai-code-review)[[3]](https://github.com/marketplace/actions/ai-code-review)

---

## 4. **Claude Code GitHub Actions**
- **Claude-specific** solution for PR reviews, auto-fixes, and feature implementations.
- **Highlights:** Walks you through setup for Anthropic Claude and GitHub App install. Can automatically create PRs and implement features based on issues.
- **Scheduling:** Can combine with scheduled workflows if desired.
- **Guide:** [Automating Code Reviews with Claude](https://lgallardo.com/claude-github-actions/)[[4]](https://lgallardo.com/2025/07/18/claude-code-github-actions-setup/)

---

## 5. **AI Assisted Code Review / AutoReviewer**
- **Focus:** OpenAI GPT-4 for code reviews, automatic PR comments, suggestions, uses labels/triggers for flexible automation.
- *Early-stage* but open-source and flexible.
- **Scheduling:** Triggerable by label, PR event, and can be set to run on schedule.
- **Repo:** [gvasilei/AutoReviewer](https://github.com/gvasilei/AutoReviewer)[[5]](https://github.com/marketplace/actions/ai-assisted-code-review)

---

## 6. **Custom Solutions**
- There are many tutorials on making your own AI-powered review bot using GitHub Actions and LLMs. These often include scheduling via cron, Slack notifications, and can be adapted to "use up API credits" by running more frequently or on-demand (ex: with [workflow_dispatch] or [schedule] triggers in GitHub Actions)[[6]](https://dev.to/paul_robertson_e844997d2b/ai-powered-code-review-automate-pull-request-analysis-with-github-actions-j90)[[7]](https://dev.to/cuongnp/how-to-build-an-ai-powered-code-review-bot-with-github-action-slack-and-llms-3iik)[[8]](https://logicspark.io/build-your-ai-powered-pr-review-agent-with-github-actions-a-step-by-step-guide-2025-edition/).

---

### **Tips to Use Up Remaining AI Credits**
- **Scheduling:** Use the GitHub Actions `schedule:` trigger (`cron`) to run reviews at fixed intervals, or all at once at the end of your usage cycle.
- **Token/Usage Management:** Some solutions (like legiaquan/code-review-action) explicitly support token usage monitoring, which can help tweak frequency to optimize API credit utilization.
- **Batch Processing:** You can set up actions to review *all* PRs or even create artificial PRs that touch many files, just to use more quota.

---

#### **Summary Table**

| Name                         | Open Source | Providers                           | PR Creation      | Scheduling           | Credit Monitoring   |
|------------------------------|-------------|-------------------------------------|------------------|----------------------|---------------------|
| legiaquan/code-review-action | Yes         | OpenAI, Gemini, planned more        | Extensible       | Yes (cron/events)    | Yes (token tracking)|
| gauravkrp/ai-code-reviewer   | Yes         | OpenAI, Claude                      | Yes (auto PRs)   | Yes                  | Some (caching)     |
| Claude Code GitHub Actions   | Yes         | Claude (Anthropic)                  | Yes              | Yes                  | No (API usage)     |
| gvasilei/AutoReviewer        | Yes         | OpenAI (GPT-4/GPT-3.5)              | No (review only) | Yes                  | No                 |
| Custom                       | Yes         | Any LLM with API                    | Yes (if coded)   | Yes                  | If implemented     |

---

**In summary:**  
You have many freely available, pluggable, open-source options! None are built solely for the purpose of "burning" your credits, but you can easily configure them to use up your monthly API quota using their scheduling and cost-tracking features. Look specifically at [legiaquan/code-review-action](https://github.com/legiaquan/code-review-action) and [gauravkrp/ai-code-reviewer](https://github.com/gauravkrp/ai-code-reviewer) for maximum flexibility and multi-provider support.[[1]](https://dev.to/quanlegia/ai-powered-code-review-action-automated-pr-reviews-using-ai-openai-gemini--3a35)[[2]](https://github.com/marketplace/actions/ai-code-pr-review)[[3]](https://github.com/marketplace/actions/ai-code-review)[[4]](https://lgallardo.com/2025/07/18/claude-code-github-actions-setup/)

If you want help with a specific workflow to maximize your monthly credits or automate code improvement/security-fix PRs, let me know your tech stack and I'll draft a sample for you!