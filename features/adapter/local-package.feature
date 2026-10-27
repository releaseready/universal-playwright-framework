@local-package-adapter
Feature: Use the reviewed synthetic package without a live portal
  The central owner authorizes calls and persists their evidence.
  This local package neither authenticates users nor deduplicates deliveries.

  @web-product-adapter-S01 @RRDWEB-6-reuse-S01
  Scenario: Run the intended approved visitor action
    Given the pinned compatible local adapter example
    When the owner runs the adapter
    Then the synthetic visitor steps pass and retain the central run reference

  @web-product-adapter-S02
  Scenario: Refuse an external target before any browser starts
    Given the pinned compatible local adapter example
    When an external target is requested
    Then the request is rejected without acquiring a server or browser

  @web-product-adapter-S04
  Scenario: Preserve an actual timed out action and its cleanup separately
    Given the pinned compatible local adapter example
    When the owned long action exceeds its boundary
    Then serialization retains the timeout attempt and honest restoration status

  @web-product-adapter-S05
  Scenario: Install and execute the immutable local tarball independently
    Given the pinned compatible local adapter example
    When the tarball is installed outside the checkout
    Then its versioned export runs the synthetic visitor without a portal account

  @RRDWEB-6-reuse-S02
  Scenario: Match the existing direct synthetic business and lifecycle behavior
    Given the pinned compatible local adapter example
    When the owner compares adapter and direct execution
    Then the business steps and cleanup match without claiming data restoration
