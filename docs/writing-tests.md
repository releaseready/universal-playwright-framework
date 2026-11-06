# Writing Tests Guide

This guide covers best practices for writing maintainable and reliable tests using our Playwright framework.

## Test Structure

### Basic Test Template

```typescript
import { test, expect } from '@playwright/test';
import { TestDataFactory } from '@fixtures/test-data-factory';
import { LoginPage } from '@pages/login-page';
import { DashboardPage } from '@pages/dashboard-page';

test.describe('User Authentication', () => {
  test('should login with valid credentials', async ({ page }) => {
    // Arrange
    const userData = TestDataFactory.generateUser('fan');
    const loginPage = new LoginPage(page);
    
    // Act
    await loginPage.goto();
    await loginPage.login(userData.email, userData.password);
    
    // Assert
    const dashboardPage = new DashboardPage(page);
    await expect(dashboardPage.welcomeMessage).toBeVisible();
    await expect(page).toHaveURL('/dashboard');
  });
});
```

## Test Organization

### 1. Group Related Tests
Use `test.describe` to group related functionality:

```typescript
test.describe('User Registration', () => {
  test.describe('Fan Registration', () => {
    test('should register fan with valid data', async ({ page }) => {
      // Test implementation
    });

    test('should show error with invalid email', async ({ page }) => {
      // Test implementation
    });
  });

  test.describe('Artist Registration', () => {
    test('should register band with members', async ({ page }) => {
      // Test implementation
    });

    test('should register solo artist with instruments', async ({ page }) => {
      // Test implementation
    });
  });
});
```

### 2. Use Descriptive Test Names
Test names should clearly describe what is being tested:

```typescript
// Good
test('should display error when email is already registered')
test('should redirect to dashboard after successful login')
test('should preserve form data when validation fails')

// Avoid
test('email test')
test('login')
test('form validation')
```

## Data-Driven Testing

### Using Test Data Factory

```typescript
test.describe('User Registration Scenarios', () => {
  const userTypes = ['fan', 'band', 'solo_artist'] as const;

  userTypes.forEach(userType => {
    test(`should register ${userType} successfully`, async ({ page }) => {
      const userData = TestDataFactory.generateUser(userType);
      const registrationPage = new UserRegistrationPage(page);

      await registrationPage.goto();
      await registrationPage.registerUser(userData);

      await expect(registrationPage.successMessage).toBeVisible();
    });
  });
});
```

### Parameterized Tests

```typescript
const invalidEmails = [
  'invalid-email',
  '@missing-local.com',
  'missing-domain@',
  'spaces in@email.com',
  'special!chars@domain.com'
];

invalidEmails.forEach(email => {
  test(`should reject invalid email: ${email}`, async ({ page }) => {
    const userData = TestDataFactory.generateUser('fan');
    userData.email = email;

    const registrationPage = new UserRegistrationPage(page);
    await registrationPage.goto();
    await registrationPage.registerUser(userData);

    await expect(registrationPage.emailErrorMessage).toBeVisible();
  });
});
```

## Assertions

### Web-First Assertions
Use Playwright's web-first assertions for better reliability:

```typescript
// Good - Auto-waiting assertions
await expect(page.locator('#loading')).toBeHidden();
await expect(page.locator('#content')).toBeVisible();
await expect(page.locator('#title')).toHaveText('Welcome');

// Avoid - Manual waiting
await page.waitForSelector('#loading', { state: 'hidden' });
const content = page.locator('#content');
expect(await content.isVisible()).toBe(true);
```

### Custom Assertions
Create reusable assertion methods:

```typescript
export class CustomAssertions {
  static async expectUserToBeRegistered(page: Page, email: string) {
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-email"]')).toContainText(email);
    await expect(page).toHaveURL('/dashboard');
  }

  static async expectValidationError(page: Page, field: string, message: string) {
    const errorLocator = page.locator(`[data-testid="${field}-error"]`);
    await expect(errorLocator).toBeVisible();
    await expect(errorLocator).toContainText(message);
  }
}
```

## Test Hooks

### Setup and Teardown

```typescript
test.describe('Event Management', () => {
  let eventData: EventData;

  test.beforeEach(async ({ page }) => {
    // Setup before each test
    eventData = TestDataFactory.generateEvent();
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('test@example.com', 'password');
  });

  test.afterEach(async ({ page }) => {
    // Cleanup after each test
    const apiClient = new ApiClient(process.env.API_URL!);
    await apiClient.init();
    await apiClient.delete(`/events/${eventData.id}`);
    await apiClient.dispose();
  });

  test('should create new event', async ({ page }) => {
    // Test implementation using eventData
  });
});
```

## Error Handling

### Expected Failures

```typescript
test('should handle server error gracefully', async ({ page }) => {
  // Mock server error
  await page.route('**/api/register', route => {
    route.fulfill({
      status: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    });
  });

  const registrationPage = new UserRegistrationPage(page);
  await registrationPage.goto();
  
  const userData = TestDataFactory.generateUser('fan');
  await registrationPage.registerUser(userData);

  await expect(registrationPage.errorMessage).toBeVisible();
  await expect(registrationPage.errorMessage).toContainText('server error');
});
```

### Retries and Timeouts

```typescript
test.describe('Flaky Network Tests', () => {
  // Configure retries for flaky tests
  test.describe.configure({ retries: 2 });

  test('should handle slow network', async ({ page }) => {
    // Configure longer timeout for this test
    test.setTimeout(60000);

    await page.goto('/events', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="events-list"]')).toBeVisible({ timeout: 30000 });
  });
});
```

## API Testing Integration

### Combining UI and API Tests

```typescript
test('should sync UI changes with API', async ({ page }) => {
  const apiClient = new ApiClient(process.env.API_URL!);
  await apiClient.init();

  // Create user via API
  const userData = TestDataFactory.generateUser('fan');
  const apiResponse = await apiClient.post('/users', userData);
  expect(apiResponse.ok).toBe(true);

  // Verify in UI
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(userData.email, userData.password);

  const dashboardPage = new DashboardPage(page);
  await expect(dashboardPage.userProfile).toContainText(userData.firstName);

  // Cleanup
  await apiClient.delete(`/users/${apiResponse.data.id}`);
  await apiClient.dispose();
});
```

## Visual Testing

### Screenshot Comparisons

```typescript
test('should match header design', async ({ page }) => {
  await page.goto('/');
  
  // Take screenshot of specific element
  const header = page.locator('[data-testid="header"]');
  await expect(header).toHaveScreenshot('header.png');
});

test('should match full page layout', async ({ page }) => {
  await page.goto('/dashboard');
  
  // Full page screenshot
  await expect(page).toHaveScreenshot('dashboard-full.png', {
    fullPage: true,
    threshold: 0.2 // Allow 20% difference
  });
});
```

## Performance Testing

### Measuring Performance

```typescript
test('should load events page quickly', async ({ page }) => {
  const startTime = Date.now();
  
  await page.goto('/events');
  await expect(page.locator('[data-testid="events-list"]')).toBeVisible({ timeout: 3000 });
  
  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000); // Should load in under 3 seconds

  // Check performance metrics
  const metrics = await TestUtils.getPerformanceMetrics(page);
  expect(metrics.firstContentfulPaint).toBeLessThan(1500);
});
```

## Mobile Testing

### Responsive Design Tests

```typescript
test.describe('Mobile Experience', () => {
  test('should display mobile navigation', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/');
    
    const navigation = new NavigationComponent(page);
    await expect(navigation.mobileMenuToggle).toBeVisible();
    await expect(navigation.desktopMenu).toBeHidden();
  });

  test('should work with touch interactions', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/events');

    // Simulate touch scroll
    await page.touchscreen.tap(100, 300);
    await page.mouse.wheel(0, 500);

    const eventsList = page.locator('[data-testid="events-list"]');
    await expect(eventsList.locator('.event-item').first()).toBeVisible();
  });
});
```

## Best Practices Summary

1. **Use Page Object Model** - Encapsulate page logic
2. **Generate Test Data** - Use factories for consistent data
3. **Web-First Assertions** - Leverage Playwright's auto-waiting
4. **Descriptive Names** - Make tests self-documenting
5. **Group Related Tests** - Use describe blocks effectively
6. **Handle Async Properly** - Use await consistently
7. **Clean Up Resources** - Use hooks for setup/teardown
8. **Test Edge Cases** - Include error scenarios
9. **Keep Tests Independent** - Each test should be isolated
10. **Use Retries Sparingly** - Fix flaky tests instead of retrying

See [Authoring styles](authoring-styles.md) for runnable isolated examples, shared fixtures, and runner support boundaries.
