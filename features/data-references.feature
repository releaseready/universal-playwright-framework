@web-run-inputs @web-run-inputs-S01 @web-run-inputs-S02 @web-run-inputs-S04
Feature: Associate approved data with reviewed scenario rows
  Scenario: Keep two owned dataset rows distinguishable without secret values
    Given two synthetic scenario rows use approved versioned data references
    When the operator reviews the data associations
    Then both rows retain their own identities and only safe references

  Scenario: Changing the approved data revision requires another review
    Given two synthetic scenario rows use approved versioned data references
    When the operator reviews the data associations
    And the selected dataset moves to another approved revision
    Then the previous data binding is rejected before execution

  Scenario: Reject a missing dataset row without exposing submitted secret content
    Given two synthetic scenario rows use approved versioned data references
    When an unknown row and a secret value are submitted
    Then the data association fails with a safe error
