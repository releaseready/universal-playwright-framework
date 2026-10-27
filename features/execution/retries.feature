@retry-regression
Feature: Visible bounded retries for reviewed synthetic execution

  Scenario: A successful retry keeps the first attempt's injected failure visible
    When I execute browser-flow with one retry and a failure injected on attempt 1
    Then the first attempt records an injected failure after the browser passed
    And the second attempt passes and the run is passed after retry

  Scenario: Retries are disabled by default
    When I execute browser-flow with retries disabled and a failure injected on attempt 1
    Then the run is failed after 1 attempt with the injected failure preserved

  Scenario: Retry exhaustion preserves both failed attempts
    When I execute browser-flow with one retry and failures injected on attempts 1 and 2
    Then the run is failed after 2 attempts with both injected failures preserved

  Scenario: Cancellation prevents another attempt
    When I cancel browser-flow after its first browser starts with two retries allowed
    Then the cancelled run has only 1 attempt and 1 browser start

  Scenario: Cleanup failure prevents another attempt
    When I execute browser-flow with a context cleanup failure and two retries allowed
    Then the failed cleanup is visible and the run has only 1 attempt
