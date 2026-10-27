/**
 * Main entry point for the Playwright framework
 * Exports all the framework components and utilities
 */

// Page Object Models
export { BasePage } from "./pages/base-page";

// Components
export { BaseComponent } from "./components/base-component";
export { NavigationComponent } from "./components/navigation-component";

// API utilities
export { ApiClient } from "./api/api-client";
export type { ApiResponse } from "./api/api-client";

// Test utilities
export { TestUtils } from "./utils/test-utils";
export { Logger, LogLevel } from "./utils/logger";

// Test data
export { TestDataFactory } from "../fixtures/test-data-factory";
export type {
  UserData,
  EventData,
  BandMember,
} from "../fixtures/test-data-factory";

// Framework version
export const FRAMEWORK_VERSION = "1.0.0";
