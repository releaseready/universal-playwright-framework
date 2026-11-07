/** Public provider/consumer entry. Browser dependencies load only on consumption.
 * This entry does not grant execution authority or enable terminal credential input.
 */
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
} from "../input-preparation/runtime-login";
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
} from "../input-preparation/runtime-login";
export { withOperatorLoginInputs } from "../input-preparation/operator-prompt";
export type {
  OperatorTerminalInput,
  OperatorTerminalOutput,
} from "../input-preparation/operator-prompt";
export type {
  PreparedInputDescriptor,
  RuntimeSecretProvider,
  RuntimeSecretScope,
  SecretReference,
} from "../input-preparation";
export {
  verifyPartayLogin,
  promptAndVerifyPartayLogin,
  PARTAY_LOGIN_URL,
  partayLoginFailureReport,
} from "../customer-login/partay";
export type { RuntimeLoginBrowserOptions } from "../execution/runtime-login-browser";
export type {
  PartayLoginOptions,
  PartayLoginResult,
} from "../customer-login/partay";
export { PARTAY_AUTHENTICATION_ONLY_POLICY } from "../customer-login/authentication-only";
export type { AuthenticationOnlyBinding } from "../customer-login/authentication-only";
