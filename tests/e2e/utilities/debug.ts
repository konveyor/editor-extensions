import { Locator } from 'playwright-core';

export async function debugElement(locator: Locator, name = 'ELEMENT') {
  console.log(`\n\n===== DEBUG DUMP FOR ${name} =====`);

  // 1. Count
  const count = await locator.count();
  console.log(`Count: ${count}`);
  if (count === 0) {
    console.log('Element not found at all!');
    return;
  }

  const el = locator.first();

  // 2. Outer HTML
  try {
    const html = await el.evaluate((node) => node.outerHTML);
    console.log('\n--- OuterHTML ---\n', html);
  } catch (e) {
    console.log('Cannot get outerHTML:', e);
  }

  // 3. Attributes
  try {
    const attrs = await el.evaluate((node) => {
      const out: Record<string, string | null> = {};
      for (const attr of node.getAttributeNames()) {
        out[attr] = node.getAttribute(attr);
      }
      return out;
    });
    console.log('\n--- Attributes ---\n', attrs);
  } catch (e) {
    console.log('Cannot get attributes:', e);
  }

  // 4. ClassList
  try {
    const classes = await el.evaluate((node) => Array.from(node.classList));
    console.log('\n--- ClassList ---\n', classes);
  } catch (e) {
    console.log('Cannot get class list:', e);
  }

  // 5. Computed Styles
  try {
    const styles = await el.evaluate((node) => {
      const s = window.getComputedStyle(node);
      const result: Record<string, string> = {};
      for (let i = 0; i < s.length; i++) {
        const key = s[i];
        result[key] = s.getPropertyValue(key);
      }
      return result;
    });
    console.log('\n--- Computed Styles ---\n', styles);
  } catch (e) {
    console.log('Cannot get computed styles:', e);
  }

  // 6. Visibility / State
  console.log('\n--- Visibility/State ---');
  console.log('isVisible:', await el.isVisible());
  console.log('isHidden:', await el.isHidden());
  console.log('isEnabled:', await el.isEnabled().catch(() => 'N/A'));
  console.log('isEditable:', await el.isEditable().catch(() => 'N/A'));

  // 7. Bounding Box
  try {
    console.log('\n--- BoundingBox ---\n', await el.boundingBox());
  } catch (e) {
    console.log('Cannot get bounding box:', e);
  }

  // 8. Text Content
  try {
    console.log('\n--- TextContent ---\n', await el.textContent());
  } catch (e) {
    console.log('Cannot get text content:', e);
  }

  console.log('===== END DEBUG DUMP =====\n\n');
}
