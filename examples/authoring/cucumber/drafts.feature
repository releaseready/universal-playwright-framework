Feature: Three ways to organize the same owned draft test
  Background:
    Given a fresh synthetic draft workspace

  Scenario: Simple
    When I save the draft with inline locators
    Then only that draft is saved

  Scenario: Page Objects and Components
    When I save the draft with the page and editor component
    Then only that draft is saved

  Scenario: Business Flows
    When I create the draft through the business flow
    Then only that draft is saved
