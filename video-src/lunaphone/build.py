"""LunaPhone on Azure explainer: slides (HTML), script.json for narration.
Facts come only from the two LunaPhone history files Adam shared on Nov 21, 2026.
Usage: python3 -I build.py"""
import json, html
from pathlib import Path

D = Path(__file__).resolve().parent
for sub in ('slides', 'audio', 'clips'):
    (D / sub).mkdir(exist_ok=True)
PURPLE = '#7C3AED'
FOOT = 'A phone agent on Azure'

S = [
 dict(id='title', kind='title', title='A phone agent on Azure',
      sub='How LunaPhone was built with Twilio, Python and Azure OpenAI',
      say="This is the story of LunaPhone, an AI phone agent, and how its first hosted version ran on Microsoft Azure. A caller dials a normal phone number, and an AI answers, listens, and talks back in real time. By the end, you'll know every piece: Twilio, the Python service, Azure App Service, and the Azure OpenAI Realtime API. You'll know why each one is there, and the real problems we worked through along the way."),
 dict(id='big', title='The whole system', hl=['caller', 'twilio', 'app', 'aoai', 'google', 'settings', 'oryx', 'plan'],
      bullets=['A caller dials a Twilio number', 'Twilio streams the call to a Python service on App Service', 'The service relays it to the Azure OpenAI Realtime API', 'Two WebSockets, one bridge in the middle'],
      say="Here's the whole system. A caller dials a Twilio number. Twilio asks our app what to do, and the app answers with a few lines of instructions that say: open a media stream. Twilio then opens a WebSocket to our Python service on Azure App Service, and streams the caller's audio, live, in small chunks. The service opens a second WebSocket, to the Azure OpenAI Realtime API, and passes the audio along. The model listens, decides what to say, and streams its voice back. The service relays it to Twilio, and Twilio plays it to the caller. Two WebSockets, with one bridge in the middle."),
 dict(id='journey', kind='cards', title='How it got to Azure',
      cards=[('Nov 2025: a call screener', 'A Flask app on a laptop behind an ngrok tunnel. The plan: Twilio collects what the caller says, and a small OpenAI model sorts spam, wrong numbers and real calls.'),
             ('Nov 2025: Tars', 'Real-time experiments with an assistant named Tars: live audio over Twilio Media Streams to the OpenAI Realtime API, still running locally.'),
             ('Dec 2025: LunaPhone', 'The records now call the agent LunaPhone: a Python service on Azure App Service, talking to the Azure OpenAI Realtime API.')],
      say="It didn't start on Azure. In November 2025 it began as a personal call screener on a laptop: a Flask app behind an ngrok tunnel. The plan: Twilio collects what the caller says, and a small OpenAI model sorts spam, wrong numbers, and real calls. Next came real-time experiments with an assistant named Tars, streaming live audio instead of taking turns. By December, the records call the agent LunaPhone, hosted in the cloud on Azure."),
 dict(id='twilio', title='Twilio: the phone network’s API', hl=['caller', 'twilio'],
      bullets=['Hosts the phone number', 'Sends a webhook to your app on every call', 'TwiML: Say, Gather, Record, Dial, Connect', 'Media Streams: live call audio over a WebSocket'],
      say="Twilio is the bridge between the phone network and the web. You get a phone number, and when someone calls it, Twilio sends an HTTP request, called a webhook, to your app. Your app answers with TwiML, a small X M L language with verbs like Say, Gather, Record, and Dial. The early screener used those turn-taking verbs. For a live conversation, LunaPhone used Connect with Stream, which tells Twilio to open a WebSocket and stream the call's audio in real time. That feature is called Media Streams."),
 dict(id='appsvc', title='Azure App Service: a managed home for the app', hl=['app', 'oryx', 'plan'],
      bullets=['Platform as a service: Microsoft runs the servers', 'Linux plan, Python 3.11, Basic B1 tier', 'Oryx can build from requirements.txt on deploy', 'Gunicorn serves the app; HTTPS out of the box'],
      say="The Python service lived on Azure App Service, Microsoft's platform as a service for web apps. You bring the code, and Microsoft runs the servers, the operating system, and the patching. LunaPhone ran on a Linux plan, with Python three point eleven, on the Basic B one tier. When the build step is turned on, App Service's build engine, called Oryx, installs the packages listed in requirements dot T X T during deploy, and Gunicorn, a production web server for Python, runs the app. App Service also gives you an HTTPS address out of the box, which Twilio needs for secure WebSockets, and recommends for webhooks."),
 dict(id='python', title='Inside the service: Flask and Flask-Sock', hl=['app', 'settings'],
      bullets=['Flask: /incoming-call answers Twilio with TwiML', 'Flask-Sock: /media-stream is the WebSocket route', 'Each call holds two live connections', 'Endpoint and key read from environment variables'],
      say="Inside, Flask handled the web routes: slash incoming call answered Twilio's webhook with TwiML. Flask Sock added WebSocket support for slash media stream, where Twilio connects. For each call, the service holds two connections open at once, one to Twilio and one to the model, and moves audio between them. Settings like the Azure OpenAI endpoint and key came from environment variables, set in App Service."),
 dict(id='aoai', title='Azure OpenAI Realtime: hear, think, speak', hl=['aoai'],
      bullets=['OpenAI models in your own Azure subscription', 'Realtime API: speech in, speech out', 'One model hears, reasons and speaks', 'Session instructions set the job and the tone'],
      say="The brain and the voice came from the Azure OpenAI Realtime API. Azure OpenAI runs OpenAI's models inside Microsoft's cloud, as a resource in your own Azure subscription. The Realtime API is speech to speech: you stream audio in over a WebSocket, and the model streams spoken audio back. Instead of chaining speech recognition, a language model, and a separate voice engine, one model hears, reasons, and speaks. Instructions sent at the start of the session tell it what job it's doing, and how to sound."),
 dict(id='auth', title='Connecting: the 401 that taught us Azure', hl=['app', 'aoai', 'settings'],
      bullets=['Use the Azure resource key, not an OpenAI key', 'Endpoint: https://<resource>.openai.azure.com, exactly', 'Preview URL: /openai/realtime, api-version, deployment', 'Header is api-key, not Authorization: Bearer'],
      say="Connecting is where Azure differs from calling OpenAI directly, and it's where we hit a wall: a four oh one, permission denied, on the handshake. The checklist we used is worth knowing. Use the Azure resource's own key, not an OpenAI key. The endpoint is your resource's address, exactly, with no extra path and no trailing slash. The preview-era WebSocket URL adds slash open A I slash realtime, an A P I version, and the name of your deployment. And the key goes in a header called api key, not the usual authorization bearer header."),
 dict(id='audio', title='The hard part: audio formats', hl=['twilio', 'app', 'aoai'],
      bullets=['Phone audio: G.711 μ-law, 8,000 samples a second', 'Model audio by default: 16-bit PCM at 24,000', 'With the default, convert and resample both ways', 'Get it wrong: static, distortion, dropped calls'],
      say="The hardest part was audio. The phone network speaks G seven eleven, mu law: eight thousand samples a second, squeezed into eight bits each. The model's default audio is sixteen bit PCM, at twenty four thousand samples a second. With that default, everything in between has to convert and resample, in both directions, in steady chunks, and wrap each chunk in the right message format. Get any of that wrong, and the caller hears static, a distorted voice, or a dropped call. We heard all three while testing in November and December. The Realtime API can also take mu law directly, which is the route the later rebuild took."),
 dict(id='deploy', kind='cards', title='Getting it to start on App Service',
      cards=[('Missing packages', 'When requirements.txt wasn’t processed, packages like requests were missing and the app failed on import.'),
             ('Up, but not running', 'Gunicorn could be listening while its worker had failed to load main:app, so the site looked alive but wasn’t.'),
             ('Two servers, two ports', 'A local app.run on port 5050 was flagged as a possible conflict with Gunicorn on port 8000 in the cloud.')],
      say="Deploying taught its own lessons. When requirements dot T X T wasn't processed, packages like requests were missing, and the app failed on import. Gunicorn could be listening while its worker had failed to load the app, so the site looked alive but wasn't. And a local development line, app dot run on port five oh five oh, was flagged as a possible conflict with Gunicorn on port eight thousand in the cloud. Most were traced through the startup logs."),
 dict(id='speed', title='Pickup speed', hl=['caller', 'twilio', 'app'],
      bullets=['Early pickup: roughly 20 to 40 seconds; target about 10', 'Proposed: answer the webhook first, set up after', 'Proposed: Always On to avoid cold starts', 'Proposed: time each step, webhook to first audio'],
      say="Then, speed. Early on, calls took roughly twenty to forty seconds to pick up, and the target was closer to ten. The proposed fixes: answer Twilio's webhook immediately, and do slow setup after the stream opens. Watch for cold starts, which App Service's Always On setting helps prevent. And time each step: the webhook, the socket opening, the model being ready, and the first audio back to the caller. You can't fix what you don't measure."),
 dict(id='around', title='Beyond the conversation', hl=['app', 'google'],
      bullets=['Google Calendar, Gmail and Sheets integrations in the code', 'Voicemail text notifications, added in December', 'Function calling: how a voice agent takes action', 'Not confirmed in LunaPhone’s records'],
      say="Around the conversation, the code included Google Calendar, Gmail, and Google Sheets integrations, and in December, voicemail text notifications were added. The Realtime API also supports function calling, the standard way a voice agent takes action: the model asks your code to do something, your code does it, and the model reports back. LunaPhone's records don't confirm which actions were live, so we won't claim them."),
 dict(id='voice', kind='table', title='One realtime model, or a voice pipeline?',
      head=('', 'One realtime model', 'Separate voice vendor'),
      rows=[('Pieces', 'One service', 'Speech-to-text, a model, a voice engine'), ('Added delay', 'None from chaining', 'Roughly 200 to 500 ms'), ('Failure points', 'Fewer', 'More'), ('Vendors to review', 'One', 'Another one')],
      say="We also weighed the voice. Dedicated voice companies, like ElevenLabs, sound great, so why not use one? Because it means either a second platform to review, or a split pipeline: speech recognition, then a language model, then a separate voice engine. Splitting adds roughly two hundred to five hundred milliseconds, more points of failure, and another vendor to review. The key insight was this: a voice company makes voices, but the reasoning comes from the language model. So in December, we decided to keep one realtime model doing all three jobs."),
 dict(id='next', kind='cards', title='What came after Azure',
      cards=[('Jan 2026: Railway', 'Twilio ConversationRelay: Twilio handles speech, the app works in text with a smaller OpenAI model.'),
             ('Feb 2026: Cloudflare', 'A Worker with a Durable Object per call, talking to OpenAI Realtime directly. Phone audio passes straight through as μ-law: no conversion.'),
             ('Mar 2026: gpt-realtime-1.5', 'The newer realtime model, with each call’s transcript saved to KV when it ends.')],
      say="LunaPhone kept evolving. In January it moved to Railway, and tried Twilio's ConversationRelay, a text based mode where Twilio handles the speech. In February it was rebuilt on a Cloudflare Worker, with a Durable Object holding each call, talking to OpenAI's Realtime API directly. The big win there: the phone's mu law audio passed straight through, because the Worker asked the model for mu law directly, so that whole class of conversion bugs went away. In March it moved to the newer gpt realtime one point five model."),
 dict(id='vs', kind='table', title='When is Azure the right home?',
      head=('', 'Azure', 'Cloudflare'),
      rows=[('Models', 'OpenAI models in your own Azure subscription', 'Call OpenAI directly'), ('App platform', 'App Service: a familiar web app host', 'Workers at the edge'), ('Per-call state', 'One process holds both sockets', 'A Durable Object per call'), ('Fits best', 'Clients already on Microsoft', 'Edge-first, fast launches')],
      say="So when is Azure the right home? Azure fits when a client already runs on Microsoft, and wants OpenAI models inside their own Azure subscription, under their existing agreements and controls, on a familiar platform like App Service. Cloudflare fits edge-first apps that need to launch fast, with a Durable Object per call keeping each conversation's state. Both can work. The choice follows the client."),
 dict(id='pitch', kind='quote', title='How to say it in one breath',
      quote='I built an AI phone agent that took calls on a real Twilio number. Twilio streamed each call over a WebSocket to a Python service on Azure App Service, which bridged it to the Azure OpenAI Realtime API, so one model heard, reasoned and spoke. I solved an Azure authentication failure, worked on App Service startup, audio conversion and pickup speed, then rebuilt it on Cloudflare with no audio conversion at all.',
      tags=['Telephony', 'Real-time audio', 'Cloud platform', 'AI', 'Debugging'],
      say="Here's how to describe it in one breath. I built an AI phone agent that took calls on a real Twilio number. Twilio streamed each call over a WebSocket to a Python service on Azure App Service, which bridged it to the Azure OpenAI Realtime API, so one model heard, reasoned, and spoke. I solved an Azure authentication failure, worked on App Service startup, audio conversion, and pickup speed, then rebuilt it on Cloudflare with no audio conversion at all. That covers telephony, real-time audio, cloud platforms, A I, and debugging."),
 dict(id='close', kind='title', title='One call, many pieces',
      sub='Twilio  ·  Azure App Service  ·  Azure OpenAI Realtime  ·  lunaphone.ai',
      say="One phone call, many pieces: a phone network, a webhook, two WebSockets, a cloud platform, and a model that listens and speaks. You've now seen every one of them, and the real problems behind them."),
]

NODES = {  # id: (x, y, w, h, label, sub)
 'caller': (10, 190, 130, 80, 'Caller', 'any phone'),
 'twilio': (205, 190, 165, 80, 'Twilio', 'number, TwiML'),
 'app': (435, 190, 195, 80, 'App Service', 'Python, Flask'),
 'aoai': (695, 190, 205, 80, 'Azure OpenAI', 'Realtime API'),
 'google': (420, 330, 225, 80, 'Google', 'Calendar, Gmail, Sheets'),
 'settings': (10, 470, 280, 80, 'App settings', 'endpoint, key'),
 'oryx': (315, 470, 280, 80, 'Oryx build', 'requirements.txt'),
 'plan': (620, 470, 280, 80, 'Linux B1 plan', 'Python 3.11'),
}

def diagram(hl):
    out = ['<svg viewBox="0 0 910 570" class="dia" xmlns="http://www.w3.org/2000/svg">',
           '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs>']
    def two_way(x1, x2, y):
        return f'<path d="M{x1+4} {y} L{x2-4} {y}" class="ln" marker-start="url(#a)" marker-end="url(#a)"/>'
    out.append(two_way(140, 205, 230))
    out.append(two_way(370, 435, 230))
    out.append(two_way(630, 695, 230))
    out.append('<text x="402" y="176" class="el" text-anchor="middle">WebSocket</text>')
    out.append('<text x="662" y="176" class="el" text-anchor="middle">WebSocket</text>')
    out.append('<text x="172" y="176" class="el" text-anchor="middle">phone</text>')
    out.append('<path d="M532 270 L532 326" class="ln" marker-end="url(#a)"/>')
    out.append('<line x1="20" y1="440" x2="890" y2="440" class="rule"/>')
    for n, (x, y, w, h, label, sub) in NODES.items():
        on = n in hl
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" class="{"on" if on else "off"}"/>')
        out.append(f'<text x="{x+w/2}" y="{y+35}" class="nl" text-anchor="middle">{html.escape(label)}</text>')
        out.append(f'<text x="{x+w/2}" y="{y+60}" class="ns" text-anchor="middle">{html.escape(sub)}</text>')
    out.append('</svg>')
    return ''.join(out)

exec(open(D / '_css.txt').read())
CSS += '.dia .el{fill:#fff;font:600 16px Inter,sans-serif}'

def slide(i, s):
    n = len(S)
    eyebrow = f'{i+1:02d} / {n} &nbsp;&middot;&nbsp; LunaPhone on Azure'
    kind = s.get('kind')
    if kind == 'title':
        body = f'<div class="wrap title"><div class="eyebrow">NOOMA Engineering</div><h1>{html.escape(s["title"])}</h1><div class="sub">{html.escape(s["sub"])}</div></div>'
    elif kind == 'cards':
        cards = ''.join(f'<div class="card"><h3>{html.escape(t)}</h3><p>{html.escape(p)}</p></div>' for t, p in s['cards'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><div class="cards">{cards}</div></div>'
    elif kind == 'table':
        head = ''.join(f'<th>{html.escape(h)}</th>' for h in s['head'])
        rows = ''.join('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in r) + '</tr>' for r in s['rows'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><table><tr>{head}</tr>{rows}</table></div>'
    elif kind == 'quote':
        tags = ''.join(f'<span class="tag">{html.escape(t)}</span>' for t in s['tags'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><blockquote>{html.escape(s["quote"])}</blockquote><div class="tags">{tags}</div></div>'
    else:
        lis = ''.join(f'<li>{html.escape(b)}</li>' for b in s['bullets'])
        body = f'<div class="wrap"><div class="eyebrow">{eyebrow}</div><h1>{html.escape(s["title"])}</h1><div class="cols"><ul>{lis}</ul>{diagram(s["hl"])}</div></div>'
    foot = f'<div class="foot"><span>NOOMA Engineering</span><span>{FOOT}</span></div>' if kind != 'title' else ''
    bar = f'<div class="bar" style="width:{(i+1)/n*100:.2f}%"></div>'
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>{body}{foot}{bar}</body></html>'

for i, s in enumerate(S):
    (D / 'slides' / f'{i:02d}_{s["id"]}.html').write_text(slide(i, s), encoding='utf-8')
(D / 'script.json').write_text(json.dumps([{'id': s['id'], 'say': s['say']} for s in S], indent=1))
words = sum(len(s['say'].split()) for s in S)
print(f'{len(S)} slides; {words} words (~{words/150:.1f} min)')
