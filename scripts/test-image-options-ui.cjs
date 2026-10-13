const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('../taskpane/node_modules/@playwright/test');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'image-options');
fs.mkdirSync(output, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAmElEQVR4nO3QMQHAIADAMJh7XmSgcgqgBpK3X+c+a3D3PRoGNYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwKBgUDAoGBYOCQcGgYFAwaLz9No0CRVOX1MkAAAAASUVORK5CYII=', 'base64');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1120, height: 940 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', async response => { if (response.status() >= 400 && response.url().includes('/local/')) console.log('HTTP', response.status(), await response.text()); });
    await page.addInitScript(() => {
      window.insertions = [];
      window.savedImages = [];
      window.chrome = { webview: { postMessage: () => {}, addEventListener: () => {}, removeEventListener: () => {}, hostObjects: { sandunOffice: {
        CaptureSvgTarget: async () => 'slide',
        InsertSvg: async (svg, target, kind) => { window.insertions.push({ svg, kind }); return 'shape'; },
        SaveGeneratedImage: async (url, name) => { window.savedImages.push(url); return 'fixture.png'; },
      } } } };
    });
    await page.goto('http://127.0.0.1:17767/?host=native&tool=image');
    const baseline = (await (await page.request.get('http://127.0.0.1:17767/fixture/image-requests')).json()).length;
    async function model(name) {
      await page.evaluate(async model => {
        const boot = await (await fetch('/local/bootstrap')).json();
        const response = await fetch('/local/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-PPTagent-Client': 'taskpane-v1', 'X-PPTagent-CSRF': boot.csrfToken }, body: JSON.stringify({ image: { model, base_url: 'https://fixture.example.test/v1', api_key: 'test-placeholder' } }) });
        if (!response.ok) throw Error(await response.text());
      }, name);
      await page.reload();
    }
    await model('gpt-image-2.5-sunburst');
    await expect(page.getByRole('group', { name: '图片设置', exact: true })).toBeVisible();
    await page.getByLabel('图片描述').fill('参考图片中的主体与自然配色，生成一张留白充足的演示插图。');
    await page.getByLabel('输出尺寸', { exact: true }).selectOption('1');
    await page.getByLabel('画面质量', { exact: true }).selectOption('xhigh');
    await page.getByLabel('图片格式', { exact: true }).selectOption('jpeg');
    await page.getByLabel('压缩质量', { exact: true }).fill('75');
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByAltText('AI 生成结果')).toBeVisible();
    let calls = await (await page.request.get('http://127.0.0.1:17767/fixture/image-requests')).json();
    let last = calls.at(-1);
    expect(last.path).toBe('/v1/images/generations');
    expect(last.fields).toMatchObject({ size: '2560x1440', quality: 'xhigh', output_format: 'jpeg', output_compression: 75 });
    expect(last.references).toEqual([]);

    await page.getByLabel('背景处理', { exact: true }).selectOption('transparent');
    await expect(page.getByLabel('图片格式', { exact: true })).toHaveValue('png');
    await expect(page.getByLabel('压缩质量', { exact: true })).toHaveCount(0);
    await page.getByLabel('上传参考图').setInputFiles([
      { name: '自然配色.png', mimeType: 'image/png', buffer: png },
      { name: '主体参考.png', mimeType: 'image/png', buffer: png },
    ]);
    await expect(page.getByAltText('参考图 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '移除参考图 1', exact: true }).click();
    await expect(page.getByAltText('参考图 2', { exact: true })).toHaveCount(0);
    await page.getByLabel('上传参考图').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
    await expect(page.getByText('参考图无法打开，请选择完整有效的图片。')).toBeVisible();
    await expect(page.getByAltText('参考图 1', { exact: true })).toBeVisible();
    await page.getByLabel('上传参考图').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') });
    await expect(page.getByText('请选择 PNG、JPEG 或 WebP 图片。')).toBeVisible();
    await page.getByLabel('上传参考图').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
    await expect(page.getByText('单张参考图不能超过 8 MB，且不能是空文件。')).toBeVisible();
    await page.getByLabel('上传参考图').setInputFiles(Array.from({ length: 4 }, (_, i) => ({ name: i + '.png', mimeType: 'image/png', buffer: png })));
    await expect(page.getByText('最多添加 4 张参考图，请先移除不需要的图片。')).toBeVisible();
    await page.getByLabel('上传参考图').setInputFiles({ name: '配色参考.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByAltText('参考图 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('http://127.0.0.1:17767/fixture/image-requests')).json()).length, { timeout: 10000 }).toBe(baseline + 2);
    await expect(page.getByAltText('AI 生成结果')).toBeVisible();
    calls = await (await page.request.get('http://127.0.0.1:17767/fixture/image-requests')).json();
    last = calls.at(-1);
    expect(last.path).toBe('/v1/images/edits');
    expect(last.references).toEqual(['image/png', 'image/png']);
    expect(last.fields).toMatchObject({ background: 'transparent', output_format: 'png', size: '2560x1440' });
    expect(last.fields.output_compression).toBeUndefined();
    await page.getByRole('button', { name: '插入当前页', exact: true }).click();
    await expect(page.getByText('图片已插入当前页面，可在幻灯片中移动和缩放。')).toBeVisible();
    await page.getByRole('button', { name: '保存为文件', exact: true }).click();
    await expect(page.getByText('图片已保存至：fixture.png')).toBeVisible();

    await page.getByLabel('图片描述').fill('[模拟失败]保留参考主体' + Date.now());
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByText('接口额度不足或请求过于频繁')).toBeVisible();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByAltText('AI 生成结果')).toBeVisible();
    await expect(page.getByAltText('参考图 2', { exact: true })).toBeVisible();

    await model('GPT-Image-2.5-Flare');
    await page.getByLabel('图片描述').fill('清晨的鲜活食材，米白底色与苔绿色点缀，柔和自然光，留白充足。');
    await page.screenshot({ path: path.join(output, 'image-settings-wide.png'), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 460, height: 860 });
    await page.screenshot({ path: path.join(output, 'image-settings-narrow.png'), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByLabel('画面质量', { exact: true }).selectOption('max');
    await page.getByRole('group', { name: '画面比例', exact: true }).getByRole('button', { name: '9:16', exact: true }).click();
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByAltText('AI 生成结果')).toBeVisible();
    calls = await (await page.request.get('http://127.0.0.1:17767/fixture/image-requests')).json();
    expect(calls.at(-1).fields).toMatchObject({ model: 'GPT-Image-2.5-Flare', quality: 'max', size: '864x1536' });

    await model('another-image-model');
    await expect(page.getByRole('group', { name: '图片设置', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('上传参考图')).toHaveCount(0);
    await page.getByLabel('图片描述').fill('普通图片');
    await page.getByRole('button', { name: '生成', exact: true }).click();
    await expect(page.getByAltText('AI 生成结果')).toBeVisible();
    calls = await (await page.request.get('http://127.0.0.1:17767/fixture/image-requests')).json();
    expect(calls.at(-1).fields).toEqual({ model: 'another-image-model', prompt: '普通图片', n: 1, size: '1536x1024' });
    expect(errors).toEqual([]);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, upstream: 'httpx fixture', nativeBridge: 'simulated', checks: ['Sunburst and Flare detection', 'JPEG compression', 'transparent PNG switch', 'multipart references', 'invalid/corrupt/oversized files', '4-image limit', 'remove reference', 'retry preserves input', 'insert and save', 'wide and narrow layout', 'other model unchanged'], requests: calls }, null, 2));
    console.log('PASS image settings, multipart references, errors/retry, insert/save, model gating, responsive UI');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
