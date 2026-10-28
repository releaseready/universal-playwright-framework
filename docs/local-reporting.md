# Local synthetic execution reports

Run `npm run execute:synthetic` to execute the reviewed synthetic scenarios. The command writes a plain-text report and machine-readable JSON under the repository's `reports/` directory, prints the JSON report to stdout, and prints the human-readable report to stderr. Output filenames are generated locally; reports are never loaded from caller-supplied paths.

Both outputs share one typed report model. Scenario totals count scenarios, while attempt totals count every execution attempt. Run references are generated execution identifiers; the source revision is the stable reviewed synthetic source revision. Every report is visibly labelled synthetic and is not customer acceptance.

The execution adapter retains a bounded summary of Cucumber feature/scenario names and step statuses from its owned worker JSON before removing the temporary directory. Raw error text is not retained. If the Cucumber summary is unavailable, the actual execution outcome is preserved and the report marks that evidence unavailable. Screenshots, logs, and traces are not collected or attached by this slice.

`npm run test:reporting` runs focused report tests and the tagged synthetic reporting feature. The unit/BDD fixture examples are synthetic fixtures; the reporting test also exercises a real reviewed execution with a Cucumber assertion failure followed by a successful retry.
