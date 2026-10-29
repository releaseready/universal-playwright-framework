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
  RuntimeLoginFailure,
  RUNTIME_LOGIN_FAILURE_STAGES,
  RUNTIME_LOGIN_CLEANUP_STATUSES,
  RUNTIME_LOGIN_POLICY_REASONS,
  RUNTIME_LOGIN_FAILURE_CLASSIFICATIONS,
  validateRuntimeLoginRequest,
} from "./input-preparation/runtime-login";
export { withOperatorLoginInputs } from "./input-preparation/operator-prompt";
export type {
  RuntimeLoginAccount,
  RuntimeLoginErrorCode,
  RuntimeLoginFailureStage,
  RuntimeLoginFailureClassification,
  RuntimeLoginFailureReport,
  RuntimeLoginCleanupStatus,
  RuntimeLoginPolicyReason,
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
  partayLoginFailureReport,
} from "./customer-login/partay";
export type { RuntimeLoginBrowserOptions } from "./execution/runtime-login-browser";

export { PARTAY_AUTHENTICATION_ONLY_POLICY } from "./customer-login/authentication-only";
export type { AuthenticationOnlyBinding } from "./customer-login/authentication-only";
export type {
  PartayLoginOptions,
  PartayLoginResult,
} from "./customer-login/partay";

// Public offline review boundary; validation never grants execution permission.
export { validateFeatureFile } from "./validation/feature-validator";
export type {
  FeatureValidation,
  ReviewedStepManifest,
  ValidateFeatureInput,
} from "./validation/feature-validator";
export type { ScenarioApproval } from "./validation/scenario-selector";
