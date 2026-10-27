@web-run-inputs
Feature: Prepare bounded inputs for reviewed synthetic scenarios
  Input preparation validates caller-approved boundaries without launching a browser.

  @web-run-inputs-S01
  Scenario: Prepare synthetic values for approved scenario references
    Given the approved synthetic fixture and reviewed scenarios
    When I prepare the scenario inputs
    Then the prepared descriptor contains only safe revisions and selected values

  @web-run-inputs-S02
  Scenario: Reject missing approved environment settings safely
    Given the synthetic fixture has no environment settings
    When I prepare the scenario inputs
    Then preparation fails safely with "invalid-environment"

  @web-run-inputs-S02
  Scenario: Reject an unavailable account reference safely
    Given a scenario refers to an unavailable account
    When I prepare the scenario inputs
    Then preparation fails safely with "invalid-account-reference"

  @web-run-inputs-S02
  Scenario: Reject a secret-value field safely
    Given a scenario contains a secret-value field
    When I prepare the scenario inputs
    Then preparation fails safely with "invalid-scenario-data"

  @web-run-inputs-S02
  Scenario: Reject missing fixture fields safely
    Given a scenario has no fixture fields
    When I prepare the scenario inputs
    Then preparation fails safely with "invalid-scenario-data"

  @web-run-inputs-S03
  Scenario: Reject an initial target outside the approved origin
    Given the initial target uses an unapproved origin
    When I prepare the scenario inputs
    Then preparation fails safely with "target-outside-approved-origin"

  @web-run-inputs-S03
  Scenario: Reject a same-origin blob target
    Given the initial target uses a same-origin blob URL
    When I prepare the scenario inputs
    Then preparation fails safely with "target-outside-approved-origin"

  @web-run-inputs-S03
  Scenario: Reject a query containing a synthetic secret
    Given the initial target contains a synthetic secret query
    When I prepare the scenario inputs
    Then preparation fails safely with "target-outside-approved-origin"

  @web-run-inputs-S03
  Scenario: Reject an initial target fragment
    Given the initial target contains a fragment
    When I prepare the scenario inputs
    Then preparation fails safely with "target-outside-approved-origin"

  @web-run-inputs-S04
  Scenario: Keep prepared account access reference-only
    Given the approved synthetic fixture and reviewed scenarios
    When I prepare the scenario inputs
    Then prepared account access contains references only

  @web-run-inputs-S05
  Scenario: Isolate scenario fixture and account references
    Given the approved synthetic fixture and reviewed scenarios
    When I prepare the scenario inputs
    Then mutating one scenario cannot mutate another scenario

  @web-run-inputs-S06
  Scenario: Hand off required cleanup without claiming restoration
    Given the approved synthetic fixture and reviewed scenarios
    When I prepare the scenario inputs
    Then cleanup remains required and unknown until runtime evidence
