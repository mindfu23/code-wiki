---
title: "standard-setups"
updated: "2026-02-28"
visibility: "private"
---


#Standard setups#

Note: this current file itself is available to the local mcp via .claude and is also stored in code-wiki/wiki/preferences.

##Some standard components

When asked to build something that can involve several components, either directly or indirectly, check here first to see if something similar has already been used here. Also check to see if something is available that is open source which covers the same basic functionality. If you find anything in either case, present that to the user.

-> Standard AI chat tools - recently using Vercel AI SDK -

-> Signup / Login flow - recently using what is currently in Create. Most recent version should also have forgot password flow

-> Database storage when needed - for always on / fast starts currently using Google cloud, which is still on free tier for me for the next 12 months

-> User credentials and document storage from apps - Cloudflare, which also has worker setups. Previously Supabase was used.

-> Standard UI for saving chats - for now, saving as md files for what's in practice in ValueApe and Metabot. Future note is to see if Vercel has some similar functionality.

-> same code base for web app and mobile - mainly using React with Capacitor. Sometimes using Github Actions for python functionality.

-> Health checks - if the application is going to be used on Netlify or a mobile app, ask first and then integrate the health check currently in 
Health checks are currently monitored in the free tier of Uptime Robot. 

-> API / AI usage tracking - had made my own app for this, in my GitHub as apiTracker. 

-> Ko-fi link - my most recent favorite version of this is in the ValueApe app.

-> Doc import / export functions have been set up in the Novelizer app, the EthicalAIditor app and the StoryCircle-dev app

## Standard overall user preferences

-> I as a user generally prefer a code base that can also be relatively conveniently ported to multiple different platforms. So I generally want it work as a web app that I will also host and test on Netlify, and also for it to be relatively easy to wrap the same core code in any needed functionality for porting to iOS and Android and placing in those stores. 

-> smaller items that are suitable for users basic information is stored locally on the users' individual device, often via IndexDB

-> Python scripts and similar for more advanced functionality than can conveniently run on the user's browser or mobile app.

-> larger databases or files including custom LLM models I'm typically hosting on Google Drive

->I overall prefer using app resources at either free tier or my current typically low paid tier for services. I currently have free or paid access on:

- Google including Gemini (Pro, at $2/mo for intro 3 months as of Jan 2026)
- Perplexity (pro at $20)
- Figma (pro at $20)
- Open AI (pro at $20)
- Github Copilot (pro at $39, looking at reducing if I can)
- Anthropic at $100/mo 

- Friendli.ai (free)
- Supabase (free)
- Hugging Face (free)
- Open Router (free)

-> LLMs and other similar items I'm typically preferring to reach on the free tier of Hugging Face

-> For UI and UX, I typically prefer the app to provide some feedback to the user when a user's input search returns no info, or when the user inputs information that does not work for some reason.

-> When developing app code that will be for use with iOS and Android, and Flutter or some similar option is being used, testing might occur on Netlify. To make sure that Netlify hosted versions have the latest changes, rebuild what Netlify will need to display those changes. Make this part of the git repo update process as needed for this.

-> If an app has a logo as part of the UI, such as in the top bar or similar, also make this logo the default thumbnail to appear if the web app is made a shortcut on iOS or Android. Also if the app code is made or remade for potential use in the iOS or Android app stores, have this same thumbnail be the default thumbnail offered. Of course if another thumbnail is created after this point that I want instead, use the thumbnail that I want.

// ignore this for now, until the next double slashes. 
-> Pay attention to if the app being designed, redesigned or used is using real-world data or is creating new / mock / simulation data. Unless the app is for creating art such as fiction, or fill-in data for historical simulations, let the user know if and when this will be part of the design. //

##Some standard features

-> Unless otherwise asked, set up front end so that the web version can be viewed in a narrow browser, such as on a mobile device. 

-> Unless otherwise asked, if there are top menu nav items then have them move to a "hamburger menu" list when the web version of the app is viewed in a narrow browser, such as on a mobile device. 

-> Unless otherwise asked, a default saving and exporting setup is in /Users/jamesbeach/Documents/visual-studio-code/github-copilot/EthicalAIditor 

-> If there is any button or similar that causes an action, make the button has useful and appropriate label text

-> If Flutter is used to create builds for iOS versions, including but not necessarily limited to baking in an API key value, update the Netlify .toml build so that the Flutter build is made and output for the web deploy also.

##Standard things to check for

-> When using Netlify, make sure the netlify.toml file will skip scanning for variables, example:

[build.environment]
  NODE_VERSION = "20"
  SECRETS_SCAN_OMIT_KEYS = "VITE_API_URL"
  
-> If a requirements.txt file exists or is needed, make sure it matches the current needs for the app. It could be out of date.
  
-> Check for typescript errors that might also block Netlify builds 

-> For new projects or significant reworkings of existing projects, test via npm locally and fix issues before pushing changes to remote
  
-> Check and confirm ahead of time that there will not be CORS violations on Netlify

-> CORS Configuration Gotcha: When using FastAPI (or similar) with CORSMiddleware, wildcard subdomain patterns like `https://*.netlify.app` do NOT work when `allow_credentials=True`. You must specify the exact domain:
  - BAD: `allow_origins=["https://*.netlify.app"]` with `allow_credentials=True`
  - GOOD: `allow_origins=["https://my-app.netlify.app"]` with `allow_credentials=True`
  - ALTERNATIVE: Use `allow_origins=["*"]` with `allow_credentials=False` (less secure, no cookies/auth headers)

-> have a standard way set up for an agent to connect with my github repo if it's set to private

-> For apps that are using data from other sources, once testing is complete and the app is going live such as to Netlify or similar, make sure that the app is using real data and not mock data