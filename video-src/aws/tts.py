import json, subprocess, concurrent.futures as cf, os
D=str(__import__('pathlib').Path(__file__).resolve().parent)
script=json.load(open(D+'/script.json'))
INSTR="Warm, clear and confident, like a senior cloud architect teaching a friend. Moderate pace, natural pauses between sentences."
def one(i_s):
    i,s=i_s; out=f"{D}/audio/{i:02d}_{s['id']}.mp3"
    body=json.dumps({"model":"gpt-4o-mini-tts","voice":"echo","input":s['say'],"instructions":INSTR,"response_format":"mp3"})
    for attempt in range(3):
        r=subprocess.run(['curl','-s','-o',out,'-w','%{http_code}','https://api.openai.com/v1/audio/speech','-H','Authorization: Bearer proxy-injected','-H','Content-Type: application/json','-d',body],capture_output=True,text=True)
        if r.stdout=='200' and os.path.getsize(out)>10000: break
    d=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',out],capture_output=True,text=True).stdout.strip()
    return i,s['id'],r.stdout,d
with cf.ThreadPoolExecutor(6) as ex:
    res=sorted(ex.map(one,enumerate(script)))
tot=0
for i,id_,code,d in res: print(i,id_,code,d); tot+=float(d or 0)
print('total seconds',round(tot,1))
