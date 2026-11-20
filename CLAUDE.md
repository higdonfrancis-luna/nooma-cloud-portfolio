# NOOMA Cloud Portfolio

Owner: Adam, founder of NOOMA Engineering (nooma.engineering).

## Goal
A public cloud portfolio that shows deep backend skill across AWS, Azure and Cloudflare. Front-end work is commoditizing; Adam wants to be seen as a full-stack builder with backend depth. Each project gets an architecture diagram, a short case study for nooma.engineering and adamhigdon.ai, and clean public code in this repo.

## This repo is PUBLIC
Never copy client code, Adobe code, or real data into it. Demo data only.

## Reference repos (READ ONLY, never modify)
- WARROOM: Adam's Adobe partner intelligence dashboard on Cloudflare Workers
- Matador: Cloudflare Workers call/lead intelligence platform
- Old phone agent: Twilio + webhook middleware + Google/OpenAI TTS, Python, hosted on Azure

## Plan
1. AWS flagship: rebuild WARROOM's architecture on AWS with FAKE demo data only (no real Adobe partner or account data). Workers to Lambda + API Gateway, D1/KV to DynamoDB, front end to S3 + CloudFront. Story: "same product, two clouds."
2. Azure: a new phone agent reusing the Twilio webhook pattern, with a fresh use case (e.g. after-hours intake line), on Azure Functions or App Service.
3. Cloudflare: no new build. Write up Adam's existing products as case studies.
4. Backup AWS demo if WARROOM gets complicated: the Strategic Partner CRM.
5. Revere (law-firm dashboard) is client-owned under its MSA: case study only, anonymized, no code, pending Steve's OK.
6. Adam plans to take the AWS Solutions Architect Associate certification alongside this.

## Rules
- Propose every change and wait for Adam's yes before building or pushing.
- Commit to GitHub with descriptive messages; no manual deploys.
- No em-dashes in anything written.
- UI: black background, white and #7C3AED purple only, Inter font, professional SVG icons, no emojis.
- Adam learns best from architecture flow diagrams with notes.
- Be positive and upbeat.

## First step
Once Adam describes WARROOM's current setup, draw the AWS architecture diagram and build plan for his review. No code yet.
