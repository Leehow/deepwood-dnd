import { test, expect, Page } from '@playwright/test';

// Test: 玩家关闭骰子请求气泡后，切换 tab 再切回来，气泡不应该再出现
test.describe('Dice Request Bubble Dismiss', () => {
  // 测试用的战役 ID 和用户凭证 - 需要根据实际情况调整
  const TEST_CAMPAIGN_ID = '1'; // 使用已存在的战役
  
  test('玩家关闭骰子气泡后切换tab再切回来应该保持关闭状态', async ({ browser }) => {
    // 创建两个浏览器上下文：一个 DM，一个玩家
    const dmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    
    const dmPage = await dmContext.newPage();
    const playerPage = await playerContext.newPage();
    
    // 开启控制台日志监听
    const playerLogs: string[] = [];
    playerPage.on('console', msg => {
      if (msg.text().includes('[DiceRequest]')) {
        playerLogs.push(msg.text());
      }
    });

    try {
      // Step 1: DM 登录并进入战役
      console.log('Step 1: DM 登录...');
      await dmPage.goto('http://localhost:5174/login');
      await dmPage.waitForLoadState('networkidle');
      
      // 检查是否有登录表单
      const dmLoginForm = await dmPage.locator('input[type="email"], input[name="email"]').first();
      if (await dmLoginForm.isVisible()) {
        // 需要登录 - 使用测试账号
        await dmPage.fill('input[type="email"], input[name="email"]', 'dm@test.com');
        await dmPage.fill('input[type="password"]', 'testpassword');
        await dmPage.click('button[type="submit"]');
        await dmPage.waitForLoadState('networkidle');
      }

      // Step 2: 玩家登录
      console.log('Step 2: 玩家登录...');
      await playerPage.goto('http://localhost:5174/login');
      await playerPage.waitForLoadState('networkidle');
      
      const playerLoginForm = await playerPage.locator('input[type="email"], input[name="email"]').first();
      if (await playerLoginForm.isVisible()) {
        await playerPage.fill('input[type="email"], input[name="email"]', 'player@test.com');
        await playerPage.fill('input[type="password"]', 'testpassword');
        await playerPage.click('button[type="submit"]');
        await playerPage.waitForLoadState('networkidle');
      }

      // Step 3: DM 进入战役 DM 页面
      console.log('Step 3: DM 进入战役...');
      await dmPage.goto(`http://localhost:5174/campaign/${TEST_CAMPAIGN_ID}/dm`);
      await dmPage.waitForLoadState('networkidle');
      await dmPage.waitForTimeout(2000);

      // Step 4: 玩家进入战役玩家页面
      console.log('Step 4: 玩家进入战役...');
      await playerPage.goto(`http://localhost:5174/campaign/${TEST_CAMPAIGN_ID}/player`);
      await playerPage.waitForLoadState('networkidle');
      await playerPage.waitForTimeout(2000);

      // Step 5: 玩家切换到聊天 tab
      console.log('Step 5: 玩家切换到聊天 tab...');
      const chatTab = playerPage.locator('button:has-text("聊天"), [data-value="chat"]').first();
      if (await chatTab.isVisible()) {
        await chatTab.click();
        await playerPage.waitForTimeout(1000);
      }

      // Step 6: DM 发起骰子请求
      console.log('Step 6: DM 发起骰子请求...');
      // 找到聊天输入框并发送骰子请求
      const dmChatTab = dmPage.locator('button:has-text("聊天"), [data-value="chat"]').first();
      if (await dmChatTab.isVisible()) {
        await dmChatTab.click();
        await dmPage.waitForTimeout(500);
      }
      
      const dmInput = dmPage.locator('textarea, input[type="text"]').last();
      if (await dmInput.isVisible()) {
        await dmInput.fill('请进行一次敏捷检定');
        await dmPage.keyboard.press('Enter');
        await dmPage.waitForTimeout(3000); // 等待 AI 处理
      }

      // Step 7: 检查玩家是否看到骰子气泡
      console.log('Step 7: 检查玩家骰子气泡...');
      await playerPage.waitForTimeout(2000);
      
      // 查找 DM 头像旁边的骰子请求气泡
      const diceBubble = playerPage.locator('text=请投检定, text=请投豁免').first();
      const hasBubble = await diceBubble.isVisible().catch(() => false);
      console.log(`骰子气泡是否显示: ${hasBubble}`);

      if (hasBubble) {
        // Step 8: 玩家点击关闭按钮
        console.log('Step 8: 玩家关闭骰子气泡...');
        const closeButton = playerPage.locator('button:has-text("✕")').first();
        if (await closeButton.isVisible()) {
          await closeButton.click();
          await playerPage.waitForTimeout(500);
        }

        // Step 9: 玩家切换到其他 tab
        console.log('Step 9: 玩家切换到角色 tab...');
        const characterTab = playerPage.locator('button:has-text("角色"), [data-value="characters"]').first();
        if (await characterTab.isVisible()) {
          await characterTab.click();
          await playerPage.waitForTimeout(1000);
        }

        // Step 10: 玩家切回聊天 tab
        console.log('Step 10: 玩家切回聊天 tab...');
        await chatTab.click();
        await playerPage.waitForTimeout(2000);

        // Step 11: 检查骰子气泡是否还在
        console.log('Step 11: 检查骰子气泡状态...');
        const bubbleAfterSwitch = playerPage.locator('text=请投检定, text=请投豁免').first();
        const stillVisible = await bubbleAfterSwitch.isVisible().catch(() => false);
        
        console.log(`切换 tab 后骰子气泡是否显示: ${stillVisible}`);
        console.log('玩家控制台日志:', playerLogs.join('\n'));

        // 断言：气泡不应该再出现
        expect(stillVisible).toBe(false);
      } else {
        console.log('未检测到骰子气泡，可能需要调整测试用例');
      }

    } finally {
      await dmContext.close();
      await playerContext.close();
    }
  });
});

