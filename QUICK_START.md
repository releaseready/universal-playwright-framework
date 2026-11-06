# Playwright Framework - Quick Start

Get up and running with the Playwright framework in minutes.

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Git (for submodule usage)

## Quick Setup

### 1. Initialize Framework

```bash
cd test-frameworks/playwright-framework
./scripts/init.sh
```

This script will:
- Install all dependencies
- Install Playwright browsers
- Create required directories
- Set up environment configuration
- Build TypeScript files

### 2. Verify Installation

```bash
# Run a simple test to verify everything works
npm test -- --grep "should work" --reporter=list
```

### 3. Write Your First Test

Create `tests/e2e/my-first-test.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('my first test', async ({ page }) => {
  await page.goto('https://playwright.dev/');
  
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Playwright/);
  
  // Create a locator
  const getStarted = page.getByRole('link', { name: 'Get started' });
  
  // Expect an attribute "to be strictly equal" to the value.
  await expect(getStarted).toHaveAttribute('href', '/docs/intro');
  
  // Click the get started link.
  await getStarted.click();
  
  // Expects the URL to contain intro.
  await expect(page).toHaveURL(/.*intro/);
});
```

### 4. Run Your Test

```bash
npm test tests/e2e/my-first-test.spec.ts
```

## Usage with Gig Grid

### 1. Create Page Object

```typescript
// gig-grid-pages/login-page.ts
import { BasePage } from '@/pages/base-page';
import { Page, Locator } from '@playwright/test';

export class LoginPage extends BasePage {
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly loginButton: Locator;

  constructor(page: Page) {
    super(page, '/login');
    
    this.emailInput = page.locator('[data-testid="email-input"]');
    this.passwordInput = page.locator('[data-testid="password-input"]');
    this.loginButton = page.locator('[data-testid="login-button"]');
  }

  async login(email: string, password: string): Promise<void> {
    await this.fillInput(this.emailInput, email);
    await this.fillInput(this.passwordInput, password);
    await this.clickElement(this.loginButton);
  }
}
```

### 2. Create Test with Test Data

```typescript
// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';
import { TestDataFactory } from '@fixtures/test-data-factory';
import { LoginPage } from '../gig-grid-pages/login-page';

test('should login successfully', async ({ page }) => {
  const userData = TestDataFactory.generateUser('fan');
  const loginPage = new LoginPage(page);

  await loginPage.goto();
  await loginPage.login(userData.email, userData.password);

  await expect(page).toHaveURL('/dashboard');
});
```

## Essential Commands

```bash
# Development
npm test                    # Run all tests
npm run test:ui            # Open Playwright UI
npm run test:headed        # Run tests with browser visible
npm run test:debug         # Debug tests

# Specific browsers
npm run test:chromium      # Run in Chromium
npm run test:firefox       # Run in Firefox  
npm run test:safari        # Run in Safari

# Reports
npm run report             # View HTML report
npm run report:allure      # View Allure report

# Code quality
npm run lint               # Check code
npm run lint:fix           # Fix linting issues
npm run format             # Format code

# Utilities
npm run clean              # Clean build artifacts
npm run build              # Build TypeScript
```

## Environment Configuration

Update `.env` file for your needs:

```bash
# Set base URL for your environment
BASE_URL=http://localhost:3000

# API endpoint
API_URL=http://localhost:3001/api

# Test configuration
LOG_LEVEL=INFO
HEADLESS=true
BROWSER=chromium
```

## Directory Structure

```
playwright-framework/
├── src/                   # Framework source code
│   ├── pages/            # Base page objects
│   ├── components/       # Reusable components
│   ├── utils/            # Utility functions
│   └── api/              # API client
├── tests/                # Test files
│   ├── e2e/             # End-to-end tests
│   └── api/             # API tests
├── fixtures/             # Test data and fixtures
├── config/               # Environment configs
├── docs/                 # Documentation
└── scripts/              # Setup scripts
```

## Next Steps

1. **Read the guides**:
   - [Page Object Model Guide](docs/page-object-model.md)
   - [Writing Tests Guide](docs/writing-tests.md)
   - [Gig Grid Usage](docs/gig-grid-usage.md)

2. **Explore examples**:
   - Check `tests/` directory for test examples
   - Look at `fixtures/` for test data patterns

3. **Customize for your app**:
   - Create app-specific page objects
   - Add custom test data factories
   - Configure environment settings

4. **Set up CI/CD**:
   - Use provided GitHub Actions workflow
   - Configure test reporting
   - Set up notifications

## Troubleshooting

### Common Issues

**Tests fail with "Cannot find module"**
```bash
npm run build
```

**Browser not found**
```bash
npx playwright install
```

**Permission denied on scripts**
```bash
chmod +x scripts/*.sh
```

**Tests are flaky**
- Use web-first assertions: `await expect(locator).toBeVisible()`
- Wait for the required UI state: `await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled({ timeout: 10000 })`
- Check for race conditions

### Getting Help

1. Check the [documentation](docs/)
2. Review test examples
3. Use Playwright UI for debugging: `npm run test:ui`
4. Enable verbose logging: `LOG_LEVEL=DEBUG npm test`

You're ready to start testing! 🎭

For runnable owned examples and independent style/runner choices, see [Authoring styles](docs/authoring-styles.md).
