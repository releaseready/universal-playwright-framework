@validation-synthetic
@validation-synthetic
Feature: Synthetic review intake
  Background: shared setup
    Given common setup is ready

  @rule-review
  Rule: reviewed demo flows
    Background: rule setup
      Given rule setup is ready

    @scenario-id=approved-basic @basic-review
    @basic-review
    Scenario: Basic synthetic flow
      Given the demo page is open

    @scenario-id=approved-outline
    Scenario Outline: Synthetic example flow
      When I activate <action>
      Then outcome is <outcome>

      @row-review
      @row-review
      Examples: reviewed rows
        | case_id | action | outcome |
        | row-a   | alpha  | ready   |
        | row-b   | beta   | done    |

    @scenario-id=undefined-step
    Scenario: Unreviewed synthetic step
      Given this synthetic step is not reviewed
