module.exports = {
  default: {
    paths: ["features/**/*.feature"],
    require: ["features/support/**/*.cjs", "features/steps/**/*.cjs"],
    format: ["progress", "json:reports/cucumber-results.json"],
  },
};
