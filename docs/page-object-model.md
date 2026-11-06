# Page Object Model Guide

The Page Object Model (POM) is a design pattern that creates a separation between test code and page-specific code. This framework provides a base structure to implement POM effectively.

## Base Page Class

All page objects should extend the `BasePage` class which provides common functionality:

```typescript
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

  async getErrorMessage(): Promise<string> {
    const errorLocator = this.page.locator('[data-testid="error-message"]');
    return await this.getElementText(errorLocator);
  }
}
```

## Best Practices

### 1. Use Data Test IDs
Always use `data-testid` attributes for reliable element selection:

```html
<button data-testid="submit-button">Submit</button>
```

```typescript
private readonly submitButton = this.page.locator('[data-testid="submit-button"]');
```

### 2. Encapsulate Page Logic
Keep page-specific logic within the page object:

```typescript
export class UserRegistrationPage extends BasePage {
  async registerUser(userData: UserData): Promise<void> {
    await this.fillInput(this.firstNameInput, userData.firstName);
    await this.fillInput(this.lastNameInput, userData.lastName);
    await this.fillInput(this.emailInput, userData.email);
    
    if (userData.userType === 'band') {
      await this.selectUserType('band');
      await this.addBandMembers(userData.bandMembers);
    }
    
    await this.clickElement(this.submitButton);
  }

  private async selectUserType(type: string): Promise<void> {
    await this.clickElement(this.userTypeSelect);
    await this.clickElement(this.page.locator(`[data-value="${type}"]`));
  }
}
```

### 3. Return Page Objects
Methods that navigate should return the appropriate page object:

```typescript
export class NavigationComponent extends BaseComponent {
  async navigateToProfile(): Promise<ProfilePage> {
    await this.clickElement(this.profileLink);
    return new ProfilePage(this.page);
  }

  async logout(): Promise<LoginPage> {
    await this.openUserMenu();
    await this.clickElement(this.logoutButton);
    return new LoginPage(this.page);
  }
}
```

### 4. Use Meaningful Method Names
Method names should describe what the user is doing:

```typescript
// Good
async searchForEvents(query: string): Promise<void>
async addEventToFavorites(eventId: string): Promise<void>

// Avoid
async click(): Promise<void>
async fill(value: string): Promise<void>
```

### 5. Handle Wait Conditions
Use appropriate wait conditions for dynamic content:

```typescript
export class EventsPage extends BasePage {
  async waitForEventsToLoad(): Promise<void> {
    await this.waitForReady(this.eventsContainer, 10000);
    // Assert the expected result content too; a visible container can be empty.
  }

  async searchEvents(query: string): Promise<EventSearchResults> {
    await this.fillInput(this.searchInput, query);
    await this.clickElement(this.searchButton);
    await this.waitForEventsToLoad();
    return new EventSearchResults(this.page);
  }
}
```

## Page Object Structure

### 1. Constructor
- Call super with page and URL
- Initialize all locators

### 2. Locators
- Define as private readonly
- Use descriptive names
- Group related locators

### 3. Public Methods
- High-level user actions
- Return appropriate types
- Include logging

### 4. Private Methods
- Internal helper methods
- Complex interactions
- Reusable logic

## Example: Complete Page Object

```typescript
import { BasePage } from '@/pages/base-page';
import { Page, Locator } from '@playwright/test';
import { UserData } from '@fixtures/test-data-factory';

export class UserRegistrationPage extends BasePage {
  // Form fields
  private readonly firstNameInput: Locator;
  private readonly lastNameInput: Locator;
  private readonly emailInput: Locator;
  private readonly phoneInput: Locator;
  private readonly passwordInput: Locator;
  private readonly confirmPasswordInput: Locator;
  
  // User type selection
  private readonly userTypeRadios: Locator;
  private readonly fanRadio: Locator;
  private readonly bandRadio: Locator;
  private readonly soloArtistRadio: Locator;
  
  // Conditional fields
  private readonly genreSelect: Locator;
  private readonly instrumentsSelect: Locator;
  private readonly bandMembersSection: Locator;
  
  // Actions
  private readonly submitButton: Locator;
  private readonly cancelButton: Locator;
  
  // Messages
  private readonly successMessage: Locator;
  private readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page, '/register');
    
    // Initialize locators
    this.firstNameInput = page.locator('[data-testid="first-name-input"]');
    this.lastNameInput = page.locator('[data-testid="last-name-input"]');
    this.emailInput = page.locator('[data-testid="email-input"]');
    this.phoneInput = page.locator('[data-testid="phone-input"]');
    this.passwordInput = page.locator('[data-testid="password-input"]');
    this.confirmPasswordInput = page.locator('[data-testid="confirm-password-input"]');
    
    this.userTypeRadios = page.locator('[name="userType"]');
    this.fanRadio = page.locator('[data-testid="user-type-fan"]');
    this.bandRadio = page.locator('[data-testid="user-type-band"]');
    this.soloArtistRadio = page.locator('[data-testid="user-type-solo-artist"]');
    
    this.genreSelect = page.locator('[data-testid="genre-select"]');
    this.instrumentsSelect = page.locator('[data-testid="instruments-select"]');
    this.bandMembersSection = page.locator('[data-testid="band-members-section"]');
    
    this.submitButton = page.locator('[data-testid="submit-button"]');
    this.cancelButton = page.locator('[data-testid="cancel-button"]');
    
    this.successMessage = page.locator('[data-testid="success-message"]');
    this.errorMessage = page.locator('[data-testid="error-message"]');
  }

  /**
   * Register a new user with provided data
   */
  async registerUser(userData: UserData): Promise<void> {
    this.logger.step(`Registering ${userData.userType}: ${userData.email}`);
    
    await this.fillBasicInformation(userData);
    await this.selectUserType(userData.userType);
    await this.fillUserTypeSpecificFields(userData);
    await this.submitForm();
  }

  /**
   * Fill basic user information
   */
  private async fillBasicInformation(userData: UserData): Promise<void> {
    await this.fillInput(this.firstNameInput, userData.firstName);
    await this.fillInput(this.lastNameInput, userData.lastName);
    await this.fillInput(this.emailInput, userData.email);
    await this.fillInput(this.phoneInput, userData.phone);
    await this.fillInput(this.passwordInput, userData.password);
    await this.fillInput(this.confirmPasswordInput, userData.password);
  }

  /**
   * Select user type
   */
  private async selectUserType(userType: string): Promise<void> {
    switch (userType) {
      case 'fan':
        await this.clickElement(this.fanRadio);
        break;
      case 'band':
        await this.clickElement(this.bandRadio);
        break;
      case 'solo_artist':
        await this.clickElement(this.soloArtistRadio);
        break;
      default:
        throw new Error(`Unknown user type: ${userType}`);
    }
  }

  /**
   * Fill user type specific fields
   */
  private async fillUserTypeSpecificFields(userData: UserData): Promise<void> {
    if (userData.userType === 'band' && userData.bandMembers) {
      await this.addBandMembers(userData.bandMembers);
    }
    
    if (userData.genre) {
      await this.selectGenres(userData.genre);
    }
    
    if (userData.instruments) {
      await this.selectInstruments(userData.instruments);
    }
  }

  /**
   * Submit the registration form
   */
  private async submitForm(): Promise<void> {
    await this.clickElement(this.submitButton);
    await this.waitForRegistrationResult();
  }

  /**
   * Wait for registration result
   */
  private async waitForRegistrationResult(): Promise<void> {
    // Wait for either success or error message
    await Promise.race([
      this.waitForElement(this.successMessage),
      this.waitForElement(this.errorMessage)
    ]);
  }

  /**
   * Check if registration was successful
   */
  async isRegistrationSuccessful(): Promise<boolean> {
    return await this.isElementVisible(this.successMessage);
  }

  /**
   * Get registration error message
   */
  async getErrorMessage(): Promise<string> {
    return await this.getElementText(this.errorMessage);
  }
}
```

This approach provides a clean, maintainable structure for your page objects that can be easily extended and reused across different applications.

Page objects are optional. See [Authoring styles](authoring-styles.md) for Simple and Business Flows examples and the BasePage readiness migration.
