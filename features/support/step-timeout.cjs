const DEFAULT_STEP_TIMEOUT_MS = 15_000;
const MIN_STEP_TIMEOUT_MS = 12_000;
const MAX_STEP_TIMEOUT_MS = 60_000;

function getStepTimeoutMs(value) {
  if (value === undefined) {
    return DEFAULT_STEP_TIMEOUT_MS;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `CUCUMBER_STEP_TIMEOUT_MS must be an integer from ${MIN_STEP_TIMEOUT_MS} to ${MAX_STEP_TIMEOUT_MS}`,
    );
  }

  const timeoutMs = Number(value);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_STEP_TIMEOUT_MS ||
    timeoutMs > MAX_STEP_TIMEOUT_MS
  ) {
    throw new Error(
      `CUCUMBER_STEP_TIMEOUT_MS must be an integer from ${MIN_STEP_TIMEOUT_MS} to ${MAX_STEP_TIMEOUT_MS}`,
    );
  }

  return timeoutMs;
}

module.exports = {
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_STEP_TIMEOUT_MS,
  MIN_STEP_TIMEOUT_MS,
  getStepTimeoutMs,
};
