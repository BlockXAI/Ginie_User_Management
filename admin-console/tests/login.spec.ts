import { test, expect } from '@playwright/test'

const UI_BASE_URL = process.env.UI_BASE_URL || 'http://localhost:3000'
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'arpit2005singh@gmail.com'
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin'

test('admin can login with OTP (dev provider)', async ({ page, request }) => {
  // Open login page
  await page.goto(UI_BASE_URL + '/')
  await page.getByPlaceholder('Email').fill(ADMIN_EMAIL)
  await page.getByPlaceholder('Name').fill(ADMIN_NAME)
  await page.getByRole('button', { name: 'Send OTP' }).click()

  // Fetch OTP from dev helper
  const r = await request.get(`${API_BASE_URL}/u/dev/otp?email=${encodeURIComponent(ADMIN_EMAIL)}`)
  expect(r.ok()).toBeTruthy()
  const j = await r.json()
  const code = j.code as string
  expect(code).toBeTruthy()

  // Submit code
  await page.getByPlaceholder('One-time code').fill(code)
  await page.getByRole('button', { name: 'Verify & Continue' }).click()

  // Expect admin dashboard
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByText('Admin Dashboard')).toBeVisible()
  await expect(page.getByText(ADMIN_EMAIL)).toBeVisible()
})
