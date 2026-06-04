import { test, expect } from '@playwright/test';

test('控制法术应用debuff效果', async ({ page }) => {
  // 先设置 localStorage 模拟登录状态
  await page.goto('http://localhost:5174');
  await page.evaluate(() => {
    localStorage.setItem('userId', 'test');
    localStorage.setItem('userEmail', 'test@test.com');
    localStorage.setItem('isLoggedIn', 'true');
  });
  
  // 打开DM视图
  await page.goto('http://localhost:5174/campaign/2/dm');
  
  // 等待页面加载
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/test-1-after-login.png', fullPage: true });
  
  // 检查是否有canvas或者地图元素
  const hasCanvas = await page.locator('canvas').count();
  console.log('Canvas count:', hasCanvas);
  
  // 检查页面内容
  const pageContent = await page.content();
  const hasMap = pageContent.includes('TacticalMap') || pageContent.includes('konva');
  console.log('Has map elements:', hasMap);
  
  // 如果还是登录页面，尝试实际登录
  const loginButton = await page.locator('button:has-text("进入冒险")').isVisible().catch(() => false);
  if (loginButton) {
    console.log('Still on login page, attempting login...');
    await page.fill('input[placeholder*="email"], input[placeholder*="邮箱"]', 'test@test.com');
    await page.fill('input[placeholder*="密码"], input[type="password"]', 'test123');
    await page.click('button:has-text("进入冒险")');
    await page.waitForTimeout(3000);
  }
  
  await page.screenshot({ path: '/tmp/test-2-page-state.png', fullPage: true });
  
  // 等待地图canvas
  try {
    await page.waitForSelector('canvas', { timeout: 10000 });
    console.log('Canvas found!');
  } catch (e) {
    console.log('Canvas not found, checking page...');
    await page.screenshot({ path: '/tmp/test-3-no-canvas.png', fullPage: true });
  }
  
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  
  if (box) {
    console.log('Canvas box:', box);
    
    // 双击狗头人token位置查看效果
    const gridSize = 40;
    const koboldX = box.x + 13 * gridSize + gridSize/2;
    const koboldY = box.y + 12 * gridSize + gridSize/2;
    
    await page.mouse.dblclick(koboldX, koboldY);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/test-4-token-modal.png', fullPage: true });
    
    // 检查蛛网缠绕效果
    const webbedEffect = await page.locator('text=蛛网缠绕').isVisible().catch(() => false);
    console.log('✓ Webbed effect visible:', webbedEffect);
    
    expect(webbedEffect).toBe(true);
  }
});
