Feature: Three ways to organize the same owned draft test
  Scenario: Simple
    Given a fresh synthetic draft workspace
    When I save the draft with inline locators
    Then only that draft is saved

  Scenario: Page Objects and Components
    Given the "Draft editor" form is ready and the "Drafts" list is empty on the Draft Screen
    When I enter "Synthetic rehearsal" in the "Title" field on the Draft Screen
    And I click the "Save draft" button on the Draft Screen
    Then the status message shows "Saved: Synthetic rehearsal" on the Draft Screen
    And the "Drafts" list contains only "Synthetic rehearsal" on the Draft Screen

  Scenario: Business Flows
    Given a fresh synthetic draft workspace
    When I create the draft through the business flow
    Then only that draft is saved
