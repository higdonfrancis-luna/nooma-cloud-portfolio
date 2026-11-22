# Explainer video sources

Code that builds the two narrated explainer videos hosted on the AWS site. The finished videos are in `site/video/`.

| Folder | Video | Watch page |
|---|---|---|
| `aws/` | Same product, two clouds: the Strategic Partners CRM on AWS | `/video.html` |
| `lunaphone/` | A phone agent on Azure: LunaPhone with Twilio, Python and Azure OpenAI | `/lunaphone-video.html` |

## How a video is built

1. `python3 -I build.py` writes one HTML slide per scene into `slides/` and the narration into `script.json`. The script lives in `build.py`.
2. `python3 render.py` renders each slide to a 1920x1080 PNG with Playwright (Chromium).
3. `python3 tts.py` reads `script.json` and records each scene with OpenAI text-to-speech (`gpt-4o-mini-tts`, Echo voice). The OpenAI key is never in this repo: the request goes through a proxy that adds it, so the script sends a placeholder.
4. `../make_video.sh <folder> out.mp4` pairs each slide with its narration and joins the clips with ffmpeg.

Generated files (slides, audio, clips, MP4s) are ignored by git.

The LunaPhone script was checked claim by claim against the build history before it was recorded: no compliance claims, proposed fixes are called proposals, and the Azure and Cloudflare stages stay separate.
