@synthetic
Feature: Synthetic demo interaction
  Scenario: A visitor completes the demo action
    Given the demo page is open
    Then the page title should be "Synthetic demo"
    When I activate the demo action
    Then I should see "Action completed"
