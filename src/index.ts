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

export {
  consumeRuntimeLoginInputs,
  InMemoryRuntimeSecretProvider,
  RuntimeLoginError,
  validateRuntimeLoginRequest,
} from "./input-preparation/runtime-login";
export { withOperatorLoginInputs } from "./input-preparation/operator-prompt";
export type {
  RuntimeLoginAccount,
  RuntimeLoginErrorCode,
  RuntimeLoginRequest,
  RuntimeLoginResult,
} from "./input-preparation/runtime-login";
export type {
  OperatorTerminalInput,
  OperatorTerminalOutput,
} from "./input-preparation/operator-prompt";
export type {
  PreparedInputDescriptor,
  ReviewedDataReferenceInput,
  ReviewedFixtureFieldPolicy,
  RuntimeSecretProvider,
  RuntimeSecretScope,
  SecretReference,
} from "./input-preparation";
export {
  prepareScenarioInputs,
  InputPreparationError,
} from "./input-preparation";

export {
  verifyPartayLogin,
  promptAndVerifyPartayLogin,
  PARTAY_LOGIN_URL,
} from "./customer-login/partay";
export type { RuntimeLoginBrowserOptions } from "./execution/runtime-login-browser";
