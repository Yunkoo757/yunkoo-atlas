from pathlib import Path
from playwright.sync_api import sync_playwright
import json
out=Path(__file__).resolve().parent
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((out/'index.html').as_uri(),wait_until='networkidle')
    page.screenshot(path=str(out/'demo-export.png'),full_page=True)
    page.locator('#exportBtn').click()
    assert page.locator('#exportBtn').is_disabled()
    page.wait_for_function("document.querySelector('#exportState').dataset.state==='success'")
    checks.append('export: busy -> success')
    page.locator('#fail').check()
    page.locator('#exportBtn').click()
    page.wait_for_function("document.querySelector('#exportState').dataset.state==='error'")
    assert page.locator('#exportBtn').inner_text()=='重试导出'
    page.locator('#fail').uncheck()
    page.locator('#exportBtn').click()
    page.wait_for_function("document.querySelector('#exportState').dataset.state==='success'")
    checks.append('export: error -> retry -> success')
    page.locator('#reset').click()
    page.locator('#exportBtn').click()
    page.locator('#reset').click()
    assert page.locator('#exportState').inner_text()=='等待操作'
    checks.append('export: reset clears pending timer')
    page.locator('[data-page=folder]').click()
    page.screenshot(path=str(out/'demo-folder.png'),full_page=True)
    page.locator('.collection').nth(3).focus()
    page.keyboard.press('Enter')
    assert page.locator('#collectionTitle').inner_text()=='复杂回调中的多周期判断与执行边界'
    page.locator('#back').click()
    assert page.locator('.collection').nth(3).evaluate('(el)=>el===document.activeElement')
    page.locator('#listMode').click()
    assert page.locator('#collections').get_attribute('class')=='collections list'
    checks.append('collection: keyboard open, back restores focus, list mode')
    page.locator('[data-page=search]').click()
    page.locator('#query').fill('回踩')
    assert page.locator('#searchResults li').count()==1
    page.locator('#query').fill('no-match')
    assert page.locator('#searchResults li').count()==0
    page.keyboard.press('Escape')
    assert page.locator('#searchResults li').count()==4
    page.locator('#query').dispatch_event('compositionstart')
    page.locator('#query').fill('回踩')
    assert page.locator('#searchResults li').count()==4
    page.locator('#query').dispatch_event('compositionend')
    assert page.locator('#searchResults li').count()==1
    checks.append('search: filter, empty, Esc, synthetic IME composition')
    geometry=[]
    for width in [1440,1024]:
        page.set_viewport_size({'width':width,'height':800})
        for name in ['export','folder','search']:
            page.locator(f'[data-page={name}]').click()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            geometry.append(page.evaluate('''()=>({width:innerWidth, page:document.querySelector('section:not([hidden])').id,title:getComputedStyle(document.querySelector('h1')).fontSize,button:getComputedStyle(document.querySelector('#exportBtn')).height,bodyFont:getComputedStyle(document.body).fontSize})'''))
        page.locator('[data-page=folder]').click()
        page.locator('#cardsMode').click()
        page.screenshot(path=str(out/f'demo-folder-{width}.png'),full_page=True)
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.collection').first.evaluate('(el)=>getComputedStyle(el).transitionDuration')=='0s'
    checks.append('1440/1024 layouts: no horizontal overflow; reduced motion')
    assert not errors,errors
    (out/'verification.json').write_text(json.dumps({'checks':checks,'geometry':geometry,'errors':errors,'limits':['Edge on Windows, device scale 1','Synthetic IME events only; native IME and macOS not tested','Independent HTML only; no production Electron integration']},ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print(json.dumps(checks,ensure_ascii=False))
