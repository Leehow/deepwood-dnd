/**
 * E2E tests for unified translation layer
 * Verifies that damage types, weapon properties, and spell schools display in Chinese
 */

import { test, expect } from '@playwright/test';

test.describe('Unified Translation Layer', () => {
  test.beforeEach(async ({ page }) => {
    // Wait for dictionary to initialize
    await page.goto('/');
    await page.waitForTimeout(1000); // Give dictionary time to load
  });

  test('should translate damage types in equipment selection', async ({ page }) => {
    // Navigate to character creation
    await page.goto('/character/create');
    
    // Wait for page to load
    await page.waitForSelector('text=创建角色', { timeout: 10000 });
    
    // Look for Chinese damage type translations (not English)
    // This test will pass if we see "穿刺", "挥砍", "钝击" instead of "piercing", "slashing", "bludgeoning"
    const pageContent = await page.content();
    
    // Should NOT contain English damage types in UI
    expect(pageContent).not.toContain('piercing');
    expect(pageContent).not.toContain('slashing');
    expect(pageContent).not.toContain('bludgeoning');
  });

  test('should translate spell schools correctly', async ({ page }) => {
    // This test verifies that enchantment school shows as "惑控" not "附魔"
    await page.goto('/character/create');
    
    const pageContent = await page.content();
    
    // If spell schools are visible, they should be in Chinese
    // Enchantment should be "惑控" specifically
    if (pageContent.includes('enchantment')) {
      // If we see the English ID, it should be accompanied by Chinese translation
      expect(pageContent).toContain('惑控');
    }
  });

  test('should translate weapon properties', async ({ page }) => {
    await page.goto('/character/create');
    
    const pageContent = await page.content();
    
    // Should NOT contain English weapon properties in UI
    expect(pageContent).not.toContain('finesse');
    expect(pageContent).not.toContain('heavy');
    expect(pageContent).not.toContain('reach');
  });

  test('dictionary should be initialized on app load', async ({ page }) => {
    await page.goto('/');
    
    // Check that dictionary initialization doesn't cause errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    
    // Filter out known non-critical errors
    const criticalErrors = errors.filter(err => 
      err.includes('dictionary') || 
      err.includes('translation') ||
      err.includes('i18n')
    );
    
    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Item Display Translation', () => {
  test('should translate damage types in item details', async ({ page }) => {
    // This test assumes there's a way to view item details
    // Skip if not applicable to current UI state
    test.skip(!process.env.TEST_ITEM_DETAILS, 'Item details UI not available');
    
    await page.goto('/character/create');
    
    // Look for any item cards or equipment displays
    const itemCards = await page.locator('[class*="item"]').all();
    
    for (const card of itemCards) {
      const text = await card.textContent();
      if (text) {
        // Should not contain English damage types
        expect(text).not.toMatch(/\b(piercing|slashing|bludgeoning|fire|cold|lightning|thunder|acid)\b/);
      }
    }
  });
});

test.describe('Proficiency Translation', () => {
  test('should translate armor proficiencies', async ({ page }) => {
    await page.goto('/character/create');
    
    const pageContent = await page.content();
    
    // Should NOT contain English armor proficiency terms
    expect(pageContent).not.toContain('light_armor');
    expect(pageContent).not.toContain('medium_armor');
    expect(pageContent).not.toContain('heavy_armor');
  });

  test('should translate weapon proficiencies', async ({ page }) => {
    await page.goto('/character/create');
    
    const pageContent = await page.content();
    
    // Should NOT contain English weapon proficiency terms
    expect(pageContent).not.toContain('simple_weapons');
    expect(pageContent).not.toContain('martial_weapons');
  });
});

