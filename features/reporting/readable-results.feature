@web-readable-results
Feature: Readable bounded synthetic execution reports

  @web-readable-results-S01
  Scenario: A report preserves feature and scenario outcomes, failed business steps, reasons, and stable references
    Given reviewed synthetic features have finished
    When a report is generated
    Then the retry report preserves both actual attempts and stable references

  @web-readable-results-S02
  Scenario: Text and JSON totals agree and untested work stays distinct from a pass
    Given reviewed synthetic features have finished
    When a report is generated
    Then outcomes, attempts, totals, and not-executed work remain distinct

  @web-readable-results-S03
  Scenario: Private evidence is withheld by default with a clear reason
    Given reviewed synthetic features have finished
    When a report is generated
    Then screenshots logs and traces are withheld without claiming sanitization

  @web-readable-results-S04
  Scenario: Cross-run, arbitrary-file, and external references are rejected
    Given reviewed synthetic features have finished
    When a report is generated
    Then unsafe references are rejected without being echoed

  @web-readable-results-S05
  Scenario: Missing evidence preserves the actual result without a fabricated artifact
    Given reviewed synthetic features have finished
    When a report is generated
    Then unavailable evidence does not change the execution outcome

  @web-readable-results-S06
  Scenario: Owned demonstration reports cannot claim customer execution
    Given reviewed synthetic features have finished
    When a report is generated
    Then every output is visibly synthetic and not customer acceptance
