@retry-regression
Feature: Visible bounded retries for reviewed synthetic execution

  Scenario: A successful retry preserves its actual assertion outcomes
    When I execute retry-assertion-flow with one retry and an assertion mismatch on attempt 1
    Then the first attempt records the real assertion failure
    And the second attempt passes with a fresh browser resource

  Scenario: Retries are disabled by default
    When I execute retry-assertion-flow with retries disabled and an assertion mismatch on attempt 1
    Then the run is failed after 1 attempt with the real assertion failure preserved

  Scenario: Retry exhaustion preserves both failed attempts
    When I execute retry-assertion-flow with assertion mismatches on attempts 1 and 2
    Then the run is failed after 2 attempts with both assertion failures preserved

  Scenario: Cancellation prevents another attempt
    When I cancel browser-flow after its first browser starts with two retries allowed
    Then the cancelled run has only 1 attempt and 1 browser start

  Scenario: Cleanup failure prevents another attempt
    When I execute browser-flow with a context cleanup failure and two retries allowed
    Then the failed cleanup is visible and the run has only 1 attempt

  Scenario: Late cancellation preserves a completed pass
    When I cancel browser-flow during successful attempt teardown
    Then the completed successful attempt remains passed

  Scenario: A late deadline preserves a completed pass
    When the deadline expires during successful browser-flow teardown
    Then the completed successful attempt remains passed

  Scenario: Cancellation between attempts preserves the actual failure
    When I cancel retry-assertion-flow after its first real failure
    Then the first real failure is retained without another browser launch
    And the run status is "cancelled"

  Scenario: A deadline between attempts preserves the actual failure
    When the deadline expires after retry-assertion-flow first fails
    Then the first real failure is retained without another browser launch
    And the run status is "timed_out"

  Scenario: Late cancellation does not hide unknown cleanup
    When I cancel browser-flow during teardown with unknown browser cleanup
    Then unknown browser cleanup remains visible after late cancellation
