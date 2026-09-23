from pathlib import Path
from playwright.sync_api import sync_playwright
import hashlib,json
out=Path(__file__).resolve().parent
errors=[];requests=[];checks=[]
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True)
    page=b.new_page(viewport={'width':1440,'height':1050})
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('requestfailed',lambda r:requests.append(r.url))
    page.goto((out/'showroom.html').as_uri())
    for slug in ['folder-tab-card','flower-sidebar','hero-morph-navbar','curtain-reveal-navbar','soft-aurora']:
        page.evaluate('(slug)=>window.__SHOWROOM__.select(slug)',slug)
        page.locator('button[data-mode=original]').click()
        page.wait_for_function("document.querySelector('#status').textContent.includes('可操作')")
        page.wait_for_timeout(400)
        frame=page.locator('iframe').content_frame
        images=frame.locator('img').evaluate_all('(imgs)=>imgs.map(i=>({loaded:i.complete&&i.naturalWidth>0,src:i.src.slice(0,35)}))')
        assert all(i['loaded'] for i in images),(slug,images)
        checks.append({'slug':slug,'images':images})
    page.evaluate("window.__SHOWROOM__.select('perspective-flip-deck')")
    page.locator('button[data-mode=compare]').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('可操作')")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out/'showroom-final.png'),full_page=True)
    assert not errors,errors
    assert not requests,requests
    b.close()
data=(out/'showroom.html').read_bytes()
(out/'package-verification.json').write_text(json.dumps({'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'checks':checks,'errors':errors,'failedRequests':requests},ensure_ascii=False,indent=2),encoding='utf-8')
print('Final single-file assets: passed; errors: 0; failed requests: 0')
