import asyncio, glob, os
from playwright.async_api import async_playwright
D=str(__import__('pathlib').Path(__file__).resolve().parent/'slides')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await b.new_page(viewport={'width':1920,'height':1080}, device_scale_factor=1)
        for f in sorted(glob.glob(D+'/*.html')):
            await pg.goto('file://'+f); await pg.wait_for_timeout(150)
            await pg.screenshot(path=f[:-5]+'.png')
        await b.close()
asyncio.run(main())
