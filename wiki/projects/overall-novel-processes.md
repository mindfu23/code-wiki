---
title: "Overall novel processes and workflows"
updated: "2026-03-09"
visibility: "private"
---

As of this writing 2026 03 08 I'm developing and testing a few different ways to create novels from scratch with AI orchestration. 

The two main methods are the Novelizer app, and the n8n workflow currently at http://35.188.141.23:5678/workflow/fO5KbBCNxtXK5KPh 

Both have been updated today to use the recently put together lorebook MCP. This was based on vibe-coding with some tokenizing, similar to the method used by jcodemunch. 

I've also created a google sheet that should sync with local MCP lorebook use, here. Each new book should become a separate new tab. https://docs.google.com/spreadsheets/d/1vSGcfSPmDKBUAvk7vJK7Y76PX5rJNr3L82ipCP5xsjI/edit?gid=0#gid=0 

One other method to compare could be Gastown as rigged for novels. Can see how that goes after this. With the Lorebook MCP, this should be significantly cheaper than other methods in API cost.

***

in exploration of the current n8n workflow, I've also added this request to the plotting section:

...If a full plot hasn't already been specified, it would be neat if the chapter plot was either developed from scratch, or filled in, along Dan Harmon Story Circle lines?
I've already had some development in the Story Circle plotting system done here:
/Users/jamesbeach/Documents/visual-studio-code/github-copilot/StoryCircle-dev
What might be great is if the intervening plot is strung along with:
a) main character / protagonist external goal defined
b) main character / protagonist internal emotional goal defined
c) main antagonist goal defined, that almost certainly in conflict with what the protagonist wants
e) protagonist remaining steps around the circle to get what he wants, and how that affects and is affected by what the antagonist wants
f) the protagonist's and antagonist's internal emotional goals and up-down emotion flow in the process
g) how that up-down emotional flow affects those around the protagonist, and influences their own emotions and choices if at all

****

from pre-run update:

everything is in novel-orchestration-import.json. That file has all the server credential IDs preserved, so importing it as a new workflow and deleting the old one should work.

Here's a quick recap of everything that's in this file since we started:

29 nodes, all with server credential IDs
Opus 4.6 for writing, characters, and revisions; Sonnet for line editing
GPT-4o for plot + consistency; Gemini 2.5 Flash for reviews; Grok-2 for creative enhancements; Sonar Pro for research
Story Circle methodology with beat-to-chapter mapping
Flexible chapter outlines (full, partial, or empty — with waypoint interpolation)
Voice guide in every writing/editing prompt
Tonal direction (Lovecraftian horror + Scott Pilgrim)
Character goals (protagonist external/internal, antagonist, supporting arcs)
startFromChapter + authorFeedback for review-then-continue workflow
Adaptive chapter length mode
Previous chapter context (summaries fed into each new chapter for continuity)
Token cost tracking across all models with final cost summary
Pipeline logging saved to {projectSlug}-log Sheets tab
Spare text capture saved to Sheets + Google Doc
Manuscript export to Google Doc
Grok sequential fix (no longer races with the draft)
Simplified revision loop (one pass, no redundant re-review)
Miskatonic Boys trigger data is pre-populated with all 12 chapter outlines, character goals, voice guide, and Story Circle enabled. For your first run, just change targetChapters to 1 to review Chapter 1 before continuing.