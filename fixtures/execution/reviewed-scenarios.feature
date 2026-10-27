@web-safe-execution
Feature: Execute reviewed synthetic scenarios

  @scenario-id=browser-flow @web-safe-execution-S01
  Scenario: A reviewed visitor action succeeds
    Given the synthetic reviewed page is open
    When I enter the prepared display name
    Then the synthetic page confirms the prepared display name

  @scenario-id=retry-assertion-flow @web-safe-execution-S03
  Scenario: A real assertion can fail before a retry passes
    Given the synthetic reviewed page is open
    When I enter the prepared display name
    Then the synthetic status matches its retry attempt

  @scenario-id=assertion-failure @web-safe-execution-S02
  Scenario: A failed assertion fails the run
    Given the synthetic reviewed page is open
    When I enter the prepared display name
    Then the synthetic status says "Not the prepared visitor"

  @scenario-id=pending-flow @web-safe-execution-S02
  Scenario: A pending reviewed step fails the run
    Given the scenario is explicitly pending

  @scenario-id=undefined-flow @web-safe-execution-S02
  Scenario: An undefined step cannot be selected for execution
    Given this step has no reviewed implementation

  @scenario-id=timeout-flow @web-safe-execution-S03
  Scenario: An overlong action is stopped by the run boundary
    Given the synthetic reviewed page is open
    When I enter the prepared display name
    When I wait for 5000 milliseconds
    Then the synthetic page confirms the prepared display name

  @scenario-id=redirect-flow @web-safe-execution-S03
  Scenario: An unapproved redirect is blocked before connection
    Given the synthetic reviewed page is open
    When I follow a redirect to an unapproved target
    Then the unapproved navigation was blocked
