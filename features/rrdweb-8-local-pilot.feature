@owned-synthetic @rrdweb-8-local-pilot
Feature: Exercise the bounded local pilot login checks

  Background:
    Given the owned synthetic pilot login page is open

  @RRDWEB-8-local-S01
  Scenario: Keep ReleaseReady and target account identities separate
    Given the target login uses an exact approved synthetic recipe
    When I submit the synthetic target login once
    Then only the target recipe account reaches the local login form
    And no customer target request or extra submission occurs

  @RRDWEB-8-local-S02
  Scenario: Accept only the complete observed synthetic authentication
    Given the synthetic response matches the approved success fixture
    When I submit the synthetic target login once
    Then the exact local URL, visible Partay brand, signed-in marker, and dismissed overlay are observed together
    And the result is limited to authentication

  @RRDWEB-8-local-S02
  Scenario: A visible logo cannot pass a login that requires more interaction
    Given the synthetic response requires additional interaction
    When I submit the synthetic target login once
    Then the visible logo and exact URL do not make the result a success
    And no retry or follow-up request occurs

  @RRDWEB-8-local-S03
  Scenario: Report only offline observations and confirmed cleanup
    When I record the observed offline coverage and close the page
    Then the evidence distinguishes offline from live coverage and names exclusions
    And cleanup is reported separately from the login outcome
    And no customer attempt or post-login action is recorded
