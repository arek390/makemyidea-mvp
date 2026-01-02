import { expect, test, type Page } from '@playwright/test'

const completeSessionNamePrompt = async (page: Page) => {
  const input = page.getByTestId('session-name-input')
  try {
    await input.waitFor({ state: 'attached', timeout: 500 })
  } catch {
    return
  }
  await input.fill('Test session')
  await page.getByTestId('session-name-save').click()
}

test.describe('engine facilitation flow', () => {
  test('facilitation buttons are hidden before interaction', async ({ page }) => {
    await page.goto('/engine?e2e=1')
    await expect(page.getByTestId('facilitation-buttons')).toHaveCount(0)
  })

  test('idle shows facilitation buttons after first click', async ({ page }) => {
    await page.goto('/engine?e2e=1')
    await page.getByTestId('engine-input').click()
    await expect(page.getByTestId('facilitation-buttons')).toBeVisible({ timeout: 2000 })
  })

  test('add entry hides buttons then shows after grace + idle', async ({ page }) => {
    await page.goto('/engine?e2e=1')
    await page.getByTestId('engine-input').click()
    await page.getByTestId('engine-input').fill('Test entry A')
    await page.getByTestId('add-entry').click()
    await completeSessionNamePrompt(page)
    await expect(page.getByTestId('facilitation-buttons')).toHaveCount(0)
    await page.getByTestId('engine-input').click()
    await expect(page.getByTestId('facilitation-buttons')).toBeVisible({ timeout: 2000 })
  })

  test('session switch resets facilitation arming', async ({ page }) => {
    await page.goto('/engine?e2e=1')
    await page.getByTestId('session-create').click()
    await page.getByTestId('engine-input').click()
    await page.getByTestId('engine-input').fill('Test entry B')
    await page.getByTestId('add-entry').click()
    await completeSessionNamePrompt(page)
    await page.getByTestId('session-close').click()
    await page.getByTestId('session-create').click()
    await expect(page.getByTestId('facilitation-buttons')).toHaveCount(0)
    await page.getByTestId('engine-input').click()
    await expect(page.getByTestId('facilitation-buttons')).toBeVisible({ timeout: 2000 })
  })

  test('matrix coverage updates after adding entry', async ({ page }) => {
    await page.goto('/engine?e2e=1')
    const before = await page.getByTestId('matrix-coverage').innerText()
    await page.getByTestId('engine-input').click()
    await page.getByTestId('engine-input').fill('Test entry C')
    await page.getByTestId('add-entry').click()
    await completeSessionNamePrompt(page)
    await expect(page.getByTestId('matrix-coverage')).not.toHaveText(before)
  })
})
