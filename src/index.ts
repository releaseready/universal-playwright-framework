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

export { executeAdapter } from "./adapter/v1";
export type {
  AdapterRequest,
  AdapterResult,
  AdapterError,
  TrustedAdapterContext,
} from "./adapter/v1";

// Keep root compatibility while maintaining runtime-login exports in one place.
export * from "./runtime-login/v1";
export type {
  ReviewedDataReferenceInput,
  ReviewedFixtureFieldPolicy,
} from "./input-preparation";
export {
  prepareScenarioInputs,
  InputPreparationError,
} from "./input-preparation";

// Public offline review boundary; validation never grants execution permission.
export { validateFeatureFile } from "./validation/feature-validator";
export type {
  FeatureValidation,
  ReviewedStepManifest,
  ValidateFeatureInput,
} from "./validation/feature-validator";
export type { ScenarioApproval } from "./validation/scenario-selector";

export { waitForVisible } from "./readiness/wait-for-visible";
