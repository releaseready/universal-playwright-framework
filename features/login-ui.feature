@owned-login-ui
Feature: Review supported login controls on an owned synthetic form

  Scenario: Password visibility toggles without submitting the form
    Given the locally served synthetic login form is open
    When I enter a synthetic password without submitting
    Then the password is masked
    When I reveal the password with the shared page interaction helper
    Then the password is visible and its synthetic value is unchanged
    When I hide the password with the shared page interaction helper
    Then the password is masked and the form has not been submitted

  Scenario: Shared page helpers do not expose supplied secrets in interaction logs
    Given the locally served synthetic login form is open
    When I use shared page helpers with synthetic credentials
    Then the emitted interaction logs are redacted

  Scenario: Dialog messages do not expose supplied values in interaction logs
    Given the locally served synthetic login form is open
    When I open a synthetic dialog with a private message
    Then the dialog interaction log is emitted without its message

  Scenario: Keyboard users can reveal a password without submitting
    Given the locally served synthetic login form is open
    When I enter a synthetic password without submitting
    And I focus and activate the visibility control with the keyboard
    Then the visibility control is accessible and visibly focused
    And the password is revealed without submitting the form

  Scenario: Missing required fields are reported without a form submission
    Given the locally served synthetic login form is open
    When I submit the empty form with the shared page interaction helper
    Then both required fields report missing values
    And the form has not been submitted

  Scenario: Enter submits the locally completed form exactly once
    Given the locally served synthetic login form is open
    When I enter synthetic account details and press Enter
    Then the local form records exactly one submission
