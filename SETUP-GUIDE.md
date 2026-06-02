# SecOwl Daily Briefing Setup Guide

This folder is ready to upload to GitHub.

## What each file does

- `index.html` is the public page you bookmark.
- `briefing.config.json` tells the generator what topics to cover.
- `scripts/generate-briefing.mjs` creates the daily briefing.
- `.github/workflows/daily-briefing.yml` tells GitHub to run the briefing every morning.
- `briefings/` stores past daily copies.

## What you still need to add in GitHub

You need one secret named `OPENAI_API_KEY`.

Beginner version: the key is like a private password that lets GitHub ask OpenAI to search, summarize, and write the daily briefing. Do not paste it into the public code files.

## How to add the key

1. Open your GitHub repo.
2. Go to **Settings**.
3. Click **Secrets and variables**.
4. Click **Actions**.
5. Click **New repository secret**.
6. Name it exactly: `OPENAI_API_KEY`
7. Paste your OpenAI API key as the value.
8. Click **Add secret**.

## How to test it manually

1. Go to the **Actions** tab in GitHub.
2. Click **Daily SecOwl Intelligence Briefing**.
3. Click **Run workflow**.
4. Wait for the run to finish.
5. Open your bookmarked GitHub Pages link.

The same bookmark will keep working. The page content changes; the link does not.
